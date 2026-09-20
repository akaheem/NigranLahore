#!/usr/bin/env node
/**
 * End-to-end proof of the shared service log and complaints board.
 *
 * The README's curl sequence, as a script that asserts and exits non-zero. It
 * exists because the HTTP wiring and the SQL are the parts of this service that
 * unit tests cannot reach: `npm test` proves the decision logic in validate.js
 * with no database at all, and this proves the route mounts, the parsers, the
 * queries, the cascade deletes and the status codes that sit on top of them.
 *
 * What it deliberately does NOT re-test: the pure refusals (a PNG declared as
 * WebP, an oversized photo, a host not on the video allowlist). Those live in
 * src/validate.test.js where they run offline in milliseconds. Here they would
 * also cost complaint rate-limit budget, and that budget is 6 requests a minute
 * — see the note on RATE-LIMIT BUDGET below.
 *
 *   npm run smoke                       # against http://localhost:3000
 *   SMOKE_BASE_URL=… npm run smoke      # against a deployed instance
 *
 * Exit codes: 0 all checks passed · 1 a check failed · 2 refused for a reason
 * that is not a fault (see the rate-limit note).
 */

const BASE = (process.env.SMOKE_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
const TOKEN = process.env.DEMO_WRITE_TOKEN || 'dev-token'

/**
 * A 1x1 PNG. Embedded rather than kept as a fixture file so the script has no
 * dependencies and no working-directory assumptions — and it satisfies
 * `sniffImageMime`'s PNG magic check, which is the point: the server must
 * accept it because of its bytes, not because we said so.
 */
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/**
 * The header of an ISO-BMFF file, and nothing else.
 *
 * This is deliberately not a playable video — it is a 4-byte box size followed
 * by `ftyp` at offset 4, which is exactly what `sniffVideoMime` reads and
 * exactly the whole of what this script is checking: that the route stores
 * bytes, types them by their own magic, and slices them for a Range request.
 * Encoding a real MP4 here would add a fixture file and a build step to assert
 * something this container header asserts just as well. The filler bytes exist
 * so `bytes=0-1` has something to slice and the length is not a round number.
 */
const TINY_MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftyp', 'ascii'),
  Buffer.from('isom', 'ascii'),
  Buffer.from([0x00, 0x00, 0x02, 0x00]),
  Buffer.from('isomiso2', 'ascii'),
  Buffer.alloc(64, 0x21),
])
const TINY_MP4_B64 = TINY_MP4.toString('base64')

/** Where the report is. Deliberately unrounded: the server must snap it. */
const LAT = 31.5204123
const LNG = 74.3581234

/** Unique per run, so every assertion below is exact against a database that
 *  already holds data from previous runs — including the previous run of this
 *  very script. */
const RUN = Math.random().toString(36).slice(2, 10)
const DRAIN = `smoke-${RUN}`
const REPORTER = `smoke-${RUN}`
const OTHER_DEVICE = `other-${RUN}`
const CLIENT_ID = `smoke-c-${RUN}`

let passed = 0
const failures = []

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ok   ${name}`)
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(title) {
  console.log(`\n${title}`)
}

/** One request, with the body read in whichever form the caller needs. */
async function req(path, { method = 'GET', token = null, headers = {}, body = null } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { 'x-demo-token': token } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* not JSON — a check below cares */ }
  return { status: res.status, headers: res.headers, text, json }
}

/** A non-JSON body is a failure of its own: a misconfigured frontend gets an
 *  HTML error page it cannot parse, which is why the 404 fallback exists. */
const isJson = (res) => (res.headers.get('content-type') || '').includes('application/json')

async function main() {
  console.log(`nigran smoke — ${BASE}`)

  section('health')
  const health = await req('/health')
  check('/health answers 200 JSON', health.status === 200 && isJson(health), `got ${health.status}`)
  check('a database is configured', health.json?.database === true, JSON.stringify(health.json))
  check('writes are enabled (a token is set)', health.json?.writesEnabled === true, JSON.stringify(health.json))
  if (health.json?.database !== true) {
    console.error('\nNo database behind the service. Start one and point DATABASE_URL at it:')
    console.error('  cd server && docker compose up -d --wait')
    console.error('  npm run start:local')
    process.exit(2)
  }
  if (health.json?.writesEnabled !== true) {
    console.error('\nDEMO_WRITE_TOKEN is unset on the server, so every write is refused (this is')
    console.error('deliberate — writes fail closed). Start it with the token set.')
    process.exit(2)
  }

  section('the write token is a real gate')
  const untokened = await req('/api/services', {
    method: 'POST',
    body: { drainId: DRAIN, servicedAt: new Date().toISOString() },
  })
  check('a POST with no token is refused 401', untokened.status === 401, `got ${untokened.status}`)
  const wrongToken = await req('/api/services', {
    method: 'POST',
    token: 'not-the-token',
    body: { drainId: DRAIN, servicedAt: new Date().toISOString() },
  })
  check('a POST with the wrong token is refused 401', wrongToken.status === 401, `got ${wrongToken.status}`)

  section('the service log')
  const eventId = `smoke-ev-${RUN}`
  const first = await req('/api/services', {
    method: 'POST',
    token: TOKEN,
    body: { clientEventId: eventId, drainId: DRAIN, servicedAt: new Date().toISOString(), fillAtService: 95, simulated: false, crewId: 'crew-1' },
  })
  check('a real service is recorded 201', first.status === 201 && first.json?.duplicate === false, `got ${first.status}`)

  // The retry case: same client_event_id, so the UNIQUE constraint makes it a
  // no-op. This is what stops a timeout-and-resend double-counting a service.
  const retry = await req('/api/services', {
    method: 'POST',
    token: TOKEN,
    body: { clientEventId: eventId, drainId: DRAIN, servicedAt: new Date().toISOString(), fillAtService: 95, simulated: false },
  })
  check('the same event resent is a no-op, not a duplicate row',
    retry.status === 200 && retry.json?.duplicate === true, `got ${retry.status} ${JSON.stringify(retry.json)}`)

  // A time-lapse service: kept as history, excluded from the published count.
  const simulated = await req('/api/services', {
    method: 'POST',
    token: TOKEN,
    body: { clientEventId: `smoke-sim-${RUN}`, drainId: DRAIN, servicedAt: new Date().toISOString(), simulated: true, speed: 1440 },
  })
  check('a time-lapse service is recorded 201', simulated.status === 201, `got ${simulated.status}`)

  const summary = await req('/api/services/summary')
  const row = (summary.json?.drains || []).find(d => d.drainId === DRAIN)
  check('the summary counts only the real service', row?.count === 1, JSON.stringify(row))
  check('…and reports the time-lapse one separately', row?.simulatedCount === 1, JSON.stringify(row))

  const listed = await req(`/api/services?drainId=${DRAIN}`)
  check('the drain history is readable', Array.isArray(listed.json?.events) && listed.json.events.length === 2,
    `${listed.json?.events?.length} events`)
  check('a bad drain id is refused 400',
    (await req('/api/services', { method: 'POST', token: TOKEN, body: { drainId: 'NOT A SLUG', servicedAt: new Date().toISOString() } })).status === 400)

  /* ------------------------------------------------------------------------
     Complaints.

     RATE-LIMIT BUDGET: the complaint route and the confirm route share a
     6-per-minute limiter, and the six requests below are exactly that budget.
     A second run inside the same minute is refused with a 429 — which is the
     limiter working, not a fault, so it exits 2 with a message that says so
     rather than reporting a puzzling failure.

     The lifecycle and clip sections below do NOT come out of that budget: a
     status move rides the 30/minute write limiter (it is a few hundred bytes on
     the small parser), and a clip upload has its own 2/minute limiter, which is
     exactly the two requests it makes.
     ---------------------------------------------------------------------- */
  section('the complaints board')

  const filed = await req('/api/complaints', {
    method: 'POST',
    token: TOKEN,
    headers: { 'x-reporter-id': REPORTER },
    body: {
      clientId: CLIENT_ID,
      reporterId: REPORTER,
      category: 'waterlogging',
      zoneId: 'shahdara',
      body: 'Smoke test: standing water outside the school on Multan Road since Tuesday.',
      photos: [{ mime: 'image/png', data: TINY_PNG_B64 }],
      lat: LAT,
      lng: LNG,
    },
  })
  if (filed.status === 429) {
    console.error('\nThe complaint rate limit is still warm from a run in the last minute.')
    console.error('That is the limiter doing its job (6 writes a minute). Wait 60s and re-run.')
    process.exit(2)
  }
  check('a complaint with a photo is filed 201', filed.status === 201, `got ${filed.status} ${filed.text}`)
  const complaintId = filed.json?.id
  if (!complaintId) { report(); process.exit(1) }

  const refiled = await req('/api/complaints', {
    method: 'POST',
    token: TOKEN,
    headers: { 'x-reporter-id': REPORTER },
    body: {
      clientId: CLIENT_ID,
      reporterId: REPORTER,
      category: 'waterlogging',
      body: 'Smoke test: standing water outside the school on Multan Road since Tuesday.',
    },
  })
  check('the same complaint refiled is a no-op',
    refiled.status === 200 && refiled.json?.duplicate === true, `got ${refiled.status} ${refiled.text}`)

  const board = await req('/api/complaints?limit=200', { headers: { 'x-reporter-id': REPORTER } })
  const mine = (board.json?.complaints || []).find(c => c.clientId === CLIENT_ID)
  check('the board returns it', Boolean(mine), `clientId ${CLIENT_ID} not in ${board.json?.complaints?.length} rows`)
  // The reporter's device id IS the credential DELETE checks, so the feed must
  // never carry it. This is the assertion that keeps the leak from coming back:
  // it fails on the old query, which selected `reporter_id as "reporterId"`.
  check('and never hands out the reporter id, which is the delete credential',
    Boolean(mine) && !('reporterId' in mine) && mine.isMine === true,
    `reporterId present: ${'reporterId' in (mine || {})}, isMine: ${mine?.isMine}`)
  check('with its photo as an id, never inline bytes',
    Array.isArray(mine?.photoIds) && mine.photoIds.length === 1, JSON.stringify(mine?.photoIds))
  check('and no confirmation yet', mine?.confirmations === 0, String(mine?.confirmations))
  check('the refile did not add a second row',
    (board.json?.complaints || []).filter(c => c.clientId === CLIENT_ID).length === 1)

  // The coordinate round-trip. This is also the schema-migration assertion: an
  // insert naming lat/lng fails outright on a database whose `complaints` table
  // predates those columns, which is exactly the failure the alter-table lines
  // in schema.sql exist to prevent.
  check('the pin is stored, snapped to three decimals', mine?.lat === 31.52 && mine?.lng === 74.358,
    `lat ${mine?.lat} lng ${mine?.lng}`)
  check('and says how precise it is', mine?.locPrecisionM === 111, String(mine?.locPrecisionM))

  const photoId = mine?.photoIds?.[0]
  const photo = await fetch(`${BASE}/api/complaints/photo/${photoId}`)
  const bytes = Buffer.from(await photo.arrayBuffer())
  check('the photo is served 200', photo.status === 200, `got ${photo.status}`)
  check('as the type recorded at insert time, from the bytes not the caller',
    photo.headers.get('content-type') === 'image/png', photo.headers.get('content-type'))
  check('with nosniff, so stored bytes cannot be replayed as HTML',
    photo.headers.get('x-content-type-options') === 'nosniff')
  check('byte-identical to what was sent',
    bytes.equals(Buffer.from(TINY_PNG_B64, 'base64')), `${bytes.length} bytes back`)

  const confirmed = await req(`/api/complaints/${complaintId}/confirm`, {
    method: 'POST',
    body: { deviceId: REPORTER },
  })
  check('a neighbour can back it', confirmed.json?.confirmations === 1 && confirmed.json?.duplicate === false,
    JSON.stringify(confirmed.json))

  // The composite primary key, from the outside: clicking twice cannot inflate
  // the number, and it is not an error either.
  const reconfirmed = await req(`/api/complaints/${complaintId}/confirm`, {
    method: 'POST',
    body: { deviceId: REPORTER },
  })
  check('backing it twice counts once',
    reconfirmed.json?.duplicate === true && reconfirmed.json?.confirmations === 1, JSON.stringify(reconfirmed.json))

  /* ------------------------------------------------------------------------
     The lifecycle. Not out of the complaint budget: these ride the 30/minute
     write limiter, because a status move is a few hundred bytes on the small
     parser and cannot carry image data.
     ---------------------------------------------------------------------- */
  section('the lifecycle')

  const asCrew = (to) => req(`/api/complaints/${complaintId}/status`, {
    method: 'POST', token: TOKEN, body: { to, actorKind: 'crew', actorId: 'crew-1' },
  })
  const asReporter = (to, actorId = REPORTER) => req(`/api/complaints/${complaintId}/status`, {
    method: 'POST', token: TOKEN, body: { to, actorKind: 'reporter', actorId },
  })

  const claimed = await asCrew('acknowledged')
  check('a crew can claim a filed report',
    claimed.status === 201 && claimed.json?.status === 'acknowledged', `got ${claimed.status} ${claimed.text}`)
  check('a crew cannot skip or step backwards', (await asCrew('filed')).status === 409)
  check('a reporter on another device may not move it',
    (await asReporter('resolved', OTHER_DEVICE)).status === 403)
  check('the reporter may say it is fixed', (await asReporter('resolved')).status === 201)
  check('and may say it is happening again', (await asReporter('filed')).status === 201)
  // The honesty core of the feature: a resident putting their own word in the
  // shape of a municipal response is the one move that must not exist.
  check('but a resident may not acknowledge their own report',
    (await asReporter('acknowledged')).status === 409)

  const afterMoves = await req('/api/complaints?limit=200')
  const moved = (afterMoves.json?.complaints || []).find(c => c.clientId === CLIENT_ID)
  check('the board reports the state the log ends in',
    moved?.status === 'filed' && moved?.statusKind === 'reporter',
    JSON.stringify({ status: moved?.status, kind: moved?.statusKind }))
  // A reporter's move records the reporter's OWN device id as `actor_id`, which
  // is the same string `mayDelete` checks — so the feed must not carry it back.
  // A crew id does travel, because a crew slug is a public prototype value the
  // card resolves to a name and not a credential. This check used to assert
  // `statusActor === REPORTER`, i.e. it pinned the leak in place.
  check('and does not carry the reporter back as the actor, which is the delete credential',
    moved?.statusActor === null, `statusActor: ${JSON.stringify(moved?.statusActor)}`)

  /* ------------------------------------------------------------------------
     The clip. Its own 2/minute limiter, and the two POSTs below are the whole
     of that budget — which is why the refusal cases for a clip (a PNG offered
     as a video, an oversize payload) live in src/validate.test.js instead,
     where they cost nothing.
     ---------------------------------------------------------------------- */
  section('an attached clip')

  const clip = await req(`/api/complaints/${complaintId}/video`, {
    method: 'POST', token: TOKEN, body: { mime: 'video/mp4', data: TINY_MP4_B64 },
  })
  check('a clip is attached to the report 201', clip.status === 201, `got ${clip.status} ${clip.text}`)
  check('typed from its own bytes, not from what we said',
    clip.json?.video?.mime === 'video/mp4', String(clip.json?.video?.mime))
  const videoId = clip.json?.video?.id
  if (!videoId) { report(); process.exit(1) }

  // One clip per report, so a retry is a success that changes nothing rather
  // than a replacement — the same reading as every other duplicate here.
  const reupload = await req(`/api/complaints/${complaintId}/video`, {
    method: 'POST', token: TOKEN, body: { mime: 'video/mp4', data: TINY_MP4_B64 },
  })
  check('a second clip for one report is a no-op, not a replacement',
    reupload.status === 200 && reupload.json?.duplicate === true, `got ${reupload.status} ${reupload.text}`)

  const whole = await fetch(`${BASE}/api/complaints/video/${videoId}`)
  const wholeBytes = Buffer.from(await whole.arrayBuffer())
  check('the clip is served 200 to a plain request', whole.status === 200, `got ${whole.status}`)
  check('as the type recorded at insert time',
    whole.headers.get('content-type') === 'video/mp4', whole.headers.get('content-type'))
  check('with nosniff and inline',
    whole.headers.get('x-content-type-options') === 'nosniff'
    && whole.headers.get('content-disposition') === 'inline')
  check('advertising that it takes ranges', whole.headers.get('accept-ranges') === 'bytes')
  check('byte-identical to what was sent', wholeBytes.equals(TINY_MP4), `${wholeBytes.length} bytes back`)

  // Safari's opening move. Answered with a plain 200 it shows nothing at all,
  // which is why this route supports ranges rather than merely allowing them.
  const head = await fetch(`${BASE}/api/complaints/video/${videoId}`, { headers: { range: 'bytes=0-1' } })
  const headBytes = Buffer.from(await head.arrayBuffer())
  check("Safari's first request gets a 206", head.status === 206, `got ${head.status}`)
  check('with Content-Range over the whole file',
    head.headers.get('content-range') === `bytes 0-1/${TINY_MP4.length}`, String(head.headers.get('content-range')))
  // Getting this wrong — sending the file's length — is the classic way a video
  // plays for two seconds and then stalls forever.
  check('and a Content-Length of the RANGE, not the file',
    head.headers.get('content-length') === '2', String(head.headers.get('content-length')))
  check('carrying exactly those two bytes',
    headBytes.length === 2 && headBytes.equals(TINY_MP4.subarray(0, 2)))

  const openEnded = await fetch(`${BASE}/api/complaints/video/${videoId}`, { headers: { range: 'bytes=8-' } })
  check('an open-ended range runs to the end',
    openEnded.status === 206
    && openEnded.headers.get('content-range') === `bytes 8-${TINY_MP4.length - 1}/${TINY_MP4.length}`,
    String(openEnded.headers.get('content-range')))

  const past = await fetch(`${BASE}/api/complaints/video/${videoId}`, {
    headers: { range: `bytes=${TINY_MP4.length + 10}-` },
  })
  check('a range past the end is a 416', past.status === 416, `got ${past.status}`)
  check('with bytes */total, so the client can learn the real size',
    past.headers.get('content-range') === `bytes */${TINY_MP4.length}`, String(past.headers.get('content-range')))

  const wrongDevice = await req(`/api/complaints/${complaintId}`, {
    method: 'DELETE',
    headers: { 'x-reporter-id': OTHER_DEVICE },
  })
  check('another device may not remove it (403)', wrongDevice.status === 403, `got ${wrongDevice.status}`)

  const removed = await req(`/api/complaints/${complaintId}`, {
    method: 'DELETE',
    headers: { 'x-reporter-id': REPORTER },
  })
  check('the device that filed it may', removed.json?.removed === true, removed.text)

  const photoAfter = await fetch(`${BASE}/api/complaints/photo/${photoId}`)
  check('the photo went with it (ON DELETE CASCADE)', photoAfter.status === 404, `got ${photoAfter.status}`)

  const videoAfter = await fetch(`${BASE}/api/complaints/video/${videoId}`)
  check('and so did the clip', videoAfter.status === 404, `got ${videoAfter.status}`)

  section('the fallbacks')
  const missing = await req('/api/does-not-exist')
  check('an unknown route is a JSON 404, not an HTML page', missing.status === 404 && isJson(missing), `got ${missing.status}`)

  report()
}

function report() {
  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) {
    console.error('\nFailures:')
    for (const f of failures) console.error(`  · ${f}`)
    process.exit(1)
  }
  console.log('The HTTP wiring and the SQL both work.')
}

main().catch(err => {
  console.error('\nThe smoke run could not complete:', err?.message || err)
  console.error(`Is the service running at ${BASE}?  (cd server && npm run start:local)`)
  process.exit(2)
})

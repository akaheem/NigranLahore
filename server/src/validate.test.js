/**
 * Tests for the write-path decision logic.
 *
 * Run with `npm test` in this package — Node's built-in runner, no database and
 * no dependencies needed, which is the point of keeping validate.js pure.
 *
 * What this covers: the token gate, field validation, and the coercion that
 * keeps a malformed caller from reaching SQL. What it does not cover: the HTTP
 * wiring and the SQL itself. Those are checked against a live database with the
 * curl commands in `server/README.md` — this package's README, not the project
 * root's, which has no curl at all.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  authorizeWrite, parseServiceEvent,
  sniffImageMime, parseVideoUrl, parsePhoto, parseComplaint, parseConfirmation, mayDelete,
  MAX_PHOTOS, MAX_PHOTO_BYTES, MIN_BODY, MAX_BODY, COMPLAINT_CATEGORIES,
  parseLocation, roundCoordinate, LAHORE_BOUNDS,
  parseStatusChange, mayChangeStatus,
  sniffVideoMime, parseVideoUpload, parseRange,
  MAX_VIDEO_BYTES,
} from './validate.js'

const TOKEN = 'demo-token-abc'

test('authorizeWrite: a matching token is accepted', () => {
  assert.deepEqual(authorizeWrite({ headerToken: TOKEN, configuredToken: TOKEN }), { ok: true })
})

test('authorizeWrite: a wrong or missing token is rejected with 401', () => {
  for (const headerToken of ['nope', '', undefined, null, `${TOKEN} `, TOKEN.slice(0, -1)]) {
    const result = authorizeWrite({ headerToken, configuredToken: TOKEN })
    assert.equal(result.ok, false)
    assert.equal(result.status, 401)
  }
})

test('authorizeWrite: fails CLOSED when no token is configured', () => {
  // The failure that matters. A fresh deploy with DEMO_WRITE_TOKEN unset must
  // refuse every write — not accept every write.
  for (const configuredToken of ['', undefined, null]) {
    const result = authorizeWrite({ headerToken: TOKEN, configuredToken })
    assert.equal(result.ok, false)
    assert.equal(result.status, 503)
  }
  // …and an empty header cannot slip through it either.
  assert.equal(authorizeWrite({ headerToken: '', configuredToken: '' }).ok, false)
})

test('parseServiceEvent: accepts a well-formed real-time service', () => {
  const { ok, event } = parseServiceEvent({
    clientEventId: 's-abc-123',
    drainId: 'd1',
    crewId: 'crew-2',
    servicedAt: '2026-09-19T10:15:00.000Z',
    fillAtService: 91.44,
    simulated: false,
  })
  assert.equal(ok, true)
  assert.equal(event.drainId, 'd1')
  assert.equal(event.crewId, 'crew-2')
  assert.equal(event.simulated, false)
  assert.equal(event.speed, null)
  assert.equal(event.fillAtService, 91.44)
  assert.equal(event.servicedAt.toISOString(), '2026-09-19T10:15:00.000Z')
})

test('parseServiceEvent: carries the simulated flag and the speed', () => {
  const { event } = parseServiceEvent({
    drainId: 'd1', servicedAt: '2026-09-19T10:15:00.000Z', simulated: true, speed: 1440,
  })
  assert.equal(event.simulated, true)
  assert.equal(event.speed, 1440)
})

test('parseServiceEvent: only a literal true counts as simulated', () => {
  // "true", 1 and truthy objects must not be able to mark a row as simulated —
  // and, just as importantly, must not be able to launder a simulated service
  // into the real count.
  for (const value of ['true', 1, {}, [], 'yes']) {
    const { event } = parseServiceEvent({ drainId: 'd1', servicedAt: '2026-09-19T10:15:00.000Z', simulated: value })
    assert.equal(event.simulated, false)
    assert.equal(event.speed, null)
  }
})

test('parseServiceEvent: a speed is only kept for a simulated row', () => {
  const { event } = parseServiceEvent({ drainId: 'd1', servicedAt: '2026-09-19T10:15:00.000Z', speed: 1440 })
  assert.equal(event.speed, null)
})

test('parseServiceEvent: rejects a drain id that is not a short slug', () => {
  for (const drainId of ['', ' ', 'D1', 'd 1', 'd1; drop table service_events', 'x'.repeat(33), null, 42, undefined]) {
    const result = parseServiceEvent({ drainId, servicedAt: '2026-09-19T10:15:00.000Z' })
    assert.equal(result.ok, false, `expected ${JSON.stringify(drainId)} to be rejected`)
    assert.equal(result.status, 400)
  }
  assert.equal(parseServiceEvent({ drainId: 'd8', servicedAt: '2026-09-19T10:15:00.000Z' }).ok, true)
})

test('parseServiceEvent: rejects a servicedAt that is not a timestamp', () => {
  // `null` and the numbers are here on purpose: `new Date(null)` is the epoch
  // and `new Date(0)` is 1970, both perfectly valid Dates. Accepting them would
  // store a real-looking 1970 row and inflate a drain's service count, so the
  // check has to be on the TYPE, not on the parsed result being non-NaN.
  for (const servicedAt of ['', 'yesterday', null, undefined, {}, 0, 7, true, '2026-13-45T99:99:99Z']) {
    const result = parseServiceEvent({ drainId: 'd1', servicedAt })
    assert.equal(result.ok, false, `expected ${JSON.stringify(servicedAt)} to be rejected`)
    assert.equal(result.status, 400)
  }
})

test('parseServiceEvent: treats an absent body as a bad request, not a crash', () => {
  for (const body of [undefined, null, {}, 'nope', 7]) {
    assert.equal(parseServiceEvent(body).ok, false)
  }
})

test('parseServiceEvent: caps lengths and drops empty strings to null', () => {
  const { event } = parseServiceEvent({
    drainId: 'd1',
    servicedAt: '2026-09-19T10:15:00.000Z',
    clientEventId: 'x'.repeat(500),
    crewId: '   ',
  })
  assert.equal(event.clientEventId.length, 128)
  assert.equal(event.crewId, null)
})

test('parseServiceEvent: clamps a nonsense fill level instead of storing it', () => {
  const at = (fillAtService) => parseServiceEvent({ drainId: 'd1', servicedAt: '2026-09-19T10:15:00.000Z', fillAtService }).event.fillAtService
  assert.equal(at(-40), 0)
  assert.equal(at(400), 100)
  assert.equal(at('nonsense'), null)
  assert.equal(at(undefined), null)
})

/* ==========================================================================
   Citizen complaints
   ========================================================================== */

/** The leading bytes of each format we accept, padded past the 12-byte sniff. */
const pngBytes = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0])
const jpegBytes = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0, 0, 0, 0])
const webpBytes = () => Buffer.from([0x52, 0x49, 0x46, 0x46, 0x1a, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4])

const b64 = (buffer) => buffer.toString('base64')

test('sniffImageMime: identifies the three formats we store', () => {
  assert.equal(sniffImageMime(pngBytes()), 'image/png')
  assert.equal(sniffImageMime(jpegBytes()), 'image/jpeg')
  assert.equal(sniffImageMime(webpBytes()), 'image/webp')
})

test('sniffImageMime: refuses anything else, including HTML dressed as an image', () => {
  const cases = [
    Buffer.from('<!doctype html><script>alert(1)</script>'),
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    Buffer.from('GIF89a____________'),      // a real image format we do not accept
    Buffer.alloc(4096, 0),                  // long, but no signature
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),  // a truncated PNG signature
    Buffer.alloc(0),
    null,
  ]
  for (const bytes of cases) {
    assert.equal(sniffImageMime(bytes), null, `expected ${bytes?.length ?? bytes} bytes to be refused`)
  }
})

test('parsePhoto: accepts an image whose bytes match what it claims to be', () => {
  const result = parsePhoto({ mime: 'image/png', data: b64(pngBytes()) })
  assert.equal(result.ok, true)
  assert.equal(result.photo.mime, 'image/png')
  assert.equal(result.photo.byteSize, pngBytes().length)
})

test('parsePhoto: takes the type from the BYTES, not from the caller', () => {
  // No declared mime at all: the stored type still has to be right, because it
  // is what the response Content-Type will be built from later.
  const result = parsePhoto({ data: b64(jpegBytes()) })
  assert.equal(result.ok, true)
  assert.equal(result.photo.mime, 'image/jpeg')
})

test('parsePhoto: refuses bytes whose real type contradicts the declared one', () => {
  const result = parsePhoto({ mime: 'image/png', data: b64(jpegBytes()) })
  assert.equal(result.ok, false)
})

test('parsePhoto: refuses an HTML document labelled as an image', () => {
  // The attack this whole check exists for: the bytes are served back to other
  // people's browsers, so an HTML payload stored as "image/png" is a stored
  // injection waiting for a Content-Type that trusts the label.
  const result = parsePhoto({ mime: 'image/png', data: b64(Buffer.from('<html><script>alert(1)</script></html>')) })
  assert.equal(result.ok, false)
})

test('parsePhoto: refuses data that is not base64 at all', () => {
  for (const data of ['', 'not base64!!', 'AAAA AAAA', 'data:image/png;base64,iVBORw0KGgo=', null, 42]) {
    assert.equal(parsePhoto({ data }).ok, false, `expected ${JSON.stringify(data)} to be refused`)
  }
})

test('parsePhoto: refuses a photo over the byte budget', () => {
  const huge = Buffer.concat([pngBytes(), Buffer.alloc(MAX_PHOTO_BYTES + 1, 7)])
  const result = parsePhoto({ mime: 'image/png', data: b64(huge) })
  assert.equal(result.ok, false)
  assert.match(result.error, /limit/)
})

test('parseVideoUrl: an empty link is fine — the field is optional', () => {
  for (const value of ['', '   ', null, undefined]) {
    const result = parseVideoUrl(value)
    assert.equal(result.ok, true)
    assert.equal(result.url, null)
  }
})

test('parseVideoUrl: accepts the platforms people actually post video to', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=abc123',
    'https://youtu.be/abc123',
    'https://m.youtube.com/watch?v=abc123',
    'https://facebook.com/watch/?v=1',
    'https://fb.watch/abc/',
    'https://vimeo.com/12345',
    'https://streamable.com/abc',
    'https://drive.google.com/file/d/abc/view',
  ]) {
    assert.equal(parseVideoUrl(url).ok, true, `expected ${url} to be accepted`)
  }
})

test('parseVideoUrl: refuses javascript: and data: — the reason the protocol check exists', () => {
  // `new URL()` parses both of these perfectly happily, so a host check alone
  // would never see them.
  for (const url of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://youtube.com/x',
  ]) {
    assert.equal(parseVideoUrl(url).ok, false, `expected ${url} to be refused`)
  }
})

test('parseVideoUrl: refuses hosts that only look like the allowlist', () => {
  for (const url of [
    'https://notyoutube.com/watch?v=1',      // suffix, not a subdomain
    'https://youtube.com.evil.example/x',    // the allowlist name is the subdomain
    'https://evil.example/?next=youtube.com',
    'https://youtube.co/watch?v=1',
    'https://example.com/watch?v=1',
    'not a url at all',
  ]) {
    assert.equal(parseVideoUrl(url).ok, false, `expected ${url} to be refused`)
  }
})

const validComplaint = (overrides = {}) => ({
  clientId: 'c-abc-123',
  reporterId: 'r-abc-123',
  category: 'waterlogging',
  zoneId: 'shahdara',
  body: 'The drain outside the school has been overflowing since Tuesday.',
  photos: [],
  ...overrides,
})

test('parseComplaint: accepts a well-formed complaint', () => {
  const { ok, complaint } = parseComplaint(validComplaint({
    videoUrl: 'https://youtu.be/abc123',
    photos: [{ mime: 'image/png', data: b64(pngBytes()) }],
  }))
  assert.equal(ok, true)
  assert.equal(complaint.category, 'waterlogging')
  assert.equal(complaint.zoneId, 'shahdara')
  assert.equal(complaint.photos.length, 1)
  assert.equal(complaint.videoUrl, 'https://youtu.be/abc123')
})

test('parseComplaint: treats an absent body as a bad request, not a crash', () => {
  for (const body of [undefined, null, {}, 'nope', 7]) {
    const result = parseComplaint(body)
    assert.equal(result.ok, false)
    assert.equal(result.status, 400)
  }
})

test('parseComplaint: refuses a category outside the list', () => {
  for (const category of ['', 'flooding', 'WATERLOGGING', null, 42, 'waterlogging; drop table complaints']) {
    const result = parseComplaint(validComplaint({ category }))
    assert.equal(result.ok, false, `expected ${JSON.stringify(category)} to be refused`)
    assert.equal(result.status, 400)
  }
  for (const category of COMPLAINT_CATEGORIES) {
    assert.equal(parseComplaint(validComplaint({ category })).ok, true, `expected ${category} to be accepted`)
  }
})

test('parseComplaint: enforces the body length on both ends', () => {
  assert.equal(parseComplaint(validComplaint({ body: 'x'.repeat(MIN_BODY - 1) })).ok, false)
  assert.equal(parseComplaint(validComplaint({ body: 'x'.repeat(MIN_BODY) })).ok, true)
  assert.equal(parseComplaint(validComplaint({ body: 'x'.repeat(MAX_BODY) })).ok, true)
  assert.equal(parseComplaint(validComplaint({ body: 'x'.repeat(MAX_BODY + 1) })).ok, false)
  // Whitespace does not count towards the minimum — a complaint of twelve
  // spaces says nothing.
  assert.equal(parseComplaint(validComplaint({ body: ' '.repeat(40) })).ok, false)
})

test('parseComplaint: requires a reporter id, and one shaped like a slug', () => {
  for (const reporterId of ['', '   ', 'R-ABC', 'r abc', null, 42, 'x'.repeat(65)]) {
    assert.equal(parseComplaint(validComplaint({ reporterId })).ok, false)
  }
})

test('parseComplaint: a zone is optional, but a bad one is refused', () => {
  // Someone may genuinely not know which zone they are in; the field is theirs
  // to leave blank. A zone id that is not one of ours is a different thing.
  assert.equal(parseComplaint(validComplaint({ zoneId: '' })).complaint.zoneId, null)
  assert.equal(parseComplaint(validComplaint({ zoneId: null })).complaint.zoneId, null)
  assert.equal(parseComplaint(validComplaint({ zoneId: 'Shahdara Zone 4' })).ok, false)
})

test('parseComplaint: refuses more photos than the limit', () => {
  const photo = { mime: 'image/png', data: b64(pngBytes()) }
  const at = (n) => parseComplaint(validComplaint({ photos: Array.from({ length: n }, () => photo) }))
  assert.equal(at(MAX_PHOTOS).ok, true)
  assert.equal(at(MAX_PHOTOS + 1).ok, false)
})

test('parseComplaint: one bad photo refuses the whole complaint', () => {
  // Storing the good photos and dropping the bad one would file a report whose
  // evidence is silently incomplete — the worst outcome for a feature whose
  // entire value is the evidence.
  const result = parseComplaint(validComplaint({
    photos: [
      { mime: 'image/png', data: b64(pngBytes()) },
      { mime: 'image/png', data: b64(Buffer.from('<html>not an image</html>')) },
    ],
  }))
  assert.equal(result.ok, false)
})

test('parseComplaint: caps a clientId and drops an empty one to null', () => {
  assert.equal(parseComplaint(validComplaint({ clientId: 'x'.repeat(500) })).complaint.clientId.length, 128)
  assert.equal(parseComplaint(validComplaint({ clientId: '   ' })).complaint.clientId, null)
})

test('parseConfirmation: needs a device id shaped like a slug', () => {
  assert.equal(parseConfirmation({ deviceId: 'r-abc-123' }).ok, true)
  for (const deviceId of ['', '   ', 'R-ABC', null, undefined, 42, 'x'.repeat(65)]) {
    assert.equal(parseConfirmation({ deviceId }).ok, false)
  }
  for (const body of [undefined, null, 'nope', 7]) {
    assert.equal(parseConfirmation(body).ok, false)
  }
})

test('mayDelete: only the device that filed a complaint may remove it', () => {
  assert.equal(mayDelete({ reporterId: 'r-a', ownerId: 'r-a' }).ok, true)

  const missingHeader = mayDelete({ reporterId: null, ownerId: 'r-a' })
  assert.equal(missingHeader.ok, false)
  assert.equal(missingHeader.status, 401)

  const someoneElse = mayDelete({ reporterId: 'r-b', ownerId: 'r-a' })
  assert.equal(someoneElse.ok, false)
  assert.equal(someoneElse.status, 403)

  // A complaint that is not there is a 404, not a 403: telling a caller that a
  // complaint exists but is not theirs is information they have not earned.
  const gone = mayDelete({ reporterId: 'r-a', ownerId: null })
  assert.equal(gone.ok, false)
  assert.equal(gone.status, 404)
})

/* ==========================================================================
   The one change to existing behaviour, guarded

   The complaints routes need a 4mb body parser because they carry photographs.
   The service log must keep its 16kb one. That is the only edit in this whole
   feature that could regress a live route, and it is a WIRING property, not a
   pure one — `validate.js` has no opinion about it, and asserting it through a
   real request would mean installing express and a database, which is exactly
   what this suite exists to avoid.

   So it is asserted against the source. That is a blunt instrument, and it is
   honest about what it proves: not that the parser behaves correctly, but that
   nobody has attached the media parser to the service route or hoisted a JSON
   parser back into a global `app.use`.
   ========================================================================== */

const indexSource = readFileSync(new URL('./index.js', import.meta.url), 'utf8')

test('the service route keeps the small parser, and the media parser stays off it', () => {
  assert.match(indexSource, /app\.post\(\s*'\/api\/services'\s*,\s*jsonSmall\b/,
    'POST /api/services must be mounted with jsonSmall — the 16kb ceiling it had before complaints existed')
  assert.doesNotMatch(indexSource, /app\.post\(\s*'\/api\/services'[^)]*jsonMedia/,
    'the 4mb media parser must never be attached to the service log')
})

test('no JSON body parser is mounted globally', () => {
  // `app.use(express.json(...))` anywhere would run before the route's own
  // parser and 413 a photo request before the complaints route ever saw it —
  // and, worse, would silently change the service log's ceiling.
  assert.doesNotMatch(indexSource, /app\.use\(\s*express\.json/,
    'body parsers must stay per-route-group; a global one breaks the complaints upload path')
  assert.match(indexSource, /const jsonSmall = express\.json\(\{ limit: '16kb' \}\)/)
})

test('the 36mb parser is mounted on the video route and nowhere else', () => {
  assert.match(indexSource, /app\.post\(\s*'\/api\/complaints\/:id\/video'\s*,\s*jsonVideo\b/,
    'the clip upload must carry jsonVideo — it is the only route that may see 33 MB')
  assert.match(indexSource, /const jsonVideo = express\.json\(\{ limit: '36mb' \}\)/)
  // The complaint route must keep its 4mb ceiling, or a 25 MB clip would be
  // able to take the citizen's words down with it when the upload failed.
  assert.match(indexSource, /app\.post\(\s*'\/api\/complaints'\s*,\s*jsonMedia\b/)
  assert.doesNotMatch(indexSource, /app\.post\(\s*'\/api\/complaints'[^)]*jsonVideo/,
    'the complaint route must never carry the video parser')
})

test('a status move rides the write limiter, not the complaint budget', () => {
  // The 6/minute complaint limit exists because a complaint carries megabytes
  // of photographs. A status move is a few hundred bytes on jsonSmall and can
  // carry none — sharing that budget would let a crew working through reports
  // spend a citizen's ability to file one.
  assert.match(indexSource, /app\.post\(\s*'\/api\/complaints\/:id\/status'\s*,\s*jsonSmall\s*,\s*writeLimit\b/)
  assert.doesNotMatch(indexSource, /app\.post\(\s*'\/api\/complaints\/:id\/status'[^)]*complaintLimit/)
})

test('the clip route has a tighter limiter of its own', () => {
  assert.match(indexSource, /app\.post\(\s*'\/api\/complaints\/:id\/video'\s*,\s*jsonVideo\s*,\s*videoLimit\b/)
  // Anchored inside the object literal, so this cannot be satisfied by some
  // other limiter's `limit: 2` further down the file.
  assert.match(indexSource, /const videoLimit = rateLimit\(\{[^}]*?limit: 2,/)
})

/* ==========================================================================
   Where a report is

   A pin is opt-in and rounded to ~111 m before it is stored. The rounding is
   done in the browser so the person sees the figure that will be kept, and
   again here because the server cannot know the browser did it — the same
   reason parsePhoto re-sniffs bytes rather than trusting a declared type.
   ========================================================================== */

test('roundCoordinate: snaps to three decimals and refuses what is not a number', () => {
  assert.equal(roundCoordinate(31.5204123), 31.52)
  assert.equal(roundCoordinate(74.3581234), 74.358)
  // Idempotent: the second rounding must not move a pin the first one snapped.
  assert.equal(roundCoordinate(roundCoordinate(31.5204123)), 31.52)
  // Number(null) and Number('') are both 0, which would put a report at (0,0).
  for (const bad of [null, undefined, '', '31.52', NaN, Infinity, -Infinity, {}]) {
    assert.equal(roundCoordinate(bad), null, `${String(bad)} must not become a coordinate`)
  }
  assert.equal(roundCoordinate(0), 0)
})

test('parseLocation: keeps a pair inside Lahore, rounded', () => {
  assert.deepEqual(parseLocation({ lat: 31.5204123, lng: 74.3581234 }),
    { lat: 31.52, lng: 74.358, precisionM: 111 })
})

test('parseLocation: DROPS a pair outside Lahore rather than refusing the report', () => {
  // A report with a bad pin is still a report worth having, so this is not a
  // validation failure — it is a missing field. Refusing the whole complaint
  // would trade somebody's words for a coordinate they never had to give.
  for (const pair of [
    { lat: 0, lng: 0 },
    { lat: 51.5, lng: -0.12 },
    { lat: LAHORE_BOUNDS.maxLat + 0.01, lng: 74.3 },
    { lat: 31.5, lng: LAHORE_BOUNDS.minLng - 0.01 },
  ]) {
    assert.deepEqual(parseLocation(pair), { lat: null, lng: null, precisionM: null })
  }
})

test('parseLocation: drops a half-set pair, which is not a place', () => {
  assert.deepEqual(parseLocation({ lat: 31.52 }), { lat: null, lng: null, precisionM: null })
  assert.deepEqual(parseLocation({ lng: 74.358 }), { lat: null, lng: null, precisionM: null })
  assert.deepEqual(parseLocation({}), { lat: null, lng: null, precisionM: null })
  assert.deepEqual(parseLocation(), { lat: null, lng: null, precisionM: null })
})

test('parseComplaint: carries the location through, and a report without one still files', () => {
  const withPin = parseComplaint({
    reporterId: 'r-a', category: 'waterlogging',
    body: 'Standing water outside the school since Tuesday.',
    lat: 31.5204123, lng: 74.3581234,
  })
  assert.equal(withPin.ok, true)
  assert.equal(withPin.complaint.lat, 31.52)
  assert.equal(withPin.complaint.precisionM, 111)

  const without = parseComplaint({
    reporterId: 'r-a', category: 'waterlogging',
    body: 'Standing water outside the school since Tuesday.',
  })
  assert.equal(without.ok, true)
  assert.equal(without.complaint.lat, null)
  assert.equal(without.complaint.precisionM, null)
})

/* ==========================================================================
   The lifecycle

   The split is the honesty core of the feature: a crew claims WORK, a resident
   claims OBSERVATION. A citizen may not acknowledge their own report, because
   that would put their word in the shape of a municipal response.
   ========================================================================== */

const move = (over = {}) => ({ to: 'acknowledged', actorKind: 'crew', actorId: 'crew-1', ...over })

test('parseStatusChange: accepts a well-formed move', () => {
  const { ok, change } = parseStatusChange(move({ note: 'Crew on the way.' }))
  assert.equal(ok, true)
  assert.equal(change.to, 'acknowledged')
  assert.equal(change.actorKind, 'crew')
  assert.equal(change.actorId, 'crew-1')
  assert.equal(change.note, 'Crew on the way.')
})

test('parseStatusChange: refuses a state that is not one of the four', () => {
  for (const to of ['', 'closed', 'RESOLVED', 'in progress', null, 7]) {
    const result = parseStatusChange(move({ to }))
    assert.equal(result.ok, false, `${String(to)} must be refused`)
    assert.equal(result.status, 400)
  }
})

test('parseStatusChange: refuses an actor kind that is not reporter or crew', () => {
  for (const actorKind of ['', 'admin', 'Crew', null]) {
    assert.equal(parseStatusChange(move({ actorKind })).ok, false)
  }
})

test('parseStatusChange: refuses an actor id that could not be a device or crew slug', () => {
  for (const actorId of ['', 'NOT A SLUG', '../../etc', 'a'.repeat(70), null]) {
    assert.equal(parseStatusChange(move({ actorId })).ok, false, `${String(actorId)} must be refused`)
  }
})

test('mayChangeStatus: a crew walks the work column', () => {
  const at = (from, to) => mayChangeStatus({ actorKind: 'crew', actorId: 'crew-1', ownerId: 'r-a', from, to })
  assert.equal(at('filed', 'acknowledged').ok, true)
  assert.equal(at('acknowledged', 'in-progress').ok, true)
  assert.equal(at('in-progress', 'resolved').ok, true)
})

test('mayChangeStatus: a crew cannot skip a step or step backwards', () => {
  for (const [from, to] of [['filed', 'resolved'], ['filed', 'in-progress'], ['acknowledged', 'filed'], ['resolved', 'filed']]) {
    const result = mayChangeStatus({ actorKind: 'crew', actorId: 'crew-1', ownerId: 'r-a', from, to })
    assert.equal(result.ok, false, `crew ${from} → ${to} must be refused`)
    // 409 rather than 400: the request is well formed and merely disagrees with
    // the state the report is actually in, which is what a client retrying
    // against a stale copy needs to be told.
    assert.equal(result.status, 409)
  }
})

test('mayChangeStatus: the reporter may say it is fixed, and that it is back', () => {
  const at = (from, to) => mayChangeStatus({ actorKind: 'reporter', actorId: 'r-a', ownerId: 'r-a', from, to })
  for (const from of ['filed', 'acknowledged', 'in-progress']) {
    assert.equal(at(from, 'resolved').ok, true)
  }
  assert.equal(at('resolved', 'filed').ok, true)
})

test('mayChangeStatus: a resident cannot acknowledge their own report', () => {
  // The one move that must not exist: "acknowledged" is a municipal response,
  // and a citizen asserting one is exactly the confusion this feature exists to
  // avoid.
  const result = mayChangeStatus({ actorKind: 'reporter', actorId: 'r-a', ownerId: 'r-a', from: 'filed', to: 'acknowledged' })
  assert.equal(result.ok, false)
  assert.equal(result.status, 409)
})

test('mayChangeStatus: a reporter move must come from the device that filed it', () => {
  const result = mayChangeStatus({ actorKind: 'reporter', actorId: 'r-someone-else', ownerId: 'r-a', from: 'filed', to: 'resolved' })
  assert.equal(result.ok, false)
  assert.equal(result.status, 403)
})

test('mayChangeStatus: an unknown actor kind is a 400, not a silent allow', () => {
  for (const actorKind of ['', 'admin', null, undefined]) {
    const result = mayChangeStatus({ actorKind, actorId: 'x', ownerId: 'x', from: 'filed', to: 'resolved' })
    assert.equal(result.ok, false)
    assert.equal(result.status, 400)
  }
})

/* ==========================================================================
   Attached clips

   The stated trade: 25 MB of video in a bytea column. These tests are what keep
   the cap enforced on the SERVER rather than only in the browser — the client
   refuses first, with a readable message, but a cap that depends on the client
   being honest is not a cap.
   ========================================================================== */

/** An ISO-BMFF header: a box size, then `ftyp` at offset 4. Not playable —
 *  the sniffer reads eight bytes, and this is what those eight bytes are. */
const mp4Header = () => Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftyp', 'ascii'),
  Buffer.from('isom', 'ascii'),
  Buffer.alloc(8, 0x21),
])

test('sniffVideoMime: identifies the two containers we store, and only those', () => {
  assert.equal(sniffVideoMime(mp4Header()), 'video/mp4')
  assert.equal(sniffVideoMime(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.alloc(16)])), 'video/webm')
})

test('sniffVideoMime: refuses a PNG offered as a video', () => {
  // The bytes are served back to other people's browsers under whatever type we
  // record, so the type has to come from the file and not from the caller.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64')
  assert.equal(sniffVideoMime(png), null)
  assert.equal(sniffVideoMime(Buffer.from('ftyp but not at offset four')), null)
  assert.equal(sniffVideoMime(Buffer.alloc(4)), null, 'too short to make any claim about')
  assert.equal(sniffVideoMime(null), null)
})

test('parseVideoUpload: accepts a clip, typed by its own bytes', () => {
  const header = mp4Header()
  const { ok, video } = parseVideoUpload({ data: header.toString('base64') })
  assert.equal(ok, true)
  assert.equal(video.mime, 'video/mp4')
  assert.equal(video.byteSize, header.length)
})

test('parseVideoUpload: a declared type that disagrees with the bytes is a 400', () => {
  const result = parseVideoUpload({ mime: 'video/webm', data: mp4Header().toString('base64') })
  assert.equal(result.ok, false)
  assert.equal(result.status, 400)
})

test('parseVideoUpload: no declared type is fine — the sniffer decides', () => {
  // What the client sends for an iPhone .mov, which the browser calls
  // video/quicktime while the bytes are ISO-BMFF.
  assert.equal(parseVideoUpload({ mime: null, data: mp4Header().toString('base64') }).ok, true)
  assert.equal(parseVideoUpload({ mime: '', data: mp4Header().toString('base64') }).ok, true)
})

test('parseVideoUpload: refuses an oversize payload on the STRING, before decoding it', () => {
  // The ordering is the whole point: decoding first would inflate ~33 MB into
  // memory on the way to refusing it, which is the memory cost this cap exists
  // to bound. Valid base64 characters, simply too many of them.
  const oversize = 'A'.repeat(Math.ceil((MAX_VIDEO_BYTES * 4) / 3) + 16)
  const result = parseVideoUpload({ data: oversize })
  assert.equal(result.ok, false)
  assert.equal(result.status, 413)
})

test('parseVideoUpload: refuses what is not base64, without decoding it', () => {
  for (const data of ['not base64 at all!', 'AAAA AAAA', '<script>alert(1)</script>', '====']) {
    const result = parseVideoUpload({ data })
    assert.equal(result.ok, false, `${data} must be refused`)
    assert.equal(result.status, 400)
  }
})

test('parseVideoUpload: refuses an empty or missing payload', () => {
  for (const body of [{}, { data: '' }, { data: 7 }, { data: null }]) {
    assert.equal(parseVideoUpload(body).ok, false)
  }
  assert.equal(parseVideoUpload().ok, false)
  assert.equal(parseVideoUpload(null).ok, false)
})

/* ==========================================================================
   Range requests

   Not an optimisation. Safari sends `Range: bytes=0-1` before it will play
   anything at all, so a route that answers only 200 serves no video to a large
   share of iPhones — which is the phone most likely to be holding the clip.
   ========================================================================== */

test('parseRange: no header means serve the whole thing', () => {
  assert.deepEqual(parseRange(undefined, 100), { kind: 'none' })
  assert.deepEqual(parseRange('', 100), { kind: 'none' })
  assert.deepEqual(parseRange('   ', 100), { kind: 'none' })
})

test('parseRange: the opening bytes=0-1 is a satisfiable range', () => {
  assert.deepEqual(parseRange('bytes=0-1', 100), { kind: 'ok', start: 0, end: 1 })
})

test('parseRange: a closed range, an open-ended one, and one that runs past the end', () => {
  assert.deepEqual(parseRange('bytes=10-20', 100), { kind: 'ok', start: 10, end: 20 })
  assert.deepEqual(parseRange('bytes=10-', 100), { kind: 'ok', start: 10, end: 99 })
  // Clamped rather than refused: an end past the file is a client asking for
  // "to the end" in a clumsy way.
  assert.deepEqual(parseRange('bytes=90-1000', 100), { kind: 'ok', start: 90, end: 99 })
  assert.deepEqual(parseRange('bytes=99-99', 100), { kind: 'ok', start: 99, end: 99 })
})

test('parseRange: a suffix range is the LAST n bytes, not the first', () => {
  // The other thing Safari sends, when it seeks to the end of a clip.
  assert.deepEqual(parseRange('bytes=-500', 1000), { kind: 'ok', start: 500, end: 999 })
  // A suffix longer than the file is the whole file, not a negative offset.
  assert.deepEqual(parseRange('bytes=-5000', 1000), { kind: 'ok', start: 0, end: 999 })
})

test('parseRange: a start at or past the end is unsatisfiable, not empty', () => {
  // 416 with `bytes */total` is how a player learns the real size.
  assert.deepEqual(parseRange('bytes=500-600', 100), { kind: 'unsatisfiable' })
  assert.deepEqual(parseRange('bytes=0-0', 0), { kind: 'unsatisfiable' })
  // An OPEN-ENDED range past the end is unsatisfiable, not invalid: it is a
  // well-formed request the file cannot satisfy, and it is the ordinary shape
  // of a player seeking beyond a clip it has already fetched. A reversed range
  // is the genuinely malformed one, and stays invalid.
  assert.deepEqual(parseRange('bytes=100-', 100), { kind: 'unsatisfiable' })
  assert.deepEqual(parseRange('bytes=500-', 100), { kind: 'unsatisfiable' })
  assert.deepEqual(parseRange('bytes=20-10', 100), { kind: 'invalid' })
})

test('parseRange: a malformed or reversed range is invalid, never a guess', () => {
  for (const header of [
    'bytes=', 'bytes=-', 'bytes=abc-def', 'bytes=20-10', 'items=0-1',
    'bytes=0-1,5-6', 'bytes=0-1 extra',
  ]) {
    assert.deepEqual(parseRange(header, 100), { kind: 'invalid' }, `${header} must not be guessed at`)
  }
})

test('parseRange: a multi-range request is refused rather than half-answered', () => {
  // Answering it properly needs a multipart/byteranges body; replying with only
  // the first range would be a silent lie about what was sent.
  assert.deepEqual(parseRange('bytes=0-1,5-6', 100), { kind: 'invalid' })
})

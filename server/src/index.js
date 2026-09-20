/**
 * The shared drain service log — a small Express service over Postgres.
 *
 * This exists so that "serviced 4×" means something beyond one browser's
 * private history. It is deliberately the *only* thing the backend does: the
 * app, the risk engine and the fill model are all client-side and stay that
 * way. With VITE_API_BASE_URL unset the frontend never calls this service and
 * behaves exactly as it did before it existed.
 *
 * ## What the write token is, and is not
 *
 * POSTs carry an `x-demo-token` header that must match DEMO_WRITE_TOKEN. That
 * token ships inside the browser bundle — anyone who opens devtools can read
 * it — so it is NOT authentication and NOT access control. It is a spam gate:
 * it keeps a crawler or a curious passer-by from filling the table with junk.
 *
 * Because it is not a security boundary, the protections that matter here are
 * the ones that hold even when the token is known:
 *   - reads expose nothing but drain ids and timestamps,
 *   - writes are rate-limited per IP,
 *   - inserted rows are validated and length-capped,
 *   - the token fails CLOSED: with DEMO_WRITE_TOKEN unset, every write is
 *     refused rather than every write allowed.
 *
 * Configuration (all via environment):
 *   DATABASE_URL        Postgres connection string. Absent → reads and writes
 *                       report 503 and the app falls back to local-only.
 *   DEMO_WRITE_TOKEN    Shared token required on POST. Absent → writes refused.
 *   ALLOWED_ORIGINS     Comma-separated browser origins for CORS. Vercel
 *                       production URL plus localhost in development.
 *   PORT                Defaults to 3000.
 */

import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import {
  hasDatabase, ensureSchema, insertServiceEvent, listServiceEvents, serviceSummary,
  insertComplaint, listComplaints, getComplaintPhoto,
  confirmComplaint, getComplaintOwner, deleteComplaint,
  getComplaintForStatus, insertComplaintEvent,
  insertComplaintVideo, getComplaintVideoMeta, getComplaintVideoChunk,
} from './db.js'
import {
  authorizeWrite, parseServiceEvent,
  parseComplaint, parseConfirmation, mayDelete,
  parseStatusChange, mayChangeStatus,
  parseVideoUpload, parseRange,
} from './validate.js'

const PORT = Number(process.env.PORT) || 3000
const WRITE_TOKEN = process.env.DEMO_WRITE_TOKEN || ''

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:4173')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const app = express()

// Render terminates TLS one hop in front of this process, so without this every
// request looks like it came from the proxy — which would make the rate limit
// below either useless or fatal. A hop COUNT rather than `true` on purpose:
// trusting the header outright would let a caller forge X-Forwarded-For and
// slip past the limit entirely.
app.set('trust proxy', 1)

/**
 * Three body parsers, attached per route group rather than globally.
 *
 * The service log needs a 16kb ceiling — its events are a few hundred bytes and
 * a tight cap is free protection. Complaints carry photographs, which cannot
 * fit through 16kb at all. A video clip is a different order of thing again,
 * and is deliberately kept OFF the complaint route.
 *
 * These MUST be mounted individually instead of one small parser globally plus
 * a larger one where it is needed: a global parser runs first and would reject
 * a photo-laden — or clip-laden — request with a 413 before the route that
 * wanted it ever saw it. Splitting them is what keeps the service log's
 * existing ceiling exactly as it was, which is the only behaviour here that
 * could regress.
 */
const jsonSmall = express.json({ limit: '16kb' })
// 3 photos at 600KB is 1.8MB of bytes, ~2.4MB once base64 has added its third.
const jsonMedia = express.json({ limit: '4mb' })
// 25MB of video is ~33.4MB once base64 has added its third; the slack covers a
// small field or two beside it. Mounted on the video route ONLY — a report must
// never be able to carry a clip, or one oversized upload would take the
// citizen's words down with it.
const jsonVideo = express.json({ limit: '36mb' })

app.use(cors({
  origin(origin, callback) {
    // No Origin header: curl, a health check, or a same-origin request. These
    // are not browser cross-origin calls, so CORS does not apply to them.
    if (!origin) return callback(null, true)
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true)
    return callback(null, false)
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['content-type', 'x-demo-token', 'x-reporter-id'],
  maxAge: 86400,
}))

/** Reads are open: they expose drain ids, crew ids and timestamps, nothing else. */
const readLimit = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
})

/** Writes are the expensive, abusable ones — and the only ones that mutate. */
const writeLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too many services recorded from this address — wait a minute' },
})

/**
 * Complaints are limited far harder than services, because each one can carry
 * megabytes of image data. Thirty of those a minute is a memory-exhaustion
 * vector on a small instance even though it is fine for 200-byte events.
 */
const complaintLimit = rateLimit({
  windowMs: 60_000,
  limit: 6,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too many complaints filed from this address — wait a minute' },
})

/**
 * Video uploads get their own, much tighter limiter — two a minute.
 *
 * Not because a clip is twenty times more abusive than a complaint, but because
 * of what one request holds at once: a 33 MB base64 string, a 25 MB buffer, and
 * a row being written, on an instance with a few hundred megabytes to share.
 * Six of those in a minute is how a small deployment falls over. The ceiling is
 * the user's chosen trade (25 MB per clip); this is the part that keeps it from
 * being a denial-of-service vector as well.
 */
const videoLimit = rateLimit({
  windowMs: 60_000,
  limit: 2,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too many video uploads from this address — wait a minute' },
})

app.get('/health', (_req, res) => {
  res.json({ ok: true, database: hasDatabase, writesEnabled: Boolean(WRITE_TOKEN) })
})

app.get('/api/services', readLimit, async (req, res) => {
  if (!hasDatabase) return res.status(503).json({ error: 'no database configured' })
  try {
    const events = await listServiceEvents({
      drainId: typeof req.query.drainId === 'string' ? req.query.drainId : null,
      limit: req.query.limit,
    })
    res.json({ events })
  } catch (err) {
    console.error('GET /api/services failed', err)
    res.status(500).json({ error: 'could not read the service log' })
  }
})

app.get('/api/services/summary', readLimit, async (_req, res) => {
  if (!hasDatabase) return res.status(503).json({ error: 'no database configured' })
  try {
    res.json({ drains: await serviceSummary() })
  } catch (err) {
    console.error('GET /api/services/summary failed', err)
    res.status(500).json({ error: 'could not read the service summary' })
  }
})

app.post('/api/services', jsonSmall, writeLimit, async (req, res) => {
  // The order matters: an unconfigured token must never mean "open to the
  // world", so authorization is settled before the body is even looked at.
  const auth = authorizeWrite({ headerToken: req.get('x-demo-token'), configuredToken: WRITE_TOKEN })
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
  if (!hasDatabase) return res.status(503).json({ error: 'no database configured' })

  const parsed = parseServiceEvent(req.body)
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error })

  try {
    const row = await insertServiceEvent(parsed.event)
    // `duplicate: true` is a success, not a conflict: the client's retry landed
    // on an event the log already holds, which is exactly what should happen.
    res.status(row ? 201 : 200).json({ event: row, duplicate: !row })
  } catch (err) {
    console.error('POST /api/services failed', err)
    res.status(500).json({ error: 'could not record the service' })
  }
})

/* ==========================================================================
   Citizen complaints — the board
   ========================================================================== */

/**
 * The feed. Never returns image bytes: a `photoIds` array only, and each image
 * is fetched from its own URL. Inlining them would put tens of megabytes on
 * every board load.
 */
app.get('/api/complaints', readLimit, async (req, res) => {
  if (!hasDatabase) return res.status(503).json({ error: 'no database configured' })
  try {
    // The same header the delete route uses: it is the same device id, and
    // giving one concept two names is how a CORS preflight ends up rejecting a
    // header nobody remembered to allow.
    const deviceId = req.get('x-reporter-id') || null
    const complaints = await listComplaints({
      deviceId,
      zoneId: typeof req.query.zoneId === 'string' && req.query.zoneId ? req.query.zoneId : null,
      limit: req.query.limit,
      sort: req.query.sort === 'confirmed' ? 'confirmed' : 'recent',
    })
    res.json({ complaints })
  } catch (err) {
    console.error('GET /api/complaints failed', err)
    res.status(500).json({ error: 'could not read the complaints board' })
  }
})

/**
 * One photo's bytes.
 *
 * The Content-Type is the one WE recorded at insert time — already checked
 * against the allowlist and against the file's magic bytes — never anything the
 * caller sends now. Paired with `nosniff`, that is what stops stored bytes being
 * replayed to another browser as HTML.
 *
 * `immutable` is honest here: a photo belongs to a complaint and is never
 * edited, so it is safe to cache for a year.
 */
app.get('/api/complaints/photo/:id', readLimit, async (req, res) => {
  if (!hasDatabase) return res.status(503).json({ error: 'no database configured' })
  try {
    const photo = await getComplaintPhoto(req.params.id)
    if (!photo) return res.status(404).json({ error: 'photo not found' })
    res.set({
      'Content-Type': photo.mime,
      'Content-Length': String(photo.byteSize),
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
    res.send(photo.bytes)
  } catch (err) {
    console.error('GET /api/complaints/photo failed', err)
    res.status(500).json({ error: 'could not read the photo' })
  }
})

app.post('/api/complaints', jsonMedia, complaintLimit, async (req, res) => {
  const auth = authorizeWrite({ headerToken: req.get('x-demo-token'), configuredToken: WRITE_TOKEN })
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
  if (!hasDatabase) return res.status(503).json({ error: 'no database configured' })

  const parsed = parseComplaint(req.body)
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error })

  try {
    const { id, duplicate } = await insertComplaint(parsed.complaint)
    res.status(duplicate ? 200 : 201).json({ id, duplicate })
  } catch (err) {
    console.error('POST /api/complaints failed', err)
    res.status(500).json({ error: 'could not file the complaint' })
  }
})

/**
 * "Me too". No token: confirming is the one write we want to be frictionless,
 * and the composite primary key means the worst a spammer achieves is one row
 * per device id. Rate limiting is what keeps that honest.
 */
app.post('/api/complaints/:id/confirm', jsonSmall, complaintLimit, async (req, res) => {
  if (!hasDatabase) return res.status(503).json({ error: 'no database configured' })

  const parsed = parseConfirmation(req.body)
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error })

  try {
    const result = await confirmComplaint({ complaintId: req.params.id, deviceId: parsed.deviceId })
    if (!result.ok) return res.status(404).json({ error: 'complaint not found' })
    // A second confirmation from the same device is a no-op, not an error.
    res.json({ duplicate: result.duplicate, confirmations: result.confirmations })
  } catch (err) {
    console.error('POST /api/complaints/:id/confirm failed', err)
    res.status(500).json({ error: 'could not record the confirmation' })
  }
})

/**
 * Move a report along its lifecycle.
 *
 * Token-gated, unlike confirming: a confirmation is one row that anyone may
 * add once, but a status change writes to a record of what happened to
 * somebody's report, and it is the shape a municipal response takes on screen.
 * The gate is the same spam gate as everywhere else — the token ships in the
 * bundle — so what actually bounds this is the transition table in
 * `mayChangeStatus`, which no caller can step outside of.
 *
 * It rides `writeLimit`, not `complaintLimit`. The hard complaint limit exists
 * because a complaint can carry megabytes of photographs; this route is on
 * `jsonSmall` and cannot carry any. Sharing that budget would let a crew working
 * through reports spend a citizen's ability to file one — and would mean six
 * status moves a minute was the ceiling for a whole office behind one address.
 * An event row is the same order of thing as a service event, so it gets the
 * same ceiling.
 *
 * 409 rather than 400 when the report has moved since the caller read it: the
 * request was well formed and merely disagrees with the present state, and a
 * client retrying against a stale copy needs exactly that distinction. The
 * body carries the status it is actually in now, so the client can correct
 * itself without a second read.
 */
app.post('/api/complaints/:id/status', jsonSmall, writeLimit, async (req, res) => {
  const auth = authorizeWrite({ headerToken: req.get('x-demo-token'), configuredToken: WRITE_TOKEN })
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
  if (!hasDatabase) return res.status(503).json({ error: 'no database configured' })

  const parsed = parseStatusChange(req.body)
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error })

  const { to, actorKind, actorId, note } = parsed.change

  try {
    const row = await getComplaintForStatus(req.params.id)
    if (!row) return res.status(404).json({ error: 'complaint not found' })

    const allowed = mayChangeStatus({ actorKind, actorId, ownerId: row.reporterId, from: row.status, to })
    if (!allowed.ok) return res.status(allowed.status).json({ error: allowed.error, status: row.status })

    const result = await insertComplaintEvent({
      complaintId: req.params.id, from: row.status, to, actorKind, actorId, note,
    })

    if (!result.ok) {
      // It is already where the caller wanted it. They asked for this state and
      // this is the state, so it is a success — the same reading of "duplicate"
      // as the service log and the confirmation count.
      if (result.reason === 'noop') return res.json({ status: result.current, duplicate: true })
      if (result.reason === 'stale') {
        return res.status(409).json({ error: `the report is now ${result.current}`, status: result.current })
      }
      return res.status(404).json({ error: 'complaint not found' })
    }

    res.status(201).json({ status: result.event.to, event: result.event })
  } catch (err) {
    console.error('POST /api/complaints/:id/status failed', err)
    res.status(500).json({ error: 'could not record the status change' })
  }
})

/**
 * A clip's bytes, whole or in part.
 *
 * ## Why this supports Range
 *
 * Because Safari will not play a video without it. It sends `Range: bytes=0-1`
 * and waits for a 206 before it will start; answered with a plain 200 it shows
 * nothing. So a route that only serves whole files serves no video at all to a
 * large share of iPhones, which is the phone most likely to be holding the
 * clip in the first place.
 *
 * The three answers, and there is no fourth:
 *   - no `Range`            → 200, the whole file, `Accept-Ranges: bytes`
 *   - a satisfiable range    → 206, `Content-Range: bytes a-b/total`, and a
 *                              `Content-Length` of the RANGE, not the file
 *   - anything else          → 416, `Content-Range: bytes *&#47;total`
 *
 * `Content-Type` is the mime WE recorded at insert time — already checked
 * against the allowlist and against the file's own magic bytes — never anything
 * the caller sends now. With `nosniff` and `inline`, that is what stops stored
 * bytes being replayed into another browser as something executable. `immutable`
 * is honest for the same reason it is on a photo: a clip belongs to a report and
 * is never edited, and a re-upload is refused rather than replacing it.
 */
app.get('/api/complaints/video/:id', readLimit, async (req, res) => {
  if (!hasDatabase) return res.status(503).json({ error: 'no database configured' })
  try {
    const meta = await getComplaintVideoMeta(req.params.id)
    if (!meta) return res.status(404).json({ error: 'video not found' })

    res.set({
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'Cache-Control': 'public, max-age=31536000, immutable',
    })

    const range = parseRange(req.get('range'), meta.byteSize)
    if (range.kind === 'invalid' || range.kind === 'unsatisfiable') {
      res.set('Content-Range', `bytes */${meta.byteSize}`)
      return res.status(416).json({ error: 'requested range not satisfiable' })
    }

    if (range.kind === 'none') {
      const whole = await getComplaintVideoChunk(meta.id, 1)
      if (!whole) return res.status(404).json({ error: 'video not found' })
      res.set({ 'Content-Type': whole.mime, 'Content-Length': String(whole.byteSize) })
      return res.send(whole.chunk)
    }

    const slice = await getComplaintVideoChunk(meta.id, range.start + 1, range.end + 1)
    if (!slice) return res.status(404).json({ error: 'video not found' })
    res.set({
      'Content-Type': slice.mime,
      // The range's length. Getting this wrong is the classic way a video
      // "plays" for two seconds and then stalls forever.
      'Content-Length': String(range.end - range.start + 1),
      'Content-Range': `bytes ${range.start}-${range.end}/${slice.byteSize}`,
    })
    res.status(206).send(slice.chunk)
  } catch (err) {
    console.error('GET /api/complaints/video failed', err)
    res.status(500).json({ error: 'could not read the video' })
  }
})

/**
 * Attach a clip to a report that is already filed.
 *
 * A route of its own rather than a field on the complaint POST, and that is
 * load-bearing in two directions. The complaint route keeps its 4 MB parser, so
 * a 25 MB clip cannot 413 the report itself — a failed upload never costs the
 * citizen the words they wrote. And the client gets a clean retry unit: the
 * report is on the board, the video catches up behind it.
 */
app.post('/api/complaints/:id/video', jsonVideo, videoLimit, async (req, res) => {
  const auth = authorizeWrite({ headerToken: req.get('x-demo-token'), configuredToken: WRITE_TOKEN })
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
  if (!hasDatabase) return res.status(503).json({ error: 'no database configured' })

  const parsed = parseVideoUpload(req.body)
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error })

  try {
    const result = await insertComplaintVideo({
      complaintId: req.params.id,
      mime: parsed.video.mime,
      bytes: parsed.video.bytes,
      byteSize: parsed.video.byteSize,
    })
    if (!result.ok) return res.status(404).json({ error: 'complaint not found' })
    // A second clip for one report is a success, not a conflict: it means the
    // clip is already there, which is what the caller wanted.
    res.status(result.duplicate ? 200 : 201).json({ video: result.video ?? null, duplicate: result.duplicate })
  } catch (err) {
    console.error('POST /api/complaints/:id/video failed', err)
    res.status(500).json({ error: 'could not store the video' })
  }
})

/**
 * Remove a complaint. The device id comes in a header, and the check is in
 * `mayDelete` — see the note there: this stops the wrong tap and casual
 * tampering, not a determined actor, and is documented as such.
 */
app.delete('/api/complaints/:id', jsonSmall, complaintLimit, async (req, res) => {
  if (!hasDatabase) return res.status(503).json({ error: 'no database configured' })

  try {
    const ownerId = await getComplaintOwner(req.params.id)
    const allowed = mayDelete({ reporterId: req.get('x-reporter-id'), ownerId })
    if (!allowed.ok) return res.status(allowed.status).json({ error: allowed.error })

    const removed = await deleteComplaint(req.params.id)
    if (!removed) return res.status(404).json({ error: 'complaint not found' })
    res.json({ removed: true })
  } catch (err) {
    console.error('DELETE /api/complaints/:id failed', err)
    res.status(500).json({ error: 'could not remove the complaint' })
  }
})

// Anything else is a 404 in JSON, so a misconfigured frontend gets a readable
// answer rather than an HTML page it will fail to parse.
app.use((_req, res) => res.status(404).json({ error: 'not found' }))

async function start() {
  if (!hasDatabase) {
    console.warn('DATABASE_URL is not set — starting anyway; every data route will answer 503.')
  } else {
    try {
      await ensureSchema()
    } catch (err) {
      // A boot that dies here would take the whole service down over a database
      // hiccup. Start, serve /health, and let the failing route report itself.
      console.error('could not apply the schema — data routes will fail until this is fixed', err)
    }
  }
  if (!WRITE_TOKEN) {
    console.warn('DEMO_WRITE_TOKEN is not set — all writes will be refused (this is deliberate).')
  }
  app.listen(PORT, () => {
    console.log(`nigran service log listening on :${PORT}`)
    console.log(`  database: ${hasDatabase ? 'configured' : 'MISSING'}`)
    console.log(`  writes:   ${WRITE_TOKEN ? 'token-gated' : 'REFUSED (no token)'}`)
    console.log(`  origins:  ${ALLOWED_ORIGINS.join(', ') || '(none — browser calls will be blocked)'}`)
  })
}

start()

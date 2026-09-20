/**
 * The decision logic behind POST /api/services, kept pure and dependency-free.
 *
 * It lives apart from the route for one practical reason: this is the part
 * worth testing, and testing it needs neither a database nor express — so
 * `npm test` in this package runs anywhere, offline, in milliseconds. The route
 * is then thin enough to read in one go.
 */

/** Drain ids are short slugs (d1…d8 today). Anything else is not our data. */
export const DRAIN_ID = /^[a-z0-9][a-z0-9-]{0,31}$/

/**
 * May this request write?
 *
 * Fails CLOSED on an unconfigured token. `DEMO_WRITE_TOKEN` being unset is the
 * most likely misconfiguration on a fresh deploy, and the one where the wrong
 * default is catastrophic — "no token configured" must mean nobody may write,
 * never everybody may.
 *
 * The comparison is the whole check. That is honest about what this is: the
 * token ships in the browser bundle, so it is a spam gate, not authentication.
 * See the note in index.js.
 */
export function authorizeWrite({ headerToken, configuredToken }) {
  if (!configuredToken) return { ok: false, status: 503, error: 'writes are disabled on this deployment' }
  if (headerToken !== configuredToken) return { ok: false, status: 401, error: 'missing or incorrect x-demo-token' }
  return { ok: true }
}

/**
 * Validate and normalise one service event from a request body.
 *
 * Returns `{ ok: true, event }` or `{ ok: false, status, error }`. Every field
 * is coerced and length-capped here, so nothing a caller sends reaches SQL
 * unbounded.
 *
 * `servicedAt` is the WALL CLOCK time of service, not the app's simulated
 * clock. A service performed under the time-lapse still happened now; a row
 * dated three simulated days hence would be a lie about the world. `simulated`
 * is what records that the clock was accelerated, and it is what keeps those
 * rows out of the published count.
 */
export function parseServiceEvent(body = {}) {
  // The default parameter only covers `undefined`, so a literal `null` body —
  // which express.json() hands straight through from `null` — would throw on
  // the first property read. A malformed caller must get a 400, never a 500.
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, error: 'expected a JSON object body' }
  }

  const drainId = typeof body.drainId === 'string' ? body.drainId.trim() : ''
  if (!DRAIN_ID.test(drainId)) {
    return { ok: false, status: 400, error: 'drainId must be a short lowercase slug' }
  }

  // A string is required before parsing, not just a non-NaN result: `new
  // Date(null)` is the epoch and `new Date(7)` is 1970 too, so without this a
  // null timestamp would be stored as a perfectly valid 1970 row — counted as a
  // real service and quietly corrupting the one number this feature exists to
  // report.
  if (typeof body.servicedAt !== 'string') {
    return { ok: false, status: 400, error: 'servicedAt must be an ISO timestamp' }
  }
  const servicedAt = new Date(body.servicedAt)
  if (Number.isNaN(servicedAt.getTime())) {
    return { ok: false, status: 400, error: 'servicedAt must be an ISO timestamp' }
  }

  const simulated = body.simulated === true
  const speed = simulated && Number.isFinite(Number(body.speed)) ? Number(body.speed) : null
  const fill = Number(body.fillAtService)

  return {
    ok: true,
    event: {
      clientEventId: text(body.clientEventId, 128),
      drainId,
      crewId: text(body.crewId, 64),
      servicedAt,
      fillAtService: Number.isFinite(fill) ? Math.max(0, Math.min(100, fill)) : null,
      simulated,
      speed,
    },
  }
}

/** A trimmed, length-capped string, or null. Never an empty string. */
function text(value, max) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

/* ==========================================================================
   Citizen complaints
   ========================================================================== */

/** The categories the board accepts. Mirrors src/data/complaints.js. */
export const COMPLAINT_CATEGORIES = [
  'waterlogging', 'drainage', 'water', 'waste', 'air', 'heat', 'road', 'power', 'other',
]

/** Zone ids are the same short slugs as drain ids. */
export const ZONE_ID = DRAIN_ID

export const MAX_PHOTOS = 3
export const MAX_PHOTO_BYTES = 600 * 1024
export const MIN_BODY = 12
export const MAX_BODY = 1200

/** Photo types we will store and, later, serve back. */
export const IMAGE_MIMES = ['image/webp', 'image/jpeg', 'image/png']

/**
 * Video links are restricted to these hosts, on both sides. An allowlist is the
 * only shape of this check that fails closed — a blocklist would have to
 * anticipate every URL shortener and redirector in existence.
 */
export const VIDEO_HOSTS = [
  'youtube.com', 'm.youtube.com', 'youtu.be', 'facebook.com',
  'fb.watch', 'vimeo.com', 'streamable.com', 'drive.google.com',
]

/**
 * Identify an image from its leading bytes.
 *
 * This exists because the client's declared `mime` is attacker-controlled, and
 * the bytes are served back to other people's browsers. Trusting the declared
 * type would let a caller label an HTML document `image/png`; with the
 * allowlisted Content-Type and `nosniff` on the response, the browser would
 * still refuse to run it — but the right place to stop that is here, before it
 * is ever stored.
 *
 * Returns the detected mime, or null when the bytes are not one of the three
 * formats we accept.
 */
export function sniffImageMime(buffer) {
  if (!buffer || typeof buffer.length !== 'number' || buffer.length < 12) return null
  const b = buffer
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
    && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png'
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  // WebP: 'RIFF' ....  'WEBP'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  return null
}

/** Is this video link acceptable? Empty is fine — the field is optional. */
export function parseVideoUrl(raw) {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return { ok: true, url: null }

  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return { ok: false, error: 'videoUrl must be a web address' }
  }
  // The protocol check is what refuses `javascript:` and `data:`, both of which
  // URL parses without complaint.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'videoUrl must be an http or https link' }
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  // Matched on a dot boundary, so `notyoutube.com` cannot pass by suffix.
  const allowed = VIDEO_HOSTS.some(h => host === h || host.endsWith(`.${h}`))
  if (!allowed) return { ok: false, error: 'videoUrl host is not on the accepted list' }
  return { ok: true, url: parsed.toString() }
}

/**
 * Decode and vet one photo from a complaint body.
 *
 * The size check happens on the base64 STRING before decoding, so an oversized
 * payload is rejected without first being inflated into memory — the difference
 * between a 400 and an out-of-memory on a small instance.
 */
export function parsePhoto(photo = {}) {
  const data = typeof photo?.data === 'string' ? photo.data : ''
  if (!data) return { ok: false, error: 'each photo needs base64 image data' }

  // base64 is 4 characters per 3 bytes; +8 of slack covers padding.
  const maxChars = Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 8
  if (data.length > maxChars) {
    return { ok: false, error: `a photo exceeds the ${MAX_PHOTO_BYTES} byte limit` }
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    return { ok: false, error: 'photo data is not valid base64' }
  }

  const bytes = Buffer.from(data, 'base64')
  if (!bytes.length) return { ok: false, error: 'photo data is empty' }
  if (bytes.length > MAX_PHOTO_BYTES) {
    return { ok: false, error: `a photo exceeds the ${MAX_PHOTO_BYTES} byte limit` }
  }

  const sniffed = sniffImageMime(bytes)
  if (!sniffed) return { ok: false, error: 'a photo is not a PNG, JPEG or WebP image' }
  // The declared type is not trusted, but a mismatch is still worth refusing:
  // it means the caller and the bytes disagree about what this is.
  const declared = typeof photo?.mime === 'string' ? photo.mime.trim().toLowerCase() : ''
  if (declared && declared !== sniffed) {
    return { ok: false, error: `declared type ${declared} does not match the image data` }
  }

  return { ok: true, photo: { mime: sniffed, bytes, byteSize: bytes.length } }
}

/* ==========================================================================
   Where a report is
   ========================================================================== */

/**
 * Lahore, roughly — the box a report's pin has to fall inside.
 *
 * A coordinate outside this is not a report about Lahore. It is far more likely
 * to be a device with a stale or scrambled fix than a genuine location, and a
 * pin in the Indian Ocean would put a marker on the map that no one can explain.
 */
export const LAHORE_BOUNDS = { minLat: 31.2, maxLat: 31.8, minLng: 74.1, maxLng: 74.6 }

/** Three decimal places. See `roundCoordinate`. */
export const COORD_DECIMALS = 3

/**
 * What a rounded coordinate is worth, in metres, and the number the UI quotes.
 *
 * At Lahore's latitude a thousandth of a degree is ~111 m north–south and ~95 m
 * east–west, so the larger of the two is what gets published. That is the size
 * of the cell a pin is snapped to, which means the true error is at most half
 * of it — the number is an upper bound, and an accuracy claim that errs upward
 * is the only direction that is honest.
 */
export const LOCATION_PRECISION_M = 111

/**
 * Snap a coordinate to three decimal places.
 *
 * This is privacy, not tidiness, and it is why the rounding is the server's job
 * as well as the client's: a published pin must not be someone's front door. At
 * ~110 m the pin still says which street is flooded and no longer says which
 * house reported it.
 *
 * Strict about its input — anything that is not a finite number is null, not
 * zero. `Number(null)` is 0 and `Number('')` is 0, so a lenient version would
 * quietly place a report at (0, 0) off the coast of Africa.
 */
export function roundCoordinate(value, decimals = COORD_DECIMALS) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * A report's location, from a body that may or may not carry one.
 *
 * A bad or out-of-range pair is DROPPED, not refused: a report with a broken
 * pin is still a report about a real blocked drain, and throwing the words away
 * over the coordinate would lose the part that matters. The client refuses
 * before sending, with a readable message, so a person is never surprised by
 * this — it exists for the caller who is not our client.
 */
export function parseLocation(body = {}) {
  const lat = roundCoordinate(body?.lat)
  const lng = roundCoordinate(body?.lng)
  const outside = lat == null || lng == null
    || lat < LAHORE_BOUNDS.minLat || lat > LAHORE_BOUNDS.maxLat
    || lng < LAHORE_BOUNDS.minLng || lng > LAHORE_BOUNDS.maxLng
  if (outside) return { lat: null, lng: null, precisionM: null }
  return { lat, lng, precisionM: LOCATION_PRECISION_M }
}

/** Validate and normalise one complaint from a request body. */
export function parseComplaint(body = {}) {
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, error: 'expected a JSON object body' }
  }

  const reporterId = text(body.reporterId, 64)
  if (!reporterId || !DRAIN_ID.test(reporterId)) {
    return { ok: false, status: 400, error: 'reporterId must be a short lowercase slug' }
  }

  const category = typeof body.category === 'string' ? body.category.trim() : ''
  if (!COMPLAINT_CATEGORIES.includes(category)) {
    return { ok: false, status: 400, error: 'category is not one of the accepted values' }
  }

  const complaintBody = typeof body.body === 'string' ? body.body.trim() : ''
  if (complaintBody.length < MIN_BODY) {
    return { ok: false, status: 400, error: `body must be at least ${MIN_BODY} characters` }
  }
  if (complaintBody.length > MAX_BODY) {
    return { ok: false, status: 400, error: `body must be at most ${MAX_BODY} characters` }
  }

  // A zone is optional — someone may not know which zone they are in — but if
  // one is given it has to be a zone we actually have.
  const zoneRaw = typeof body.zoneId === 'string' ? body.zoneId.trim() : ''
  if (zoneRaw && !ZONE_ID.test(zoneRaw)) {
    return { ok: false, status: 400, error: 'zoneId must be a short lowercase slug' }
  }

  const video = parseVideoUrl(body.videoUrl)
  if (!video.ok) return { ok: false, status: 400, error: video.error }

  // Optional, and re-rounded here rather than trusted: the guarantee that a
  // published pin is not a doorstep has to hold for callers that are not our
  // client, for the same reason `parsePhoto` re-sniffs the bytes.
  const location = parseLocation(body)

  const rawPhotos = Array.isArray(body.photos) ? body.photos : []
  if (rawPhotos.length > MAX_PHOTOS) {
    return { ok: false, status: 400, error: `at most ${MAX_PHOTOS} photos per complaint` }
  }
  const photos = []
  for (const raw of rawPhotos) {
    const parsed = parsePhoto(raw)
    if (!parsed.ok) return { ok: false, status: 400, error: parsed.error }
    photos.push(parsed.photo)
  }

  return {
    ok: true,
    complaint: {
      clientId: text(body.clientId, 128),
      reporterId,
      category,
      zoneId: zoneRaw || null,
      body: complaintBody,
      videoUrl: video.url,
      lat: location.lat,
      lng: location.lng,
      precisionM: location.precisionM,
      photos,
    },
  }
}

/** The device id on a "me too", which is all that is needed to make it one-per-device. */
export function parseConfirmation(body = {}) {
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, error: 'expected a JSON object body' }
  }
  const deviceId = text(body.deviceId, 64)
  if (!deviceId || !DRAIN_ID.test(deviceId)) {
    return { ok: false, status: 400, error: 'deviceId must be a short lowercase slug' }
  }
  return { ok: true, deviceId }
}

/**
 * May this caller delete this complaint?
 *
 * `reporterId` is a per-device id from localStorage, so it is forgeable by
 * anyone who cares to set it. This therefore stops accidents and casual
 * tampering — the wrong tap, a neighbour tidying someone else's report — and
 * NOT a determined actor. It is documented in server/README.md in exactly those
 * terms rather than being described as access control, because calling it that
 * would be a lie.
 */
export function mayDelete({ reporterId, ownerId }) {
  if (!reporterId) return { ok: false, status: 401, error: 'missing x-reporter-id' }
  if (!ownerId) return { ok: false, status: 404, error: 'complaint not found' }
  if (reporterId !== ownerId) {
    return { ok: false, status: 403, error: 'only the device that filed a complaint can remove it' }
  }
  return { ok: true }
}

/* ==========================================================================
   The complaint lifecycle
   ========================================================================== */

/** The four states a report can be in, in order. `filed` is the absence of any
 *  event, so a complaint with no rows in complaint_events is `filed`. */
export const COMPLAINT_STATUSES = ['filed', 'acknowledged', 'in-progress', 'resolved']

export const ACTOR_KINDS = ['reporter', 'crew']

/**
 * Who may move a report, and where to.
 *
 * This split is the point of the feature, not a detail of it. There are no
 * accounts here and no WASA or LWMC integration, so a status is always a CLAIM
 * by whoever moved it — and the two parties are claiming different things:
 *
 *   - A crew claims work: "we have seen this", "we are on it", "we are done".
 *   - A resident claims observation: "it is fixed", and "it has come back".
 *
 * So a resident may NOT acknowledge their own report. Allowing that would put
 * a citizen's word in the shape of a municipal response, which is exactly the
 * confusion this board is built to avoid. What a resident can say is that the
 * problem is gone or that it has returned — the two things only they can see.
 *
 * Both arrive at `resolved`, from different directions, and the card renders
 * those two differently. That distinction is carried by `actor_kind`.
 */
const CREW_MAY = {
  filed: ['acknowledged'],
  acknowledged: ['in-progress'],
  'in-progress': ['resolved'],
  resolved: [],
}

const REPORTER_MAY = {
  filed: ['resolved'],
  acknowledged: ['resolved'],
  'in-progress': ['resolved'],
  resolved: ['filed'],
}

/** May `kind` move a report from `from` to `to`? Pure, so it is testable with
 *  no database — the same reason the rest of this file exists. */
export function canTransition({ from, to, kind }) {
  if (!COMPLAINT_STATUSES.includes(from) || !COMPLAINT_STATUSES.includes(to)) return false
  const table = kind === 'crew' ? CREW_MAY : REPORTER_MAY
  return (table[from] || []).includes(to)
}

/**
 * May this caller move this report's status?
 *
 * The same honest caveat as `mayDelete`, repeated because a status reads as
 * more authoritative than a delete: `actorId` is the per-device id from
 * localStorage, so it is forgeable. The reporter check therefore stops the
 * wrong tap and casual tampering, not a determined actor.
 *
 * The crew check is weaker still, and that is structural rather than an
 * omission: the crew roster lives in the browser (`src/data/crews.js`) and
 * there is no WASA/LWMC integration to check it against. The server can tell
 * that `actorId` is shaped like a crew id and that the transition is legal; it
 * cannot tell that the crew is real. server/README.md says so in those terms
 * rather than dressing it up as a role check, and `CREW_NOTE` repeats it on
 * the panel where a claim is actually made.
 */
export function mayChangeStatus({ actorKind, actorId, ownerId, from, to }) {
  if (!ACTOR_KINDS.includes(actorKind)) {
    return { ok: false, status: 400, error: 'actorKind must be "reporter" or "crew"' }
  }
  if (actorKind === 'reporter' && actorId !== ownerId) {
    return { ok: false, status: 403, error: 'only the device that filed a complaint may move its status as the reporter' }
  }
  if (!canTransition({ from, to, kind: actorKind })) {
    // 409 rather than 400: the request is well formed, it disagrees with the
    // state the report is actually in — which is the one thing a client
    // retrying against a stale copy needs to be told.
    return { ok: false, status: 409, error: `a ${actorKind} cannot move a complaint from ${from} to ${to}` }
  }
  return { ok: true }
}

/** Validate one status change request. */
export function parseStatusChange(body = {}) {
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, error: 'expected a JSON object body' }
  }
  const to = typeof body.to === 'string' ? body.to.trim() : ''
  if (!COMPLAINT_STATUSES.includes(to)) {
    return { ok: false, status: 400, error: `to must be one of ${COMPLAINT_STATUSES.join(', ')}` }
  }
  const actorKind = typeof body.actorKind === 'string' ? body.actorKind.trim() : ''
  if (!ACTOR_KINDS.includes(actorKind)) {
    return { ok: false, status: 400, error: 'actorKind must be "reporter" or "crew"' }
  }
  const actorId = text(body.actorId, 64)
  if (!actorId || !DRAIN_ID.test(actorId)) {
    return { ok: false, status: 400, error: 'actorId must be a short lowercase slug' }
  }
  return { ok: true, change: { to, actorKind, actorId, note: text(body.note, 280) } }
}

/* ==========================================================================
   Attached video clips
   ========================================================================== */

/**
 * The two container formats we store, and the hard ceiling on one.
 *
 * 25 MB is roughly 20 seconds of 1080p phone video. It is a deliberately
 * generous ceiling for a prototype and it is NOT free: the bytes live in
 * Postgres, a request holds the base64 string and the decoded buffer at the
 * same time, and a full read pulls the whole row through the Node process. The
 * route that accepts it is limited to 2 requests a minute for exactly that
 * reason. server/README.md states the cost rather than presenting the cap as a
 * limit someone chose for tidiness.
 */
export const VIDEO_MIMES = ['video/mp4', 'video/webm']
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024

/**
 * Identify a video from its leading bytes.
 *
 * The same reasoning as `sniffImageMime`: the declared type is caller-supplied
 * and these bytes are served back to other people's browsers, so the stored
 * Content-Type has to come from the file itself.
 *
 *   - ISO base media (MP4, M4V, and most phone recordings): a 4-byte box size
 *     followed by the ASCII `ftyp` at offset 4.
 *   - Matroska/WebM: the EBML magic `1A 45 DF A3`.
 *
 * Returns the detected mime, or null. Deliberately NOT a list of every format a
 * browser can play — a container we do not recognise is one we cannot make any
 * claim about, and storing it would mean serving `application/octet-stream`
 * bytes under a video type.
 */
export function sniffVideoMime(buffer) {
  if (!buffer || typeof buffer.length !== 'number' || buffer.length < 12) return null
  const b = buffer
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'video/mp4'
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm'
  return null
}

/**
 * Decode and vet one video upload. Follows `parsePhoto` exactly, including the
 * size check on the base64 STRING before decoding — that ordering is what stops
 * an oversized payload being inflated into memory on the way to being refused,
 * and it matters far more at 25 MB than it does at 600 kB.
 */
export function parseVideoUpload(body = {}) {
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, error: 'expected a JSON object body' }
  }
  const data = typeof body.data === 'string' ? body.data : ''
  if (!data) return { ok: false, status: 400, error: 'the upload needs base64 video data' }

  // base64 is 4 characters per 3 bytes; +8 of slack covers padding.
  const maxChars = Math.ceil((MAX_VIDEO_BYTES * 4) / 3) + 8
  if (data.length > maxChars) {
    return { ok: false, status: 413, error: `a clip may be at most ${MAX_VIDEO_BYTES} bytes` }
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    return { ok: false, status: 400, error: 'video data is not valid base64' }
  }

  const bytes = Buffer.from(data, 'base64')
  if (!bytes.length) return { ok: false, status: 400, error: 'video data is empty' }
  if (bytes.length > MAX_VIDEO_BYTES) {
    return { ok: false, status: 413, error: `a clip may be at most ${MAX_VIDEO_BYTES} bytes` }
  }

  const sniffed = sniffVideoMime(bytes)
  if (!sniffed) return { ok: false, status: 400, error: 'that file is not an MP4 or WebM video' }
  const declared = typeof body.mime === 'string' ? body.mime.trim().toLowerCase() : ''
  if (declared && declared !== sniffed) {
    return { ok: false, status: 400, error: `declared type ${declared} does not match the video data` }
  }

  return { ok: true, video: { mime: sniffed, bytes, byteSize: bytes.length } }
}

/**
 * Parse a single-range `Range` header against a known file size.
 *
 * This is not an optimisation. Safari will not play a video at all until it has
 * asked for `bytes=0-1` and been answered with a 206, so a route that only
 * supports 200 serves nothing to a large share of iPhones.
 *
 * Returns:
 *   `{ kind: 'none' }`                   no header — serve the whole thing, 200
 *   `{ kind: 'ok', start, end }`         inclusive, 0-indexed — 206
 *   `{ kind: 'unsatisfiable' }`          syntactically fine, past the end — 416
 *   `{ kind: 'invalid' }`                malformed or multi-range — 416
 *
 * Multi-range (`bytes=0-1,5-6`) is refused rather than half-supported: answering
 * it needs a `multipart/byteranges` body, and replying with only the first range
 * would be a silent lie about what was sent.
 */
export function parseRange(header, size) {
  if (typeof header !== 'string' || !header.trim()) return { kind: 'none' }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return { kind: 'invalid' }

  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return { kind: 'invalid' }
  if (size <= 0) return { kind: 'unsatisfiable' }

  // `bytes=-500` is the LAST 500 bytes, which is a different request from
  // `bytes=500-` and is the one Safari sends when it seeks to the end.
  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return { kind: 'invalid' }
    return { kind: 'ok', start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number(rawStart)
  const end = rawEnd === '' ? size - 1 : Number(rawEnd)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { kind: 'invalid' }
  // Checked only for an explicit end: `bytes=20-10` is a malformed request,
  // whereas `bytes=100-` on a 100-byte file is a well-formed request the file
  // simply cannot satisfy. Both answer 416, but only the second is what the
  // player is told the real size for — collapsing the two would call an
  // ordinary "seek past the end" a broken header.
  if (rawEnd !== '' && start > end) return { kind: 'invalid' }
  if (start >= size) return { kind: 'unsatisfiable' }
  return { kind: 'ok', start, end: Math.min(end, size - 1) }
}

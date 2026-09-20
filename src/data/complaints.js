/**
 * The citizen complaints board — its categories, its limits, and the note that
 * keeps it honest.
 *
 * This file is deliberately separate from calibration.js, because nothing in it
 * is calibrated. Every other number in Nigran traces to a paper or a live feed
 * (see calibration.js); a complaint is a person's unverified report of what they
 * can see, and the app must never let the two be confused. That is what
 * COMPLAINTS_NOTE exists to prevent, and it is surfaced in the UI rather than
 * buried here.
 */

/**
 * Lucide components rather than emoji.
 *
 * The emoji this replaces were the app's last non-icon icon set, and they were
 * the wrong instrument for it: they are drawn by the operating system, so the
 * same category rendered as three different pictures on Windows, macOS and
 * Android, and none of them took the palette's colour. On a screen being judged
 * beside a map, a strip of colour emoji reads as decoration rather than as a
 * system. Lucide is already the app's icon set everywhere else.
 *
 * Held here, next to the labels, rather than in a map inside a component: an
 * icon and the word it stands for are one fact about a category, and splitting
 * them is how a category ends up added with the wrong picture.
 */
import {
  Waves, ShowerHead, Droplets, Trash2, CloudFog,
  ThermometerSun, Construction, Lightbulb, CircleEllipsis,
} from 'lucide-react'

/**
 * Categories, in the order they appear in the form. Kept to the things a Lahore
 * resident actually reports, and phrased the way they would say it rather than
 * as municipal work-order codes — the person filing this does not know what a
 * "storm-water asset" is.
 */
export const COMPLAINT_CATEGORIES = [
  { id: 'waterlogging', label: 'Waterlogging / flooding', Icon: Waves },
  { id: 'drainage', label: 'Blocked drain or sewer', Icon: ShowerHead },
  { id: 'water', label: 'Water supply', Icon: Droplets },
  { id: 'waste', label: 'Garbage not collected', Icon: Trash2 },
  { id: 'air', label: 'Smoke or air pollution', Icon: CloudFog },
  { id: 'heat', label: 'Heat — no shade or water', Icon: ThermometerSun },
  { id: 'road', label: 'Road or footpath damage', Icon: Construction },
  { id: 'power', label: 'Electricity / street lights', Icon: Lightbulb },
  { id: 'other', label: 'Something else', Icon: CircleEllipsis },
]

export const CATEGORY_IDS = COMPLAINT_CATEGORIES.map(c => c.id)

export const categoryOf = (id) =>
  COMPLAINT_CATEGORIES.find(c => c.id === id) ?? COMPLAINT_CATEGORIES[COMPLAINT_CATEGORIES.length - 1]

/* ==========================================================================
   The lifecycle
   ========================================================================== */

/**
 * The four states a report can be in. `filed` is the state of a report nothing
 * has happened to yet, and it is where every report starts.
 *
 * No `icon`: these carried emoji once, but nothing ever rendered them — a card
 * shows a status through ComplaintCard's colour spine and its status chip, and
 * an emoji beside a chip that already names the state would say it twice. Dead
 * fields are worse than absent ones, because the next person to add a status
 * reasonably assumes the icon is displayed and picks one carefully.
 */
export const COMPLAINT_STATUSES = [
  { id: 'filed', label: 'Filed' },
  { id: 'acknowledged', label: 'Acknowledged' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'resolved', label: 'Resolved' },
]

export const statusOf = (id) =>
  COMPLAINT_STATUSES.find(s => s.id === id) ?? COMPLAINT_STATUSES[0]

/**
 * Who may move a report, and where to. This mirrors `CREW_MAY` / `REPORTER_MAY`
 * in server/src/validate.js and must be kept in step with it — the server is
 * the authority, and this copy exists so the UI offers only the moves that will
 * be accepted rather than letting someone press a button that comes back 409.
 *
 * The split is the whole point: a crew claims WORK ("we have seen it", "we are
 * on it", "we are done") and a resident claims OBSERVATION ("it is fixed",
 * "it is back"). A resident deliberately cannot acknowledge their own report —
 * that would put a citizen's word in the shape of a municipal response.
 */
export const TRANSITIONS = {
  crew: {
    filed: ['acknowledged'],
    acknowledged: ['in-progress'],
    'in-progress': ['resolved'],
    resolved: [],
  },
  reporter: {
    filed: ['resolved'],
    acknowledged: ['resolved'],
    'in-progress': ['resolved'],
    resolved: ['filed'],
  },
}

/** May `kind` move a report from `from` to `to`? */
export const canTransition = (from, to, kind) =>
  (TRANSITIONS[kind]?.[from] ?? []).includes(to)

/**
 * The button a mover is offered, in their own words. "It's fixed" and "Mark
 * done" are the same transition from two different people and they are not the
 * same claim, so they are not given the same label.
 */
export const TRANSITION_LABELS = {
  'crew:filed:acknowledged': "We've seen this",
  'crew:acknowledged:in-progress': 'Crew on the way',
  'crew:in-progress:resolved': 'Job done',
  'reporter:filed:resolved': "It's fixed",
  'reporter:acknowledged:resolved': "It's fixed",
  'reporter:in-progress:resolved': "It's fixed",
  'reporter:resolved:filed': 'Still happening',
}

export const transitionLabel = (kind, from, to) =>
  TRANSITION_LABELS[`${kind}:${from}:${to}`] ?? 'Update'

/**
 * What a status actually says, as a sentence — and the reason `actor_kind` is
 * carried all the way through the stack.
 *
 * "Resolved" reached by the resident who filed the report and "resolved"
 * reached by a crew are different statements, and rendering them identically
 * would let a citizen's own guess read as a completed work order. The crew side
 * is labelled a prototype model every time it appears, because there is no
 * WASA/LWMC integration and the roster is a model in this repository.
 */
export function statusClaim({ status, kind, actorName = null }) {
  const crew = `${actorName ?? 'A crew'} (prototype model)`
  if (kind === 'crew') {
    if (status === 'acknowledged') return `Acknowledged by ${crew}`
    if (status === 'in-progress') return `${crew} is on it`
    if (status === 'resolved') return `Closed by ${crew}`
    return null
  }
  if (kind === 'reporter') {
    if (status === 'resolved') return 'The reporter says it is fixed'
    // Only a reporter who is KNOWN to have moved it — this sentence means the
    // problem came back, and a report nobody has moved is not that. Without the
    // kind check, every freshly filed card would carry a claim its filer never
    // made, which is the same error as inventing a crew name.
    if (status === 'filed') return 'The reporter says it is still happening'
  }
  return null
}

/**
 * The lifecycle's honesty note, in the same voice as COMPLAINTS_NOTE. A status
 * chip is the most authoritative-looking thing on this board, so it is the one
 * that most needs saying out loud: nobody verified any of it.
 */
export const STATUS_CLAIM_NOTE = 'A status is what someone says happened to a report — the resident who filed it, or a prototype crew model. It is not a WASA or LWMC work-order record.'

/** How many lifecycle events a device keeps per report. */
export const MAX_STATUS_EVENTS = 20

/** How many photographs one report may carry. Stated in the UI and enforced on both sides. */
export const MAX_PHOTOS = 3

/**
 * Photo budget, enforced twice: in the browser after re-encoding (so the user
 * gets a readable message before anything is sent) and again on the server (so
 * the cap does not depend on the client being honest). 600 KB is roughly a
 * 1400px WebP at quality 0.82 — a phone photo of a flooded street, legible.
 */
export const MAX_PHOTO_BYTES = 600 * 1024

/**
 * A video LINK is still the right answer for anything longer than a few
 * seconds, and it stays the primary field. A short clip can also be attached
 * directly (see MAX_VIDEO_BYTES) — but a 3-minute recording is 300 MB, which is
 * not going on a shared board from a phone on mobile data, and the copy says so
 * rather than letting someone discover it at the upload bar.
 *
 * The host list is an allowlist rather than a blocklist, and it is enforced on
 * BOTH sides. An allowlist is the only form of this check that fails closed.
 */
export const VIDEO_HOSTS = [
  'youtube.com',
  'm.youtube.com',
  'youtu.be',
  'facebook.com',
  'fb.watch',
  'vimeo.com',
  'streamable.com',
  'drive.google.com',
]

/**
 * An attached clip's ceiling, mirrored by `MAX_VIDEO_BYTES` in
 * server/src/validate.js — enforced in the browser so the person is told before
 * a 25 MB upload starts, and on the server so the cap does not depend on this
 * side being honest.
 *
 * 25 MB is roughly 20 seconds of 1080p phone video. It is stored in Postgres as
 * bytes, which is why the server accepts only two of these a minute: the cost
 * of the cap is paid in memory, and server/README.md states it plainly rather
 * than presenting the number as free.
 */
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024

/**
 * The containers an attached clip may be in.
 *
 * Matched on the extension as well as the browser-reported type, because the
 * type is often absent on a phone recording. `.mov` and `.m4v` are here because
 * an iPhone produces `.mov` by default and it is an ISO-BMFF container — the
 * same family as MP4 — so the server's own sniffing reads it correctly. The
 * browser's declared type for one is `video/quicktime`, which is why the client
 * sends a mime only when it is one of the two below rather than relaying
 * whatever the File object claims.
 */
export const VIDEO_FILE_EXTENSIONS = ['.mp4', '.m4v', '.mov', '.webm']
export const VIDEO_FILE_MIMES = ['video/mp4', 'video/webm']

/**
 * The board's provenance note, in the same voice as TELEMETRY_NOTE and
 * SERVICE_POLICY_NOTE. Complaints are the only user-generated content in the
 * app, and the only signal here that nobody has verified — so the board says so
 * on its face, and the counts on the map carry the same word.
 */
export const COMPLAINTS_NOTE = 'Citizen reports are unverified — they are what residents say they can see, not official WASA or LWMC records. They are never mixed into a risk score.'

/** Shown on the map wherever a complaint count appears. */
export const UNVERIFIED_LABEL = 'Citizen reports — unverified'

/** Body length cap. Long enough for a real account, short enough to render. */
export const MAX_BODY_CHARS = 1200
export const MIN_BODY_CHARS = 12

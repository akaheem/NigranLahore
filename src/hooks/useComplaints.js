import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createComplaintStore } from '../lib/idb.js'
import { blobToBase64 } from '../lib/complaintMedia.js'
import { inLahore, LOCATION_PRECISION_M } from '../lib/geo.js'
import { MAX_PHOTOS, MAX_STATUS_EVENTS, VIDEO_FILE_MIMES, canTransition } from '../data/complaints.js'
// The same four statuses the service log uses, imported rather than redefined.
// They describe the same thing — how the one shared backend is doing — and two
// copies of that vocabulary would eventually disagree about what "error" means.
import { SYNC_LOCAL_ONLY, SYNC_PENDING, SYNC_SYNCED, SYNC_ERROR } from './useServiceLog.js'

/**
 * The citizen complaints board.
 *
 * Deliberately the same shape as useServiceLog.js: local first, shared when it
 * can be, a failed write KEPT rather than dropped, and nothing that can throw
 * into a render. Two things differ, and both are forced:
 *
 *   1. It persists to IndexedDB (src/lib/idb.js), not localStorage, because a
 *      complaint carries photo blobs and localStorage holds strings in a ~5MB
 *      origin-wide quota. See the note in that file.
 *   2. Its writes carry megabytes, so they are sent one at a time and a single
 *      failure does not abandon the rest of the queue.
 *
 * A complaint filed while the backend is unreachable stays on the device and is
 * retried. That is the honest behaviour: the report genuinely exists, it is just
 * not on the shared board yet, and `sync` says which of the two is true.
 *
 * There is no account and no login. `reporterId` is a per-device id in
 * localStorage; it is forgeable, and it is what lets a device remove what it
 * filed. It is not access control and the UI never calls it that.
 */

const RAW_BASE = import.meta.env.VITE_API_BASE_URL || ''
const API_BASE = RAW_BASE.replace(/\/+$/, '')
const WRITE_TOKEN = import.meta.env.VITE_DEMO_WRITE_TOKEN || ''

const REPORTER_KEY = 'nigran-reporter-id'
const TIMEOUT_MS = 20_000
const PULL_LIMIT = 200
export { SYNC_LOCAL_ONLY, SYNC_PENDING, SYNC_SYNCED, SYNC_ERROR }

export const SORT_RECENT = 'recent'
export const SORT_CONFIRMED = 'confirmed'

/** A stable-ish unique id for one complaint — the idempotency key. */
const newComplaintId = () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/**
 * Where a photo the SHARED board holds can be fetched from.
 *
 * Images are never inlined in the feed — a page of complaints would be tens of
 * megabytes — so each one has its own immutable, cacheable URL. Exported so a
 * card can render one without knowing anything else about the backend.
 */
export const complaintPhotoUrl = (photoId) => `${API_BASE}/api/complaints/photo/${photoId}`

/**
 * Where a clip the SHARED board holds can be fetched from. Same reasoning as
 * the photo URL — the bytes have a URL of their own rather than riding along in
 * the feed, which for a 25 MB clip would be the whole page.
 */
export const complaintVideoUrl = (videoId) => `${API_BASE}/api/complaints/video/${videoId}`

/**
 * How long a clip upload may take.
 *
 * Twenty seconds is the right default for a few hundred bytes and badly wrong
 * for 25 MB: on an ordinary phone connection that is a slow upload measured in
 * minutes, and a fixed abort would kill it while looking exactly like the board
 * being down. The default stays tight; this one caller asks for longer.
 */
const VIDEO_TIMEOUT_MS = 180_000

const randomId = () => `r-${Math.random().toString(36).slice(2, 12)}`

/**
 * This device's id, created once and kept.
 *
 * The shape is checked against the same slug rule the server enforces, so a
 * hand-edited or half-written value is replaced rather than sent to be
 * rejected on every request.
 */
function readReporterId() {
  try {
    const existing = window.localStorage.getItem(REPORTER_KEY)
    if (existing && /^[a-z0-9][a-z0-9-]{0,31}$/.test(existing)) return existing
    const id = randomId()
    window.localStorage.setItem(REPORTER_KEY, id)
    return id
  } catch {
    // localStorage unavailable (private mode, blocked storage). A session id
    // still lets this device remove what it files before the tab closes.
    return randomId()
  }
}

/**
 * One request to the shared board.
 *
 * `timeoutMs` is per call, and that is not incidental. Everything here is a few
 * hundred bytes and 20 seconds is generous — but a video upload is megabytes,
 * and a fixed 20-second abort would kill one on any ordinary phone connection
 * while looking exactly like the board being down. The default stays tight and
 * the one caller that needs longer asks for it.
 */
async function request(path, options = {}) {
  const { timeoutMs = TIMEOUT_MS, ...init } = options
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout?.(timeoutMs),
  })
  if (!res.ok) {
    // The status is carried on the error because the caller has to tell "the
    // board is unreachable" (retry) from "you may not do that" (do not retry)
    // from "someone else moved it first" (reconcile).
    const err = new Error(`${res.status} ${path}`)
    err.status = res.status
    // The body carries the state the server is in now on a 409, which is the
    // only way the caller can correct itself without a second round trip.
    try { err.body = await res.json() } catch { err.body = null }
    throw err
  }
  return res.json()
}

/** A complaint this device holds, normalised so the shape is always the same. */
function normalizeLocal(row) {
  return {
    clientId: row.clientId,
    // Always this device's own. Nothing reaches the store that was not filed
    // here: every `store.save` call writes a record built by `file`, or one read
    // back out of `listRef`. Rows the board returns are merged into state and
    // never persisted, so "whose report is this?" is not a question a stored
    // record ever has to answer — and a record written before ownership became a
    // boolean, which carries only the old `reporterId`, reads correctly here too.
    isMine: true,
    category: row.category,
    zoneId: row.zoneId ?? null,
    body: typeof row.body === 'string' ? row.body : '',
    videoUrl: row.videoUrl ?? null,
    createdAt: row.createdAt ?? new Date().toISOString(),
    confirmations: Number(row.confirmations) || 0,
    confirmedByMe: row.confirmedByMe === true,
    synced: row.synced === true,
    remoteId: row.remoteId ?? null,
    photoCount: Number(row.photoCount) || 0,
    remotePhotos: [],
    // A pin, when the reporter chose to place one — already rounded by the form
    // before it was ever stored. Null on a report that has none, which is most
    // of them, and null is what keeps it off the map and on the zone badge.
    lat: Number.isFinite(row.lat) ? row.lat : null,
    lng: Number.isFinite(row.lng) ? row.lng : null,
    locationPrecisionM: Number.isFinite(row.locationPrecisionM) ? row.locationPrecisionM : null,
    status: typeof row.status === 'string' ? row.status : 'filed',
    statusAt: row.statusAt ?? null,
    statusKind: row.statusKind ?? null,
    statusActor: row.statusActor ?? null,
    // An attached clip. `hasVideo` is the local Blob in IndexedDB; `videoId` is
    // the id the board assigned once it accepted one. Both are needed because
    // the same card has to play a clip this device is still holding and one it
    // has already handed over, and those are different URLs.
    hasVideo: row.hasVideo === true,
    videoPending: row.videoPending === true,
    videoId: row.videoId != null ? String(row.videoId) : null,
    videoError: row.videoError ?? null,
    // The moves this device made, in order, each flagged `synced` once the
    // board has taken it. A move made while the board was unreachable stays
    // here and is retried — the same rule an unsynced report follows, because
    // "the water is gone" is as real a thing to have said as the report itself.
    events: Array.isArray(row.events)
      ? row.events.filter(e => e && typeof e === 'object' && typeof e.to === 'string')
      : [],
  }
}

/** A complaint the shared board returned. Its photos are ids, not bytes. */
function fromApi(row) {
  const id = row?.id != null ? String(row.id) : null
  return {
    clientId: typeof row?.clientId === 'string' && row.clientId ? row.clientId : `remote-${id}`,
    // The board answers ownership as a boolean, and deliberately does not send
    // the reporter's device id with it: that id is the credential `DELETE`
    // checks. Computed server-side from the `x-reporter-id` this client sent,
    // which is why the feed takes that header at all.
    isMine: row?.isMine === true,
    category: row?.category,
    zoneId: row?.zoneId ?? null,
    body: typeof row?.body === 'string' ? row.body : '',
    videoUrl: row?.videoUrl ?? null,
    createdAt: row?.createdAt ?? null,
    confirmations: Number(row?.confirmations) || 0,
    confirmedByMe: row?.confirmedByMe === true,
    synced: true,
    remoteId: id,
    photoCount: 0,
    remotePhotos: Array.isArray(row?.photoIds) ? row.photoIds.map(pid => String(pid)) : [],
    lat: Number.isFinite(row?.lat) ? row.lat : null,
    lng: Number.isFinite(row?.lng) ? row.lng : null,
    locationPrecisionM: Number.isFinite(row?.locPrecisionM) ? row.locPrecisionM : null,
    status: typeof row?.status === 'string' ? row.status : 'filed',
    statusAt: row?.statusAt ?? null,
    statusKind: row?.statusKind ?? null,
    statusActor: row?.statusActor ?? null,
    // A clip the board holds, and nothing about it locally: this device has
    // never seen those bytes, so it plays them from the board's own URL.
    hasVideo: false,
    videoPending: false,
    videoId: row?.videoId != null ? String(row.videoId) : null,
    videoError: null,
    // The board returns the latest state, not the history, so a complaint
    // learned from the board has no local event list. Nothing reads it for
    // display — the card names the mover from the status fields above.
    events: [],
  }
}

/**
 * Whose status wins when this device and the board disagree?
 *
 * The LATER claim, with a tie going to the board. This is deliberately not the
 * per-field rule the rest of this function uses, and the reason is that a
 * status is a timestamped fact rather than a value with an owner:
 *
 *   - "Local wins" would resurrect a status this device set from a stale copy,
 *     overwriting a crew that moved the report on the board a minute ago.
 *   - "Server wins" would silently discard a move made here while the board was
 *     unreachable, which is the same mistake as dropping an unsynced report —
 *     the resident really did tap "it's fixed", and the tap is queued.
 *
 * The timestamps are the only thing that can tell those two cases apart, so
 * they decide. `statusAt` is the client's clock for a local move and the
 * database's for a synced one; a tie therefore means the two agree closely
 * enough that the shared record is the better answer.
 */
function laterStatus(localRow, remoteRow) {
  const localAt = Date.parse(localRow.statusAt) || 0
  const remoteAt = Date.parse(remoteRow.statusAt) || 0
  if (localAt > remoteAt) {
    return {
      status: localRow.status,
      statusAt: localRow.statusAt,
      statusKind: localRow.statusKind ?? null,
      statusActor: localRow.statusActor ?? null,
    }
  }
  return {
    status: remoteRow.status ?? 'filed',
    statusAt: remoteRow.statusAt ?? null,
    statusKind: remoteRow.statusKind ?? null,
    statusActor: remoteRow.statusActor ?? null,
  }
}

/**
 * Merge the shared board into what this device holds.
 *
 * A complaint is identified by `clientId`, so one this device filed and the
 * server also returned is ONE row and not two. The local copy wins for anything
 * it owns — its photos are blobs on this device, not ids to fetch across the
 * network. The server wins for the one number it is the authority on, the
 * confirmation count, because otherwise two people confirming at once would
 * each see only their own.
 *
 * Records this device holds that the server did not return are KEPT. That
 * covers both a complaint that has not synced yet and one that has aged past
 * the server's page limit, and in neither case is dropping it correct.
 */
export function mergeComplaints(remote = [], local = []) {
  const byId = new Map()
  for (const row of remote) byId.set(row.clientId, row)
  for (const row of local) {
    const existing = byId.get(row.clientId)
    if (!existing) { byId.set(row.clientId, row); continue }
    byId.set(row.clientId, {
      ...existing,
      ...row,
      confirmations: Math.max(existing.confirmations || 0, row.confirmations || 0),
      confirmedByMe: existing.confirmedByMe === true || row.confirmedByMe === true,
      remoteId: row.remoteId ?? existing.remoteId,
      synced: row.synced === true || existing.synced === true,
      // Whatever this device holds is the better copy of the images: they are
      // the actual files. Fall back to the server's ids only when it has none.
      photoCount: row.photoCount || existing.photoCount || 0,
      remotePhotos: (row.photoCount || existing.photoCount) ? [] : (existing.remotePhotos || row.remotePhotos || []),
      // A pin is set once, when the report is filed, and never moved — so this
      // is not a contest and needs no timestamp to settle it. One side has it
      // or the other does.
      lat: row.lat ?? existing.lat,
      lng: row.lng ?? existing.lng,
      locationPrecisionM: row.locationPrecisionM ?? existing.locationPrecisionM,
      // A clip is on this device, or on the board, or neither — never both in
      // a way that needs settling. The local copy wins while it is still here
      // because it is the actual file, and the board's id fills in behind it.
      hasVideo: row.hasVideo === true || existing.hasVideo === true,
      videoPending: row.videoPending === true,
      videoId: row.videoId ?? existing.videoId ?? null,
      videoError: row.videoError ?? null,
      // The local event list is the queue of moves this device still owes the
      // board, so it is never taken from the server.
      events: Array.isArray(row.events) ? row.events : [],
      ...laterStatus(row, existing),
    })
  }
  return [...byId.values()]
}

export function sortComplaints(list, sort = SORT_RECENT) {
  const rows = [...list]
  const at = (c) => Date.parse(c.createdAt) || 0
  if (sort === SORT_CONFIRMED) {
    // Confirmed first, newest as the tie-break. `sort` is stable, so complaints
    // with the same count keep the order they arrived in.
    return rows.sort((a, b) => ((b.confirmations || 0) - (a.confirmations || 0)) || (at(b) - at(a)))
  }
  return rows.sort((a, b) => at(b) - at(a))
}

export function filterComplaints(list, { category = null, zoneId = null } = {}) {
  return list.filter(c =>
    (!category || c.category === category) &&
    (!zoneId || c.zoneId === zoneId))
}

/**
 * Per-zone counts, derived from the board rather than asked of the server.
 *
 * A separate `counts` endpoint would be one number on the map and a different
 * one on the board — it would count every complaint ever filed, while the board
 * shows the page it loaded — and a reader who noticed would be right to trust
 * neither. One source, one number.
 */
export function countByZone(list = []) {
  const counts = {}
  for (const c of list) {
    if (!c.zoneId) continue
    counts[c.zoneId] = (counts[c.zoneId] || 0) + 1
  }
  return counts
}

export function useComplaints() {
  // One store for the lifetime of the hook, created by a state initializer so
  // React guarantees it is made once rather than on every render.
  //
  // Note what this does and does not buy. Nothing is ever READ from IndexedDB
  // during render — `loadAll()` below stays in an effect, where it belongs —
  // and that is the property that matters. Creation is not free of side effects:
  // `createComplaintStore` opens a connection, and because StrictMode is on
  // (src/main.jsx) React runs this initializer twice in development and one
  // store is discarded with its handle still open. Production runs it once.
  // Deferring the open behind `store.ready` would make creation genuinely inert,
  // but it changes `ready` from a property to a call across every method in
  // idb.js for a development-only gain, so it is a decision not to, not an
  // oversight.
  const [store] = useState(() => createComplaintStore())

  const [reporterId] = useState(readReporterId)
  const [complaints, setComplaints] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [sync, setSync] = useState(API_BASE ? SYNC_PENDING : SYNC_LOCAL_ONLY)

  const mounted = useRef(true)
  // The async paths (flush, pull) run from an interval and must not read a
  // stale closure's `complaints`.
  const listRef = useRef(complaints)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => { listRef.current = complaints }, [complaints])

  // Load what this device already holds. This is the FIRST paint's data: the
  // board shows the person their own reports before any network call is made,
  // which is what makes it work with no backend at all.
  useEffect(() => {
    let cancelled = false
    store.loadAll().then(rows => {
      if (cancelled || !mounted.current) return
      const local = rows.filter(r => r && typeof r === 'object' && r.clientId).map(normalizeLocal)
      if (local.length) setComplaints(current => mergeComplaints(current, local))
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [store])

  /** Write a change to both the in-memory list and the device's own store. */
  const patchLocal = useCallback(async (clientId, changes) => {
    const current = listRef.current.find(c => c.clientId === clientId)
    if (!current) return null
    const next = { ...current, ...changes }
    await store.save(next)
    listRef.current = listRef.current.map(c => (c.clientId === clientId ? next : c))
    if (mounted.current) {
      setComplaints(list => list.map(c => (c.clientId === clientId ? next : c)))
    }
    return next
  }, [store])

  /**
   * File a complaint. Local and immediate — the report exists the moment it is
   * written, whether or not anything is reachable.
   *
   * `photos` are Blobs, already downscaled by src/lib/complaintMedia.js. They
   * are stored before the record, because a record that claims photos it does
   * not have renders a card with broken images and no way to tell why.
   */
  const file = useCallback(async ({ category, body, zoneId = null, videoUrl = null, photos = [], video = null, lat = null, lng = null }) => {
    const clientId = newComplaintId()
    const kept = photos.filter(Boolean).slice(0, MAX_PHOTOS)
    for (const [index, blob] of kept.entries()) {
      await store.savePhoto(clientId, index, blob)
    }
    // The clip is stored BEFORE the record, for the same reason the photos are:
    // a record that claims a video it does not have renders a player that never
    // loads and no way to tell why.
    if (video) await store.saveVideo(clientId, video)
    // Only ever a pair, and only ever inside Lahore. A half-set pin is dropped
    // here as well as on the server, because a report with a latitude and no
    // longitude is not a place.
    const located = inLahore({ lat, lng }) ? { lat, lng } : { lat: null, lng: null }
    const record = {
      clientId,
      // Filed here, by definition.
      isMine: true,
      category,
      zoneId: zoneId || null,
      body,
      videoUrl: videoUrl || null,
      lat: located.lat,
      lng: located.lng,
      // Recorded with the pin rather than assumed at render time, so a card
      // read back from IndexedDB a month later says the same thing about its
      // own accuracy as it did the moment it was filed.
      locationPrecisionM: located.lat == null ? null : LOCATION_PRECISION_M,
      // The clip, if one was attached. `videoPending` is the queue flag: the
      // report is filed first and the bytes follow, so a failed upload never
      // costs the person the words they wrote.
      hasVideo: Boolean(video),
      videoPending: Boolean(video),
      videoId: null,
      videoError: null,
      createdAt: new Date().toISOString(),
      confirmations: 0,
      confirmedByMe: false,
      // With no shared board configured there is nothing to sync to, and saying
      // "pending" forever would imply a board that does not exist.
      synced: !API_BASE,
      remoteId: null,
      photoCount: kept.length,
      remotePhotos: [],
      // A report nothing has happened to yet. `statusAt: null` is what a status
      // merge reads as "the board's answer is newer", which is right: nothing
      // has been claimed about this on either side.
      status: 'filed',
      statusAt: null,
      statusKind: null,
      statusActor: null,
      events: [],
    }
    await store.save(record)
    // `listRef` is updated here, not only through the effect below, and the
    // difference is user-visible: the submit handler flushes the moment this
    // resolves, and the effect that mirrors state into `listRef` has not run
    // yet at that point (the re-render is scheduled, the promise continuation
    // is not). Without this line the flush would look at a list that does not
    // contain the report just filed and quietly leave it for the next
    // interval — the exact wait the immediate push exists to avoid.
    listRef.current = mergeComplaints([], [...listRef.current, record])
    if (mounted.current) setComplaints(current => mergeComplaints([], [...current, record]))
    return record
    // `reporterId` is not a dependency here any more: the record this writes
    // carries `isMine` and no device id, so nothing in this callback reads it.
  }, [store])

  /** Read the shared board and merge it in. */
  const pull = useCallback(async () => {
    if (!API_BASE) return
    try {
      const data = await request(`/api/complaints?limit=${PULL_LIMIT}`, {
        headers: { 'x-reporter-id': reporterId },
      })
      const remote = (Array.isArray(data?.complaints) ? data.complaints : [])
        .map(fromApi)
        .filter(c => c.category && c.remoteId)
      if (!mounted.current) return
      setComplaints(current => mergeComplaints(remote, current))
      setSync(SYNC_SYNCED)
    } catch {
      // An unreachable board is not an error state for the app: what this
      // device holds is complete on its own. Say so; do not claim to be synced.
      if (mounted.current) setSync(SYNC_ERROR)
    }
  }, [reporterId])

  /** Change the status of the moves this device owes the board. */
  const patchEvents = useCallback(async (clientId, fn) => {
    const current = listRef.current.find(c => c.clientId === clientId)
    if (!current) return null
    return patchLocal(clientId, { events: fn(current.events || []) })
  }, [patchLocal])

  /**
   * Send everything this device holds that the shared board has not taken:
   * the reports themselves, and then the status moves queued behind them.
   *
   * Two phases and not one, because a status event addresses a complaint by the
   * id the BOARD assigned. A report filed while offline has no such id until
   * phase 1 has run, so its status moves cannot be sent beside it — they queue
   * on the record and go out the moment the report lands.
   */
  const flush = useCallback(async () => {
    if (!API_BASE) return
    let failed = false

    // ---- Phase 1: the reports ----
    const pending = listRef.current.filter(c => !c.synced)
    const accepted = []
    for (const c of pending) {
      try {
        const photos = []
        if (c.photoCount) {
          const blobs = await store.loadPhotos(c.clientId)
          for (const { blob } of blobs.slice(0, MAX_PHOTOS)) {
            photos.push({ mime: blob.type || 'image/webp', data: await blobToBase64(blob) })
          }
        }
        const result = await request('/api/complaints', {
          method: 'POST',
          headers: { 'x-demo-token': WRITE_TOKEN, 'x-reporter-id': reporterId },
          body: JSON.stringify({
            clientId: c.clientId,
            reporterId,
            category: c.category,
            zoneId: c.zoneId,
            body: c.body,
            videoUrl: c.videoUrl,
            lat: c.lat,
            lng: c.lng,
            photos,
          }),
        })
        accepted.push({ clientId: c.clientId, remoteId: result?.id != null ? String(result.id) : null })
      } catch {
        // One complaint failing must not abandon the rest of the queue — a
        // single oversized payload should not strand everything behind it.
        failed = true
      }
    }
    if (accepted.length) {
      const map = new Map(accepted.map(a => [a.clientId, a.remoteId]))
      // `listRef` is written here as well as the state, for the same reason
      // `file` does it: phase 2 below looks up these complaints by their new
      // remote id in the same continuation, and the effect that mirrors state
      // into `listRef` has not run yet at this point.
      listRef.current = listRef.current.map(c => (map.has(c.clientId)
        ? { ...c, synced: true, remoteId: c.remoteId ?? map.get(c.clientId) }
        : c))
      for (const a of accepted) {
        const rec = listRef.current.find(c => c.clientId === a.clientId)
        if (rec) await store.save(rec)
      }
      if (mounted.current) setComplaints(current => current.map(c => (map.has(c.clientId)
        ? { ...c, synced: true, remoteId: c.remoteId ?? map.get(c.clientId) }
        : c)))
    }

    // ---- Phase 2: the status moves ----
    // Read off `listRef`, which phase 1 has just updated, so a report filed and
    // resolved in the same breath goes out complete rather than leaving its
    // status for the next minute's interval.
    let reconcile = false
    for (const record of listRef.current) {
      if (!record.remoteId) continue
      const owed = (record.events || []).filter(e => !e.synced)
      if (!owed.length) continue

      const sent = []
      for (const event of owed) {
        try {
          await request(`/api/complaints/${record.remoteId}/status`, {
            method: 'POST',
            headers: { 'x-demo-token': WRITE_TOKEN, 'x-reporter-id': reporterId },
            body: JSON.stringify({ to: event.to, actorKind: event.kind, actorId: event.actorId, note: event.note }),
          })
          sent.push(event.at)
        } catch (err) {
          const status = Number(err?.status)
          if (status >= 400 && status < 500) {
            // Refused outright: this device was working from a stale or wrong
            // idea of the report, or moved past it. Retrying would fail
            // forever, so the queued move is dropped and the board's answer is
            // taken instead — see `reconcile` below.
            reconcile = true
          } else {
            // Unreachable or a server fault: keep it queued and retry.
            failed = true
          }
          break
        }
      }

      if (reconcile) {
        await patchLocal(record.clientId, {
          status: 'filed', statusAt: null, statusKind: null, statusActor: null,
          events: (record.events || []).filter(e => e.synced),
        })
      } else if (sent.length) {
        await patchEvents(record.clientId, events =>
          events.map(e => (sent.includes(e.at) ? { ...e, synced: true } : e)))
      }
    }

    if (mounted.current) setSync(failed || reconcile ? SYNC_ERROR : SYNC_SYNCED)
    // The board disagreed with a move this device made. Take its version
    // immediately rather than leaving a status on screen that is not the shared
    // one until the next interval — that is precisely the "it comes back later"
    // behaviour the delete path already refuses to accept.
    if (reconcile) await pull()

    // ---- Phase 3: the clips ----
    // Last, and after a `continue` on everything else, because this is the only
    // request here measured in minutes. A clip still uploading must not hold up
    // a status move queued behind it on a different report.
    for (const record of listRef.current) {
      if (!record.remoteId || !record.videoPending) continue

      const blob = await store.loadVideo(record.clientId)
      if (!blob) {
        // The bytes have gone — storage cleared, or a private-mode session that
        // ended. Saying so is better than a card that shows a player forever
        // waiting for a file that is not there.
        await patchLocal(record.clientId, { videoPending: false, hasVideo: false, videoError: 'The clip could not be found on this device, so it was not sent.' })
        continue
      }

      try {
        const data = await blobToBase64(blob)
        const result = await request(`/api/complaints/${record.remoteId}/video`, {
          method: 'POST',
          headers: { 'x-demo-token': WRITE_TOKEN, 'x-reporter-id': reporterId },
          // The declared mime is only ever one of the two the server accepts,
          // or absent. A browser calls an iPhone recording `video/quicktime`;
          // sending that would make the server refuse bytes it can read
          // perfectly well, on a technicality about the label.
          body: JSON.stringify({
            mime: VIDEO_FILE_MIMES.includes(blob.type) ? blob.type : null,
            data,
          }),
          timeoutMs: VIDEO_TIMEOUT_MS,
        })
        await patchLocal(record.clientId, {
          videoPending: false,
          videoError: null,
          videoId: result?.video?.id != null ? String(result.video.id) : record.videoId,
        })
      } catch (err) {
        const status = Number(err?.status)
        if (status === 429) {
          // Rate-limited, not refused. The board takes two clips a minute and
          // this was the third, so it stays queued and goes out on the next
          // interval — dropping it here would lose a clip that is perfectly
          // acceptable for a reason that has nothing to do with the clip.
          failed = true
        } else if (status >= 400 && status < 500) {
          // Refused on its merits — too big, or a container we do not store. It
          // will be refused identically forever, so it is dropped and the card
          // says what happened. The report itself is already on the board.
          await patchLocal(record.clientId, {
            videoPending: false,
            hasVideo: false,
            videoError: 'The clip was refused by the shared board and has been left off this report.',
          })
        } else {
          failed = true
        }
      }
    }

    if (failed && mounted.current) setSync(SYNC_ERROR)
  }, [reporterId, store, patchLocal, patchEvents, pull])

  useEffect(() => {
    if (!API_BASE) return
    pull().then(flush)
    const id = setInterval(() => { pull().then(flush) }, 60_000)
    return () => clearInterval(id)
  }, [pull, flush])

  /**
   * "Me too". One per device, enforced by the database's composite key.
   *
   * The count is raised here first so the tap feels immediate, then replaced by
   * the server's own figure. If the request fails the local bump is rolled back
   * rather than left standing — a count the server does not have would drop
   * again on the next pull, and a number that goes down on its own is worse
   * than one that never moved.
   */
  const confirm = useCallback(async (clientId) => {
    const current = listRef.current.find(c => c.clientId === clientId)
    if (!current) return { ok: false, reason: 'missing' }
    // A second tap is a no-op, not a failure — the same rule the server applies.
    if (current.confirmedByMe) return { ok: true, duplicate: true, confirmations: current.confirmations }

    if (!API_BASE) {
      // No shared board: this count is this device's own, and the board's sync
      // note says so rather than letting it read as a citywide figure.
      await patchLocal(clientId, { confirmedByMe: true, confirmations: current.confirmations + 1 })
      return { ok: true }
    }
    // A complaint that has not reached the board yet has no id to confirm
    // against. Saying so is better than counting it here and having the number
    // change later.
    if (!current.remoteId) return { ok: false, reason: 'not-synced' }

    await patchLocal(clientId, { confirmedByMe: true, confirmations: current.confirmations + 1 })
    try {
      const result = await request(`/api/complaints/${current.remoteId}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ deviceId: reporterId }),
      })
      const counted = Number(result?.confirmations)
      await patchLocal(clientId, {
        confirmedByMe: true,
        confirmations: Number.isFinite(counted) ? counted : current.confirmations + 1,
      })
      return { ok: true, duplicate: result?.duplicate === true }
    } catch {
      await patchLocal(clientId, { confirmedByMe: false, confirmations: current.confirmations })
      return { ok: false, reason: 'offline' }
    }
  }, [patchLocal, reporterId])

  /**
   * Move a report along its lifecycle.
   *
   * The mirror of `confirm`: legality is checked here first so the UI only ever
   * offers a move that will be accepted, the change is applied locally at once
   * so the tap lands, and the board is told afterwards. What differs is the
   * failure rule, and it differs deliberately.
   *
   * A REFUSED move is a disagreement about what state the report is in, not a
   * failure to retry: the board is the shared record, so its answer is taken and
   * the local move is dropped. An UNREACHABLE board is the opposite — the move
   * is real, this device made it, and it queues for `flush` exactly as an
   * unsynced report does. Rolling a move back because the network was down would
   * discard the one thing the resident actually did.
   */
  const setStatus = useCallback(async (clientId, to, { kind = 'reporter', actorId = null, note = null } = {}) => {
    const current = listRef.current.find(c => c.clientId === clientId)
    if (!current) return { ok: false, reason: 'missing' }

    const from = current.status || 'filed'
    // Already there: the same no-op the server reports, and not an error.
    if (from === to) return { ok: true, duplicate: true }
    if (!canTransition(from, to, kind)) return { ok: false, reason: 'illegal' }
    // A device may only move what it filed — the same ownership rule `remove`
    // applies, and the one the server enforces independently.
    if (kind === 'reporter' && !current.isMine) {
      return { ok: false, reason: 'not-owner' }
    }

    const actor = actorId || (kind === 'reporter' ? reporterId : null)
    const event = {
      from,
      to,
      kind,
      actorId: actor,
      note: note || null,
      at: new Date().toISOString(),
      // A board that does not exist cannot take this, and leaving it unsynced
      // would build a queue that never drains — the same reason `file` marks a
      // record synced when there is nothing to sync it to.
      synced: !API_BASE,
    }
    const previous = {
      status: current.status,
      statusAt: current.statusAt,
      statusKind: current.statusKind,
      statusActor: current.statusActor,
    }

    await patchLocal(clientId, {
      status: to,
      statusAt: event.at,
      statusKind: kind,
      statusActor: actor,
      // Oldest first, dropped from the front: the newest moves are the ones the
      // board still has to hear about, and they are the ones at the end.
      events: [...(current.events || []), event].slice(-MAX_STATUS_EVENTS),
    })

    // No board configured, or a report the board has not taken yet. Either way
    // the move is real and is held on the record; `flush` sends it the moment
    // the report has an id to address it by.
    if (!API_BASE || !current.remoteId) {
      return { ok: true, ...(API_BASE ? { pending: true } : {}) }
    }

    try {
      const result = await request(`/api/complaints/${current.remoteId}/status`, {
        method: 'POST',
        headers: { 'x-demo-token': WRITE_TOKEN, 'x-reporter-id': reporterId },
        body: JSON.stringify({ to, actorKind: kind, actorId: actor, note }),
      })
      await patchLocal(clientId, {
        status: typeof result?.status === 'string' ? result.status : to,
        // The board's clock, not this device's, for a status the board accepted.
        statusAt: result?.event?.createdAt ?? event.at,
        statusKind: kind,
        statusActor: actor,
      })
      await patchEvents(clientId, events => events.map(e => (e.at === event.at ? { ...e, synced: true } : e)))
      return { ok: true }
    } catch (err) {
      const status = Number(err?.status)
      if (status >= 400 && status < 500) {
        // Refused: this device was working from a stale or wrong idea of the
        // report, or is not the party that may make this move. Its version is
        // the shared one, so take it now rather than leaving a status on screen
        // that nothing else agrees with.
        await patchLocal(clientId, { ...previous, events: (current.events || []).filter(e => e.synced) })
        await pull()
        return { ok: false, reason: status === 403 ? 'not-owner' : status === 409 ? 'stale' : 'refused' }
      }
      // Unreachable, or the board is unwell. The move stands and stays queued.
      return { ok: true, pending: true }
    }
  }, [patchLocal, patchEvents, pull, reporterId])

  /**
   * Remove a complaint — only one this device filed.
   *
   * On the shared board the delete is attempted FIRST and the local copy is
   * only swept once the server has agreed. Removing it locally and letting it
   * reappear on the next pull would be the worst of both: the person believes
   * it is gone and it comes back.
   */
  const remove = useCallback(async (clientId) => {
    const current = listRef.current.find(c => c.clientId === clientId)
    if (!current) return { ok: false, reason: 'missing' }
    if (!current.isMine) {
      return { ok: false, reason: 'not-owner' }
    }

    if (API_BASE && current.remoteId) {
      try {
        await request(`/api/complaints/${current.remoteId}`, {
          method: 'DELETE',
          headers: { 'x-reporter-id': reporterId },
        })
      } catch (err) {
        return { ok: false, reason: err?.status === 403 ? 'not-owner' : 'offline' }
      }
    }

    await store.remove(clientId)
    listRef.current = listRef.current.filter(c => c.clientId !== clientId)
    if (mounted.current) setComplaints(list => list.filter(c => c.clientId !== clientId))
    return { ok: true }
  }, [reporterId, store])

  /** A complaint's photos as Blobs, in order. [] when it holds none locally. */
  const loadPhotos = useCallback((clientId) => store.loadPhotos(clientId), [store])

  /** A complaint's clip as a Blob, or null. Used to play one not yet uploaded. */
  const loadVideo = useCallback((clientId) => store.loadVideo(clientId), [store])

  const counts = useMemo(() => countByZone(complaints), [complaints])

  return {
    complaints,
    counts,
    loaded,
    sync,
    file,
    confirm,
    setStatus,
    remove,
    flush,
    pull,
    loadPhotos,
    loadVideo,
    apiConfigured: Boolean(API_BASE),
    // False means records last only for this session — Safari private mode, or
    // a browser with storage blocked. The board says so rather than implying a
    // permanence it does not have.
    durable: store.durable,
  }
}

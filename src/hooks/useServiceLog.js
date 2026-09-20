import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The drain service log — what was cleared, when, and by whom.
 *
 * Local first, shared when it can be. The browser holds the whole log and is
 * the source of truth for the fill model and for what is on screen, so the app
 * behaves identically with no backend at all. When a shared log is configured
 * (VITE_API_BASE_URL) events are also POSTed to it so a count means something
 * beyond one browser's private history — the point of the feature.
 *
 * Honesty rules, inherited from useLahoreData.js:
 *   - A failed write is KEPT, not dropped: it stays in the local log flagged
 *     `synced: false` and is retried. The service genuinely happened.
 *   - A failed read never invents history. Counts fall back to what this
 *     browser knows and the status says so.
 *   - Nothing here can throw into a render.
 *
 * Every event carries a client-generated `id`, which is what makes retries
 * safe: the server stores it as `client_event_id` with a UNIQUE constraint, so
 * a re-sent event is a no-op rather than a duplicate. Without that, a retry
 * after a timeout would double-count a service — and the count is the whole
 * point of the feature.
 *
 * `at` is on the app's simulated clock (`simNow()`), NOT the wall clock. In
 * real-time mode those are the same thing to the millisecond; in time-lapse
 * `at` can be days ahead, which is exactly why `simulated` exists and why
 * simulated events are excluded from the published count (see useCityRisk).
 */

const LOG_KEY = 'nigran-services-v1'
// Legacy keys from when "serviced" was a permanent boolean. Read once, folded
// into the log, never written again.
const LEGACY_DONE_KEY = 'nigran-done'
const LEGACY_DONE_AT_KEY = 'nigran-done-at'

const RAW_BASE = import.meta.env.VITE_API_BASE_URL || ''
const API_BASE = RAW_BASE.replace(/\/+$/, '')
const WRITE_TOKEN = import.meta.env.VITE_DEMO_WRITE_TOKEN || ''

/** How long to wait on the backend before calling it unreachable. */
const TIMEOUT_MS = 10_000

export const SYNC_LOCAL_ONLY = 'local-only'
export const SYNC_SYNCED = 'synced'
export const SYNC_PENDING = 'pending'
export const SYNC_ERROR = 'error'

/** A stable-ish unique id for one service event. */
const newEventId = () => `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

function readLog() {
  try {
    const raw = window.localStorage.getItem(LOG_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    // Reject any entry that is not an array of event-shaped objects, so a
    // corrupted or hand-edited store can never reach the fill model.
    // `typeof === 'number'` rather than `Number.isFinite(Number(...))`: the
    // looser form accepts `null` and `''` as 0, and an event dated 1970 reads as
    // a drain that has been silting up for fifty years — i.e. permanently
    // blocked. Every producer in this file writes a real number, so requiring
    // one costs nothing and makes the guard mean what it says.
    const out = {}
    for (const [drainId, events] of Object.entries(parsed)) {
      if (!Array.isArray(events)) continue
      const clean = events.filter(e => e && typeof e === 'object' && typeof e.at === 'number' && Number.isFinite(e.at))
      if (clean.length) out[drainId] = clean
    }
    return out
  } catch {
    return {}
  }
}

function writeLog(log) {
  try {
    window.localStorage.setItem(LOG_KEY, JSON.stringify(log))
  } catch {
    /* storage unavailable — the log is best-effort, the session still works */
  }
}

/**
 * Fold the old permanent-boolean state into the log, once. A drain marked done
 * becomes one service event; if the old build recorded when, we keep it, and
 * otherwise the session start is the only honest answer available.
 */
function migrateLegacy(readJson) {
  try {
    const done = readJson(LEGACY_DONE_KEY)
    const doneAt = readJson(LEGACY_DONE_AT_KEY)
    if (!done || typeof done !== 'object') return {}
    const log = {}
    for (const [drainId, wasDone] of Object.entries(done)) {
      if (wasDone !== true) continue
      const at = Number(doneAt?.[drainId])
      log[drainId] = [{
        id: `migrated-${drainId}`,
        at: Number.isFinite(at) ? at : Date.now(),
        simulated: false,
        migrated: true,
      }]
    }
    return log
  } catch {
    return {}
  }
}

const readJsonKey = (key) => {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout?.(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`${res.status} ${path}`)
  return res.json()
}

/**
 * The service log.
 *
 * Returns `log` ({ [drainId]: [event, ...] }) — local events merged with what
 * the shared log reports — plus `record`, and a `sync` status the UI can state
 * plainly instead of implying a shared record that is not there.
 */
export function useServiceLog() {
  const [log, setLog] = useState(() => {
    const existing = readLog()
    if (Object.keys(existing).length) return existing
    const migrated = migrateLegacy(readJsonKey)
    if (Object.keys(migrated).length) writeLog(migrated)
    return migrated
  })
  const [sync, setSync] = useState(API_BASE ? SYNC_PENDING : SYNC_LOCAL_ONLY)
  const mounted = useRef(true)
  // A mirror of the log that the async paths can read without depending on a
  // render having happened. `flush` runs from an interval, so it must not rely
  // on the closure's `log` being the current one.
  const logRef = useRef(log)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // Persist on every change. Cheap, and it keeps the log correct even if the
  // tab is closed mid-session.
  useEffect(() => {
    logRef.current = log
    writeLog(log)
  }, [log])

  const record = useCallback((drainId, event = {}) => {
    if (!drainId) return null
    const entry = {
      id: newEventId(),
      at: Number.isFinite(Number(event.at)) ? Number(event.at) : Date.now(),
      simulated: event.simulated === true,
      speed: event.speed ?? null,
      crewId: event.crewId ?? null,
      fillAtService: Number.isFinite(Number(event.fillAtService)) ? Number(event.fillAtService) : null,
      synced: !API_BASE,
    }
    // Local write first and synchronously — the drain IS cleared whether or not
    // the network cooperates, and the fill model must see it immediately.
    setLog(current => ({ ...current, [drainId]: [...(current[drainId] || []), entry] }))
    return entry
  }, [])

  /** Push every event this browser holds but the shared log has not accepted. */
  const flush = useCallback(async () => {
    if (!API_BASE) return
    const pending = []
    for (const [drainId, events] of Object.entries(logRef.current)) {
      for (const e of events) if (!e.synced) pending.push({ drainId, event: e })
    }
    if (!pending.length) { setSync(SYNC_SYNCED); return }
    const accepted = []
    let failed = false
    for (const { drainId, event } of pending) {
      try {
        await request('/api/services', {
          method: 'POST',
          headers: { 'x-demo-token': WRITE_TOKEN },
          body: JSON.stringify({
            clientEventId: event.id,
            drainId,
            crewId: event.crewId,
            // The shared record is stamped with the REAL time of service even
            // when the clock was accelerated, so the row is true about the
            // world. `servicedAt` is therefore wall clock; `at` (simulated) is
            // deliberately not what leaves this browser.
            servicedAt: new Date().toISOString(),
            fillAtService: event.fillAtService,
            simulated: event.simulated === true,
            speed: event.speed,
          }),
        })
        accepted.push(event.id)
      } catch {
        failed = true
      }
    }
    if (accepted.length && mounted.current) {
      const ids = new Set(accepted)
      setLog(current => {
        const next = {}
        for (const [drainId, events] of Object.entries(current)) {
          next[drainId] = events.map(e => (ids.has(e.id) ? { ...e, synced: true } : e))
        }
        return next
      })
    }
    if (mounted.current) setSync(failed ? SYNC_ERROR : SYNC_SYNCED)
  }, [])

  /** Merge the shared log in, without ever overwriting a local event. */
  const pull = useCallback(async () => {
    if (!API_BASE) return
    try {
      const data = await request('/api/services?limit=500')
      const remote = Array.isArray(data?.events) ? data.events : []
      if (!mounted.current) return
      setLog(current => {
        const next = { ...current }
        for (const r of remote) {
          const drainId = r?.drainId
          const at = Date.parse(r?.servicedAt)
          if (!drainId || !Number.isFinite(at)) continue
          const id = r.clientEventId || `remote-${r.id}`
          const list = next[drainId] || []
          if (list.some(e => e.id === id)) continue
          next[drainId] = [...list, {
            id,
            at,
            simulated: r.simulated === true,
            speed: r.speed ?? null,
            crewId: r.crewId ?? null,
            fillAtService: r.fillAtService ?? null,
            synced: true,
            remote: true,
          }]
        }
        return next
      })
      setSync(SYNC_SYNCED)
    } catch {
      // Unreachable shared log is not an error state for the app — the local
      // log is complete on its own. Say so, do not pretend to be synced.
      if (mounted.current) setSync(SYNC_ERROR)
    }
  }, [])

  useEffect(() => {
    if (!API_BASE) return
    pull().then(flush)
    // Retry on a slow cadence: a service recorded while offline should reach
    // the shared log without the user reloading.
    const id = setInterval(() => { pull().then(flush) }, 60_000)
    return () => clearInterval(id)
  }, [pull, flush])

  return { log, record, sync, flush, pull, apiConfigured: Boolean(API_BASE) }
}

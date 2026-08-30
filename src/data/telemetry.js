/**
 * Drain telemetry simulation — a time-driven model, not static numbers.
 *
 * Every drain's fill level RISES steadily from its calibrated seed value
 * (paper-calibrated starting points in lahore.js), at a rate scaled by the
 * zone's waste burden. Servicing empties a drain to ~5% and the model refills
 * it from there — exactly like the daily routine: clear it today, it starts
 * filling again tonight.
 *
 * Determinism: the fill level is a pure function of (drain seed, wall clock,
 * last-serviced timestamp). No timers, no random drift — a reload five minutes
 * later shows a level five minutes higher. The clock keeps moving in real time
 * so the UI can tick it forward live.
 */

const HOUR_MS = 3600 * 1000

/**
 * Fill-rate multiplier per drain — calibrated so the fastest-filling trunk
 * drain (D-1, Shahdara) goes from empty to full in ~9 days, matching the
 * published ~0.84 kg/cap/day generation × 60% collection gap (Batool & Ch
 * 2009): drains in high-waste corridors silt up in one to two weeks.
 * Slower residential drains take ~2–3 weeks.
 */
export const FILL_RATE_PCT_PER_DAY = {
  d1: 11, // Shahdara trunk — heaviest corridor
  d2: 8,
  d3: 9,
  d4: 7,
  d5: 6,
  d6: 5,
  d7: 5,
  d8: 7,
}

/**
 * Compute the CURRENT fill level of a drain at wall-clock time `nowMs`.
 *
 * - Unserved: fill rises linearly from the seed's implied "last serviced"
 *   point. The seed (fillPct + lastServiceHrs) anchors the model so the
 *   initial UI matches the calibrated paper values on first paint.
 * - Serviced at time T (from the done map): fill restarts at 5% and climbs
 *   at the drain's rate — so a drain serviced yesterday already shows a few
 *   percent back, and needs maintenance again in a realistic interval.
 *
 * Returns an integer 0–100.
 */
export function currentFillPct(node, nowMs = Date.now(), servicedAtMs = null) {
  const ratePerHour = (FILL_RATE_PCT_PER_DAY[node.id] ?? 6) / 24
  if (servicedAtMs != null) {
    const hoursSince = Math.max(0, (nowMs - servicedAtMs) / HOUR_MS)
    return Math.min(100, Math.round(5 + ratePerHour * hoursSince))
  }
  // Anchor: `lastServiceHrs` hours ago the drain was at (fillPct - growth).
  // Rewinding to that point and rolling forward keeps the model continuous
  // with the seed values on first load.
  const anchorFill = Math.max(5, node.fillPct - ratePerHour * node.lastServiceHrs)
  const anchorMs = nowMs - node.lastServiceHrs * HOUR_MS
  const hoursSinceAnchor = Math.max(0, (nowMs - anchorMs) / HOUR_MS)
  return Math.min(100, Math.round(anchorFill + ratePerHour * hoursSinceAnchor))
}

/**
 * Apply the time-driven model to the drain node list.
 * doneMap: { [drainId]: true } — legacy "serviced" flag → serviced at first
 * render of this session. doneAtMap: { [drainId]: epochMs } — real timestamps.
 * Returns new node objects; inputs are never mutated.
 */
export function applyLiveTelemetry(nodes, nowMs = Date.now(), doneMap = {}, doneAtMap = {}) {
  return (nodes || []).map(node => {
    const servicedAt = doneAtMap[node.id] ?? (doneMap[node.id] === true ? nowMs : null)
    const fillPct = currentFillPct(node, nowMs, servicedAt)
    // Unserved hours for the UI: serviced drains count from their service time
    const lastServiceHrs = servicedAt != null
      ? Math.max(0, Math.floor((nowMs - servicedAt) / HOUR_MS))
      : node.lastServiceHrs
    return { ...node, fillPct, lastServiceHrs }
  })
}

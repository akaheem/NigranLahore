/**
 * Drain telemetry simulation — a time-driven model, not static numbers.
 *
 * Every drain's fill level RISES steadily from its calibrated seed value
 * (paper-calibrated starting points in lahore.js), at a rate scaled by the
 * zone's waste burden. Servicing empties a drain to ~5% and the model refills
 * it from there — exactly like the daily routine: clear it today, it starts
 * filling again tonight, and in a few days it is work again.
 *
 * The lifecycle that refill drives is defined by SERVICE_POLICY (calibration.js):
 * serviced below 40%, due at 40%, critical at 80%, and BLOCKED at 95% — where
 * the cap below pins it. A blocked drain is the terminal state: it cannot get
 * worse, so the model holds it at exactly 95% until someone clears it. Only
 * that drain stops; every other drain keeps climbing on the same clock.
 *
 * Determinism: the fill level is a pure function of (drain seed, elapsed
 * simulated time, last-serviced timestamp). No timers, no random drift — move
 * the clock and every level follows it. `nowMs` is the caller's clock, which
 * is the wall clock in real-time mode and a 1440x time-lapse otherwise; the
 * model never cares which, because every timestamp it compares comes from that
 * one clock. Nothing here reads the system clock on its own.
 *
 * `elapsedHours` is how much simulated time has passed since the session
 * started. At 0 a drain sits exactly on its calibrated seed, which is why the
 * first paint matches the paper values; as it grows the drain climbs at its
 * own rate, so a time-lapse moves drains nobody has serviced yet.
 */

import { SERVICE_POLICY } from './calibration.js'

const HOUR_MS = 3600 * 1000

/** The fill ceiling — a blocked drain's terminal state, not a full one. */
export const FILL_CAP_PCT = SERVICE_POLICY.blockedAt


/**
 * Round to two decimals — and stay a Number. Fill levels are displayed to two
 * places because the decimals are the point: they are what makes a refill look
 * like it is moving rather than like a static integer. Returning a string here
 * would silently change the type every consumer does arithmetic on.
 */
const round2 = (x) => Math.round(x * 100) / 100

/**
 * Clock modes. `REAL_TIME` is the model as it actually runs. `TIME_LAPSE` is a
 * demonstration mode that runs the SAME model 1440x: one real minute is one
 * simulated day, so D-1's calibrated 11%/day arrives in a minute of watching.
 * The rates below do not change between them — only the clock feeding them.
 */
export const REAL_TIME = 1
export const TIME_LAPSE = 1440

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
 * Compute the CURRENT fill level of a drain.
 *
 * - Untouched: the calibrated seed is where the drain stood when the session
 *   began, and it silts up from there at its own rate. Zero elapsed time
 *   returns the seed exactly, so first paint matches the calibrated values.
 * - Serviced at time T: fill restarts at ~5% and climbs at the drain's rate —
 *   so a drain serviced a simulated day ago already shows its full day of
 *   refill, and is work again once it crosses SERVICE_POLICY.dueAt.
 *
 * Both branches cap at FILL_CAP_PCT (95%). That cap IS the freeze: because
 * fill is a pure function of elapsed time, a drain left long enough simply
 * arrives at 95.00 and stays there — no latch, no extra state, and no way for
 * a neglected drain to drift past the terminal state into a fictitious 100%.
 *
 * Returns a Number 0–95, rounded to two decimal places.
 */
export function currentFillPct(node, nowMs = Date.now(), servicedAtMs = null, elapsedHours = 0) {
  const ratePerHour = (FILL_RATE_PCT_PER_DAY[node.id] ?? 6) / 24
  if (servicedAtMs != null) {
    // Serviced: the clock starts at the service time and the drain refills
    // from the cleared level at its own rate.
    const hoursSince = Math.max(0, (nowMs - servicedAtMs) / HOUR_MS)
    return round2(Math.min(FILL_CAP_PCT, SERVICE_POLICY.clearedTo + ratePerHour * hoursSince))
  }
  // Untouched: the calibrated seed is the value at the start of the session,
  // and the drain keeps silting up from exactly there. `lastServiceHrs` is not
  // part of this sum — the seed already accounts for it, and rewinding by it
  // only to roll forward again cancels out, which would leave every unserviced
  // drain frozen on its seed no matter how the clock moved.
  return round2(Math.min(FILL_CAP_PCT, node.fillPct + ratePerHour * elapsedHours))
}

/**
 * Apply the time-driven model to the drain node list.
 *
 * `serviceAtMap`: { [drainId]: epochMs } — when each drain was last serviced,
 * on the same clock `nowMs` comes from (which is what `simNow()` hands out).
 * A drain absent from the map has never been serviced and sits on its seed.
 *
 * Returns new node objects; inputs are never mutated.
 */
export function applyLiveTelemetry(nodes, nowMs = Date.now(), serviceAtMap = {}, elapsedHours = 0) {
  return (nodes || []).map(node => {
    const servicedAt = serviceAtMap?.[node.id] ?? null
    const fillPct = currentFillPct(node, nowMs, servicedAt, elapsedHours)
    // Unserved hours for the UI: serviced drains count from their service time,
    // untouched ones age with the simulated clock like everything else.
    const lastServiceHrs = servicedAt != null
      ? Math.max(0, Math.floor((nowMs - servicedAt) / HOUR_MS))
      : Math.floor(node.lastServiceHrs + elapsedHours)
    return { ...node, fillPct, lastServiceHrs }
  })
}

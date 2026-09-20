import { describe, it, expect } from 'vitest'
import {
  currentFillPct, applyLiveTelemetry, FILL_CAP_PCT,
  FILL_RATE_PCT_PER_DAY, REAL_TIME, TIME_LAPSE,
} from '../../src/data/telemetry.js'
import { SERVICE_POLICY } from '../../src/data/calibration.js'
import { DRAIN_NODES } from '../../src/data/lahore.js'

const HOUR = 3600 * 1000

// A fixed instant, so nothing here depends on the machine's clock. The model
// only ever compares timestamps it is handed, so any instant will do.
const T0 = Date.UTC(2026, 8, 19, 12, 0, 0)

const d1 = DRAIN_NODES.find(n => n.id === 'd1')
const fillOf = (nodes, id) => nodes.find(n => n.id === id).fillPct

describe('clock modes', () => {
  it('is two modes, real time and a 1440x lapse', () => {
    expect(REAL_TIME).toBe(1)
    expect(TIME_LAPSE).toBe(1440)
  })
})

describe('currentFillPct', () => {
  it('returns a Number, never a formatted string', () => {
    // The whole point of the 2-decimal change is presentation. If this ever
    // returns "5.00", every consumer doing arithmetic on it breaks silently.
    for (const n of DRAIN_NODES) expect(typeof currentFillPct(n, T0)).toBe('number')
  })

  it('never emits more than two decimal places', () => {
    for (const n of DRAIN_NODES) {
      for (const h of [0, 1, 7, 25, 100, 733]) {
        const v = currentFillPct(n, T0 + h * HOUR, null, h)
        expect(v).toBe(Math.round(v * 100) / 100)
      }
    }
  })

  it('sits exactly on the calibrated seed before any time has passed', () => {
    // This is what makes first paint match the paper values.
    for (const n of DRAIN_NODES) expect(currentFillPct(n, T0)).toBe(n.fillPct)
  })

  it('ignores which instant it is asked about, only how much time has passed', () => {
    // The seed carries its own "last touched N hours ago"; shifting the
    // instant must not move a drain that no simulated time has reached.
    for (const n of DRAIN_NODES) expect(currentFillPct(n, T0 + 5 * HOUR)).toBe(n.fillPct)
  })

  it('climbs at each drain own calibrated rate per simulated day', () => {
    // Measured over half a day rather than a whole one: D-1's seed plus a full
    // day would cross the 95% cap and understate its rate, which would make
    // this pass for the wrong reason.
    for (const n of DRAIN_NODES) {
      const rate = FILL_RATE_PCT_PER_DAY[n.id]
      const grown = currentFillPct(n, T0, null, 12) - n.fillPct
      expect(grown).toBeCloseTo(rate / 2, 2)
    }
    // And the full day is exactly what the cap absorbs, for the one drain that
    // reaches it.
    expect(currentFillPct(d1, T0, null, 24)).toBe(FILL_CAP_PCT)
    expect(d1.fillPct + FILL_RATE_PCT_PER_DAY.d1).toBeGreaterThan(FILL_CAP_PCT)
  })

  it('moves, so a real-time session is not frozen on the seeds', () => {
    // One real minute of D-1 is 11/24/60 = 0.0076% — one hundredth of a point
    // once rounded, which is exactly why the fill is shown to two decimals.
    const afterAMinute = currentFillPct(d1, T0, null, 1 / 60)
    expect(afterAMinute).toBeGreaterThan(87)
    expect(currentFillPct(d1, T0, null, 1)).toBeGreaterThan(afterAMinute)
  })

  it('stays monotonic and clamps at the blocked cap, not at full', () => {
    let prev = 0
    for (let h = 0; h <= 24 * 60; h += 6) {
      const v = currentFillPct(d1, T0, null, h)
      expect(v).toBeGreaterThanOrEqual(prev)
      expect(v).toBeLessThanOrEqual(FILL_CAP_PCT)
      prev = v
    }
    expect(FILL_CAP_PCT).toBe(SERVICE_POLICY.blockedAt)
    expect(currentFillPct(d1, T0, null, 24 * 365)).toBe(FILL_CAP_PCT)
  })

  it('freezes a neglected drain at exactly 95%, however long it is left', () => {
    // The freeze needs no latch: the cap is applied to a pure function of
    // elapsed time, so a drain that reaches the terminal state simply stops
    // there. A year and a decade must read the same.
    expect(currentFillPct(d1, T0, null, 24 * 365)).toBe(95)
    expect(currentFillPct(d1, T0, null, 24 * 365 * 10)).toBe(95)
    // And it is pinned, not merely capped once: still exactly 95 at 2 dp, so
    // the card shows a drain that has genuinely stopped rather than one
    // creeping upward.
    expect(currentFillPct(d1, T0, null, 24 * 400)).toBe(95.0)
  })

  it('freezes a serviced drain at the cap too, once it refills that far', () => {
    // D-1 serviced, then left: 5% + 11%/day, capping out after ~9 days.
    expect(currentFillPct(d1, T0 + 24 * 9 * HOUR, T0)).toBe(95)
    expect(currentFillPct(d1, T0 + 24 * 900 * HOUR, T0)).toBe(95)
  })

  it('stops only the drain that reached the cap, not the ones beside it', () => {
    // The model is per-drain and pure, so a blocked drain cannot hold up its
    // neighbours — each is computed from its own seed and its own elapsed time.
    // One simulated day on: D-1 (87% + 11) has crossed the cap; D-6 (35% + 5)
    // and D-2 (74% + 8) are climbing exactly as before.
    const out = applyLiveTelemetry(DRAIN_NODES, T0, {}, 24)
    expect(fillOf(out, 'd1')).toBe(95)
    expect(fillOf(out, 'd6')).toBe(40)
    expect(fillOf(out, 'd2')).toBe(82)
  })

  it('puts a serviced drain back at 5% and refills it at its own rate', () => {
    expect(currentFillPct(d1, T0, T0)).toBe(5)
    // D-1's calibrated 11%/day, delivered as one simulated day.
    expect(currentFillPct(d1, T0 + 24 * HOUR, T0)).toBe(16)
    expect(currentFillPct(d1, T0 + 48 * HOUR, T0)).toBe(27)
  })

  it('clears a blocked drain back to the cleared level and restarts the cycle', () => {
    // Serviced at the moment it was sitting pinned at 95: it drops to 5 and
    // begins again, which is the whole point of the lifecycle.
    expect(currentFillPct(d1, T0, T0)).toBe(SERVICE_POLICY.clearedTo)
    expect(currentFillPct(d1, T0 + 24 * HOUR, T0)).toBeLessThan(
      currentFillPct(d1, T0, null, 0),
    )
  })

  it('never reports a drained drain below empty or above the cap', () => {
    expect(currentFillPct(d1, T0 + 24 * 365 * HOUR, T0)).toBe(FILL_CAP_PCT)
  })

  it('treats a service timestamp in the future as zero elapsed, not negative', () => {
    expect(currentFillPct(d1, T0, T0 + 5 * HOUR)).toBe(5)
  })
})

describe('applyLiveTelemetry', () => {
  it('never mutates the node list it is given', () => {
    const before = JSON.stringify(DRAIN_NODES)
    applyLiveTelemetry(DRAIN_NODES, T0, { d1: T0 }, 48)
    expect(JSON.stringify(DRAIN_NODES)).toBe(before)
  })

  it('carries the 2-decimal fill through to every node', () => {
    const out = applyLiveTelemetry(DRAIN_NODES, T0, {}, 12)
    expect(out).toHaveLength(DRAIN_NODES.length)
    for (const n of out) expect(typeof n.fillPct).toBe('number')
    // Twelve simulated hours of D-1's 11%/day is +5.5.
    expect(fillOf(out, 'd1') - 87).toBeCloseTo(5.5, 1)
  })

  it('ages untouched drains on the simulated clock too', () => {
    expect(applyLiveTelemetry(DRAIN_NODES, T0, {}, 0).find(n => n.id === 'd1').lastServiceHrs).toBe(52)
    expect(applyLiveTelemetry(DRAIN_NODES, T0, {}, 24).find(n => n.id === 'd1').lastServiceHrs).toBe(76)
  })

  it('empties a serviced drain and counts its hours from the service time', () => {
    const out = applyLiveTelemetry(DRAIN_NODES, T0 + 2 * HOUR, { d1: T0 })
    const d = out.find(n => n.id === 'd1')
    expect(d.lastServiceHrs).toBe(2)
    expect(d.fillPct).toBe(currentFillPct(DRAIN_NODES.find(n => n.id === 'd1'), T0 + 2 * HOUR, T0))
    expect(d.fillPct).toBeLessThan(6)
  })

  it('leaves unrelated drains on their seeds after a service', () => {
    const out = applyLiveTelemetry(DRAIN_NODES, T0, { d1: T0 })
    expect(fillOf(out, 'd2')).toBe(74)
  })

  it('is null-safe on an empty or missing list', () => {
    expect(applyLiveTelemetry([], T0)).toEqual([])
    expect(applyLiveTelemetry(null, T0)).toEqual([])
  })
})

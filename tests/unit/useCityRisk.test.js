import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCityRisk } from '../../src/hooks/useCityRisk.js'
import { ZONES, DRAIN_NODES } from '../../src/data/lahore.js'
import { SERVICE_POLICY } from '../../src/data/calibration.js'
import { REAL_TIME, TIME_LAPSE } from '../../src/data/telemetry.js'

const weather = {
  tempC: 34, humidityPct: 60, rainNowMm: 0,
  rain6hMm: 12, rain24hMm: 5,
  next6h: [1, 2, 3, 2, 2, 2], next6hProb: [10, 20, 30, 30, 30, 30],
  next24h: Array.from({ length: 24 }, (_, i) => i), next24hProb: [], next24hTime: [],
  hourlyTime: ['2026-08-29T10:00', '2026-08-29T11:00', '2026-08-29T12:00', '2026-08-29T13:00', '2026-08-29T14:00', '2026-08-29T15:00'],
  fetchedAt: new Date(),
}

const air = { pm25: 70, pm10: 140, usAqi: 150, aqiSeries: [150, 150, 150], aqiTime: ['2026-08-29T08:00', '2026-08-29T09:00', '2026-08-29T10:00'], fetchedAt: new Date() }

vi.mock('../../src/hooks/useLahoreData.js', () => ({
  useLahoreData: () => ({
    weather, air, error: null, status: 'live', lastUpdated: new Date(), retry: vi.fn(),
  }),
}))

describe('useCityRisk', () => {
  const { result } = renderHook(() => useCityRisk())
  const risk = result.current

  it('scores all 8 zones', () => {
    expect(Object.keys(risk.zoneScores)).toHaveLength(8)
    for (const z of ZONES) {
      expect(risk.zoneScores[z.id].score).toBeGreaterThanOrEqual(0)
      expect(risk.zoneScores[z.id].score).toBeLessThanOrEqual(100)
    }
  })

  it('sorts the task queue by priority descending', () => {
    const priorities = risk.taskQueue.map(t => t.priority)
    expect([...priorities].sort((a, b) => b - a)).toEqual(priorities)
  })

  it('carries real population + zoneId on tasks', () => {
    const shahdara = risk.taskQueue.find(t => t.zoneId === 'shahdara')
    expect(shahdara.population).toBe(190000)
    expect(shahdara.zoneName).toBe('Shahdara')
  })

  it('passes rain through as a number when live', () => {
    expect(risk.rain6hMm).toBe(12)
  })

  it('computes air and heat cards', () => {
    expect(risk.air.score).toBeGreaterThan(0)
    expect(risk.air.series).toHaveLength(3)
    expect(risk.heat.score).toBeGreaterThanOrEqual(0)
  })

  it('exposes floodWhyFor and status passthrough', () => {
    const zone = ZONES[0]
    expect(risk.floodWhyFor(zone)).toEqual(expect.any(Array))
    expect(risk.status).toBe('live')
    expect(typeof risk.retry).toBe('function')
  })
})

describe('useCityRisk drain card', () => {
  it('flags a missing selected zone instead of scoring a phantom one', () => {
    const { result } = renderHook(() => useCityRisk())
    expect(result.current.drainCard.score).toBe(0)
    expect(result.current.drainCard.missing.zone).toBe(true)
  })

  it('scores the selected zone off its own drain telemetry', () => {
    const { result } = renderHook(() => useCityRisk({}, 'shahdara'))
    const { drainCard } = result.current
    expect(drainCard.worstDrain.zone).toBe('shahdara')
    expect(drainCard.missing.blockage).toBe(false)
    expect(drainCard.parts.capacity).toBe(62) // 1 − Shahdara's 0.38 design-storm share
    expect(drainCard.score).toBeGreaterThan(0)
  })

  it('follows the selection when the zone changes', () => {
    const dha = renderHook(() => useCityRisk({}, 'dha')).result.current.drainCard
    const shahdara = renderHook(() => useCityRisk({}, 'shahdara')).result.current.drainCard
    expect(dha.worstDrain.zone).toBe('dha')
    expect(dha.parts.capacity).toBe(20) // 1 − 0.80
    expect(shahdara.score).toBeGreaterThan(dha.score)
  })
})

describe('useCityRisk with a service log', () => {
  // Realistic inputs; rain6hMm is constant (12mm from the shared mock) so any
  // score change is driven purely by the service log.
  const shahdara = ZONES.find(z => z.id === 'shahdara')
  const servicedAt = Date.now()

  /** One service event per drain id, on the app's clock. */
  const logOf = (ids, extra = {}) =>
    Object.fromEntries(ids.map(id => [id, [{ id: `e-${id}`, at: servicedAt, simulated: false, ...extra }]]))

  const { result: before } = renderHook(() => useCityRisk())
  const scoreBefore = before.current.zoneScores.shahdara.score

  const { result: after } = renderHook(() => useCityRisk(logOf(['d1'])))
  const afterRisk = after.current

  it('drops the shahdara flood score after servicing d1', () => {
    expect(afterRisk.zoneScores.shahdara.score).toBeLessThan(scoreBefore)
  })

  it('reflects the serviced drain in floodWhyFor (no more 87%-full warning)', () => {
    expect(afterRisk.floodWhyFor(shahdara).join(' ')).not.toMatch(/87% full/)
  })

  it('sinks serviced tasks to the end of the task queue', () => {
    const ids = afterRisk.taskQueue.map(t => t.id)
    expect(ids.indexOf('d1')).toBe(ids.length - 1)
    // every open task still precedes the serviced one
    expect(ids.slice(0, -1)).not.toContain('d1')
  })

  it('keeps serviced-task telemetry simulated as freshly serviced', () => {
    const d1 = afterRisk.taskQueue.find(t => t.id === 'd1')
    expect(d1.fillPct).toBe(5)
    expect(d1.lastServiceHrs).toBe(0)
  })

  it('tags a cleared drain as serviced and therefore closed', () => {
    const d1 = afterRisk.taskQueue.find(t => t.id === 'd1')
    expect(d1.state).toBe('serviced')
    expect(d1.open).toBe(false)
  })

  it('leaves every drain that has never been serviced open, D-6 included', () => {
    // D-6's calibrated seed is 35% — below the due line, but with no service
    // behind it there is nothing for it to wait for, so it stays work.
    const d6 = before.current.taskQueue.find(t => t.id === 'd6')
    expect(d6.fillPct).toBeLessThan(SERVICE_POLICY.dueAt)
    expect(d6.state).toBe('due')
    expect(d6.open).toBe(true)
    expect(before.current.taskQueue.filter(t => t.open)).toHaveLength(DRAIN_NODES.length)
  })

  it('counts services per drain, and keeps simulated ones out of the count', () => {
    const log = {
      d1: [
        { id: 'a', at: servicedAt, simulated: false },
        { id: 'b', at: servicedAt, simulated: false },
        // A time-lapse session records its own history but must never inflate
        // the published maintenance count.
        { id: 'c', at: servicedAt, simulated: true },
      ],
    }
    const { result } = renderHook(() => useCityRisk(log))
    const d1 = result.current.taskQueue.find(t => t.id === 'd1')
    expect(d1.serviceCount).toBe(2)
    expect(d1.serviceEvents).toHaveLength(3)
    expect(result.current.taskQueue.find(t => t.id === 'd2').serviceCount).toBe(0)
  })

  it('drives the fill model from the LATEST event, not the first', () => {
    const log = { d1: [
      { id: 'old', at: servicedAt - 48 * 3600_000, simulated: false },
      { id: 'new', at: servicedAt, simulated: false },
    ] }
    const { result } = renderHook(() => useCityRisk(log))
    const d1 = result.current.taskQueue.find(t => t.id === 'd1')
    expect(d1.fillPct).toBe(5)
    expect(d1.lastServiceAt).toBe(servicedAt)
  })

  it('ignores a malformed log entry rather than throwing into a render', () => {
    const log = { d1: [{ id: 'x', at: 'not-a-time' }, null, { id: 'ok', at: servicedAt, simulated: false }] }
    const { result } = renderHook(() => useCityRisk(log))
    expect(result.current.taskQueue.find(t => t.id === 'd1').fillPct).toBe(5)
  })

  it('survives a null or absent log', () => {
    for (const log of [null, undefined, {}]) {
      const { result } = renderHook(() => useCityRisk(log))
      expect(result.current.taskQueue).toHaveLength(DRAIN_NODES.length)
    }
  })
})

describe('useCityRisk — the simulation clock', () => {
  // Fake timers so a real minute of lapse can be played out instantly. `Date`
  // is faked too: the clock reads it directly, so a faked Date IS the wall
  // clock as far as this hook is concerned.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  })
  afterEach(() => { vi.useRealTimers() })

  const fillOf = (risk, id) => risk.drainNodes.find(n => n.id === id).fillPct

  it('starts on real time and folds the clock once a minute', () => {
    const { result } = renderHook(() => useCityRisk())
    expect(result.current.speed).toBe(REAL_TIME)

    const seed = fillOf(result.current, 'd1')
    act(() => { vi.advanceTimersByTime(59_000) })
    expect(fillOf(result.current, 'd1')).toBe(seed)

    act(() => { vi.advanceTimersByTime(1_000) })
    expect(fillOf(result.current, 'd1')).toBeGreaterThan(seed)
  })

  it('answers simNow() before the first tick has ever run', () => {
    // The integration buffer is created on first use rather than during render,
    // so this is the guard on that: a call arriving before any tick has fired
    // still has to know what time it is, and must answer the wall clock rather
    // than reading a buffer that has not been built yet. Nothing in the app
    // waits a minute before allowing the first service.
    const { result } = renderHook(() => useCityRisk())
    expect(result.current.simNow()).toBe(Date.now())
  })

  it('hands out the wall clock itself while the clock is real', () => {
    // The whole reason simNow() exists: in real-time mode it has to BE
    // Date.now(), to the millisecond, or the servicing path changes behaviour
    // in the default mode.
    const { result } = renderHook(() => useCityRisk())
    act(() => { vi.advanceTimersByTime(600_000) })
    expect(result.current.simNow()).toBe(Date.now())
  })

  it('runs one real minute as one simulated day in the lapse', () => {
    const { result } = renderHook(() => useCityRisk())
    act(() => { result.current.setSpeed(TIME_LAPSE) })
    expect(result.current.speed).toBe(TIME_LAPSE)

    const before = result.current.simNow()
    const seedD1 = fillOf(result.current, 'd1')
    const seedD2 = fillOf(result.current, 'd2')

    act(() => { vi.advanceTimersByTime(60_000) })

    expect(result.current.simNow() - before).toBe(24 * 3_600_000)
    // The rates are untouched — only the clock feeding them moved. D-2's
    // calibrated 8%/day arrives in full inside a minute. D-1's 11% would take
    // it to 98, past the blocked cap, so it lands on 95 instead: the cap is
    // part of the model, not a display rounding.
    expect(fillOf(result.current, 'd2') - seedD2).toBeCloseTo(8, 1)
    expect(seedD1 + 11).toBeGreaterThan(SERVICE_POLICY.blockedAt)
    expect(fillOf(result.current, 'd1')).toBe(SERVICE_POLICY.blockedAt)
  })

  it('does not rewind the clock when the lapse is switched off', () => {
    const { result } = renderHook(() => useCityRisk())
    act(() => { result.current.setSpeed(TIME_LAPSE) })
    act(() => { vi.advanceTimersByTime(30_000) }) // half a minute → 12 simulated hours

    const midSim = result.current.simNow()
    const midFill = fillOf(result.current, 'd1')
    expect(midFill).toBeGreaterThan(87)

    act(() => { result.current.setSpeed(REAL_TIME) })

    // Drains un-filling because someone changed modes would read as a bug in
    // the model. The simulated clock simply stays where the lapse left it.
    expect(result.current.simNow()).toBe(midSim)
    expect(fillOf(result.current, 'd1')).toBe(midFill)

    // ...and keeps moving forward from there, at the old rate.
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(result.current.simNow()).toBe(midSim + 60_000)
    expect(fillOf(result.current, 'd1')).toBeGreaterThan(midFill)
  })

  it('stamps a service time on the simulated clock, not the wall clock', () => {
    // The trap: stamp a service on Date.now() while the lapse is running and
    // the model, reading that stamp back against its own 1440x clock, sees a
    // drain cleared this instant as a day old — 16.00% full instead of 5.00.
    // This is why `useServiceLog.record` is handed `simNow()`.
    const { result, rerender } = renderHook(
      ({ log }) => useCityRisk(log),
      { initialProps: { log: {} } },
    )
    act(() => { result.current.setSpeed(TIME_LAPSE) })
    act(() => { vi.advanceTimersByTime(60_000) }) // a simulated day has gone by

    const servicedAt = result.current.simNow()
    act(() => { rerender({ log: { d1: [{ id: 'e1', at: servicedAt, simulated: true, speed: TIME_LAPSE }] } }) })

    expect(result.current.drainNodes.find(n => n.id === 'd1').fillPct).toBe(5)
    expect(result.current.drainNodes.find(n => n.id === 'd1').lastServiceHrs).toBe(0)
    // and the drains nobody touched are a simulated day further along
    expect(fillOf(result.current, 'd2')).toBeGreaterThan(74)
  })

  it('reopens a serviced drain by itself once it refills past the due line', () => {
    // The heart of the lifecycle: nothing marks a drain as work again. It is
    // work again because time passed and its fill crossed 40%.
    const { result, rerender } = renderHook(({ log }) => useCityRisk(log), { initialProps: { log: {} } })
    act(() => { result.current.setSpeed(TIME_LAPSE) })

    const servicedAt = result.current.simNow()
    act(() => { rerender({ log: { d1: [{ id: 'e1', at: servicedAt, simulated: true }] } }) })
    const cleared = result.current.taskQueue.find(t => t.id === 'd1')
    expect(cleared.open).toBe(false)

    // D-1 fills at 11%/day from 5%, so 40% arrives about 3.2 simulated days on
    // — a little over three real minutes of lapse.
    act(() => { vi.advanceTimersByTime(3 * 60_000 + 15_000) })
    const reopened = result.current.taskQueue.find(t => t.id === 'd1')
    expect(reopened.fillPct).toBeGreaterThanOrEqual(SERVICE_POLICY.dueAt)

    act(() => { vi.advanceTimersByTime(60_000) }) // fold the clock for the rerender
    rerender({ log: { d1: [{ id: 'e1', at: servicedAt, simulated: true }] } })
    const t = result.current.taskQueue.find(x => x.id === 'd1')
    expect(t.open).toBe(true)
    expect(t.state).toBe('due')
    expect(t.serviceCount).toBe(0) // simulated, so not counted
  })

  it('freezes a blocked drain at 95% while its neighbours keep moving', () => {
    const { result } = renderHook(() => useCityRisk())
    act(() => { result.current.setSpeed(TIME_LAPSE) })
    // D-1's seed is 87% and it fills at 11%/day, so about 18 simulated hours —
    // 45 real seconds — takes it to the terminal state.
    act(() => { vi.advanceTimersByTime(45_000) })

    expect(fillOf(result.current, 'd1')).toBe(95)
    const others = fillOf(result.current, 'd6')
    act(() => { vi.advanceTimersByTime(30_000) })
    // It has stopped; nothing else has.
    expect(fillOf(result.current, 'd1')).toBe(95)
    expect(fillOf(result.current, 'd6')).toBeGreaterThan(others)
    expect(result.current.taskQueue.find(t => t.id === 'd1').state).toBe('blocked')
  })
})

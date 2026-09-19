import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCityRisk } from '../../src/hooks/useCityRisk.js'
import { ZONES, DRAIN_NODES } from '../../src/data/lahore.js'
import { applyServicedState } from '../../src/lib/risk.js'

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
    const { result } = renderHook(() => useCityRisk({}, {}, 'shahdara'))
    const { drainCard } = result.current
    expect(drainCard.worstDrain.zone).toBe('shahdara')
    expect(drainCard.missing.blockage).toBe(false)
    expect(drainCard.parts.capacity).toBe(62) // 1 − Shahdara's 0.38 design-storm share
    expect(drainCard.score).toBeGreaterThan(0)
  })

  it('follows the selection when the zone changes', () => {
    const dha = renderHook(() => useCityRisk({}, {}, 'dha')).result.current.drainCard
    const shahdara = renderHook(() => useCityRisk({}, {}, 'shahdara')).result.current.drainCard
    expect(dha.worstDrain.zone).toBe('dha')
    expect(dha.parts.capacity).toBe(20) // 1 − 0.80
    expect(shahdara.score).toBeGreaterThan(dha.score)
  })
})

describe('applyServicedState', () => {
  it('zeroes a serviced node (fillPct 5, lastServiceHrs 0) and leaves others untouched', () => {
    const out = applyServicedState(DRAIN_NODES, { d1: true })
    expect(out).not.toBe(DRAIN_NODES)
    expect(out).toHaveLength(DRAIN_NODES.length)
    const d1 = out.find(n => n.id === 'd1')
    const d2 = out.find(n => n.id === 'd2')
    expect(d1).toEqual({ ...DRAIN_NODES.find(n => n.id === 'd1'), fillPct: 5, lastServiceHrs: 0 })
    expect(d2).toBe(DRAIN_NODES.find(n => n.id === 'd2'))
    // input is never mutated
    expect(DRAIN_NODES.find(n => n.id === 'd1').fillPct).toBe(87)
  })

  it('treats a missing/empty doneMap as no-op', () => {
    const out = applyServicedState(DRAIN_NODES)
    expect(out).toEqual(DRAIN_NODES)
  })
})

describe('useCityRisk with servicing (doneMap)', () => {
  // Realistic inputs; rain6hMm is constant (12mm from the shared mock) so any
  // score change is driven purely by the serviced-drain overlay.
  const shahdara = ZONES.find(z => z.id === 'shahdara')

  const scoreBefore = (() => {
    const { result } = renderHook(() => useCityRisk())
    return result.current.zoneScores.shahdara.score
  })()

  const { result: after } = renderHook(() => useCityRisk({ d1: true }))
  const afterRisk = after.current

  it('drops the shahdara flood score after servicing d1', () => {
    const scoreAfter = afterRisk.zoneScores.shahdara.score
    expect(scoreAfter).toBeLessThan(scoreBefore)
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
})

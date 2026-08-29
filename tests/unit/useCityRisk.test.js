import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCityRisk } from '../../src/hooks/useCityRisk.js'
import { ZONES } from '../../src/data/lahore.js'

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

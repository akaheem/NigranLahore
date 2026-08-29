import { describe, it, expect } from 'vitest'
import {
  RAIN_BANDS, bandOf, bandColor, bandLabel,
  rainScore, blockageScore, floodRisk, heatRisk, airRisk, taskPriority,
  floodWhy, airWhy, heatWhy,
} from '../../src/lib/risk.js'
import { ZONES, DRAIN_NODES } from '../../src/data/lahore.js'

const shahdara = ZONES.find(z => z.id === 'shahdara')

describe('bandOf / bandColor / bandLabel', () => {
  it.each([
    [0, 'safe'], [24, 'safe'], [25, 'moderate'], [49, 'moderate'],
    [50, 'high'], [74, 'high'], [75, 'severe'], [100, 'severe'], [101, 'severe'],
  ])('bandOf(%i) → %s', (score, key) => {
    expect(bandOf(score).key).toBe(key)
  })

  it('maps bands to CSS vars', () => {
    expect(bandColor(10)).toBe('var(--risk-safe)')
    expect(bandColor(60)).toBe('var(--risk-high)')
    expect(bandLabel(80)).toBe('Severe')
  })
})

describe('rainScore', () => {
  it('scores the calibrated bands', () => {
    expect(rainScore(0, 0)).toBe(0)
    expect(rainScore(40, 0)).toBe(100)
    expect(rainScore(100, 0)).toBe(100) // clamped
    expect(rainScore(0, 5)).toBe(100) // intensity dominates
  })
  it('is null-safe', () => {
    expect(rainScore(null)).toBe(0)
    expect(rainScore(undefined)).toBe(0)
  })
})

describe('blockageScore', () => {
  it('weights fill 70 / stale 30', () => {
    expect(blockageScore({ fillPct: 0, lastServiceHrs: 0 })).toBe(0)
    expect(blockageScore({ fillPct: 100, lastServiceHrs: 0 })).toBe(70)
    expect(blockageScore({ fillPct: 0, lastServiceHrs: 72 })).toBe(30)
    expect(blockageScore({ fillPct: 100, lastServiceHrs: 72 })).toBe(100)
  })
  it('is null-safe', () => {
    expect(blockageScore(undefined)).toBe(0)
    expect(blockageScore({})).toBe(0)
  })
})

describe('floodRisk', () => {
  it('composes the planned 45/25/15/15 weights', () => {
    const zone = { id: 'z', floodHistory: 1, vulnerability: 1 }
    const node = { zone: 'z', fillPct: 100, lastServiceHrs: 72 }
    const r = floodRisk({ rain6hMm: 40, rainNowMm: 0, zone, drainNodes: [node] })
    expect(r.score).toBe(100)
  })

  it('renormalizes to telemetry-only when rain is missing (never silently safe)', () => {
    // Shahdara: blockage ≈ 0.83, history 0.92, vulnerability 0.88 →
    // (0.25·b + 0.15·h + 0.15·v) / 0.55 — well above the 48 a zeroed rain would give
    const r = floodRisk({ rain6hMm: null, rainNowMm: null, zone: shahdara, drainNodes: DRAIN_NODES })
    expect(r.missing.rain).toBe(true)
    expect(r.parts.rain).toBe(0)
    expect(r.score).toBeGreaterThan(48)
  })

  it('matches the plan formula when all inputs are present', () => {
    const zone = { id: 'z', floodHistory: 0.8, vulnerability: 0.6 }
    const r = floodRisk({ rain6hMm: 20, rainNowMm: 0, zone, drainNodes: [] })
    // rain 20mm → 0.5; no nodes → blockage 0 renormalized over 0.75 total weight
    const expected = (0.45 * 0.5 + 0.15 * 0.8 + 0.15 * 0.6) / 0.75
    expect(r.score).toBe(Math.round(100 * expected))
    expect(r.missing).toEqual({ rain: false, blockage: true, history: false, vulnerability: false })
  })

  it('handles a missing zone', () => {
    const r = floodRisk({ rain6hMm: 10, zone: undefined, drainNodes: [] })
    expect(r.score).toBe(0)
    expect(r.missing.zone).toBe(true)
  })
})

describe('heatRisk', () => {
  it('is null-safe', () => {
    const r = heatRisk({ tempC: null })
    expect(r.score).toBe(0)
    expect(r.missing.temp).toBe(true)
  })
  it('bands the heat ramp', () => {
    expect(heatRisk({ tempC: 30, humidityPct: 40 }).score).toBe(0)
    expect(heatRisk({ tempC: 45, humidityPct: 100 }).score).toBe(100)
  })
})

describe('airRisk', () => {
  it('derives band from the score, not raw AQI', () => {
    const r = airRisk({ usAqi: 150 })
    expect(r.score).toBe(50)
    expect(r.band).toBe('high') // bandOf(50) → high — no zone-level band input exists
  })
  it('falls back to PM2.5', () => {
    const r = airRisk({ pm25: 50 })
    expect(r.aqi).toBe(95)
  })
  it('flags missing data instead of reading as safe', () => {
    const r = airRisk({})
    expect(r.missing).toBe(true)
    expect(r.aqi).toBe(null)
  })
})

describe('taskPriority', () => {
  it('uses the planned 40/30/20/10 weights', () => {
    const node = { fillPct: 100, lastServiceHrs: 72 }
    const zone = { population: 300000 }
    const r = taskPriority(node, zone, 40)
    expect(r.score).toBe(100)
    expect(r.parts.population).toBe(100) // normalized score, NOT residents
  })
  it('keeps the urgency baseline when rain is missing', () => {
    const node = { fillPct: 0, lastServiceHrs: 0 }
    const zone = { population: 0 }
    const r = taskPriority(node, zone, null)
    expect(r.parts.urgency).toBe(20)
  })
  it('sorts descending by priority', () => {
    const a = taskPriority({ fillPct: 10, lastServiceHrs: 1 }, { population: 100 }, 0).score
    const b = taskPriority({ fillPct: 90, lastServiceHrs: 60 }, { population: 300000 }, 40).score
    expect(b).toBeGreaterThan(a)
  })
})

describe('floodWhy / airWhy / heatWhy', () => {
  it('explains a high-blockage zone', () => {
    const result = floodRisk({ rain6hMm: 30, rainNowMm: 0, zone: shahdara, drainNodes: DRAIN_NODES })
    const whys = floodWhy(result, { zone: shahdara, weather: { rain6hMm: 30 }, nodes: DRAIN_NODES })
    expect(whys.some(w => w.includes('Drain D-1'))).toBe(true)
    expect(whys.some(w => w.includes('history of waterlogging'))).toBe(true)
  })

  it('flags missing rain', () => {
    const result = floodRisk({ rain6hMm: null, rainNowMm: null, zone: shahdara, drainNodes: DRAIN_NODES })
    const whys = floodWhy(result, { zone: shahdara, weather: {}, nodes: DRAIN_NODES })
    expect(whys.some(w => w.toLowerCase().includes('unavailable'))).toBe(true)
  })

  it('flags missing air data', () => {
    expect(airWhy(airRisk({}))).toEqual(['Air-quality telemetry is unavailable'])
  })

  it('flags missing heat data', () => {
    expect(heatWhy(heatRisk({ tempC: null }))[0]).toContain('unavailable')
  })
})

describe('RAIN_BANDS calibration', () => {
  it('matches the documented thresholds', () => {
    expect(RAIN_BANDS.map(b => b.max)).toEqual([5, 15, 30, Infinity])
  })
})

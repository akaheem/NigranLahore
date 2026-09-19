import { describe, it, expect } from 'vitest'
import {
  RAIN_BANDS, bandOf, bandColor, bandLabel,
  rainScore, blockageScore, floodRisk, heatRisk, airRisk, taskPriority,
  floodWhy, airWhy, heatWhy, drainRisk, drainWhy,
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

describe('drainRisk', () => {
  it('composes the planned 45/25/15/15 weights', () => {
    const zone = { id: 'z', drainageCapacity: 0, population: 300000 }
    const node = { zone: 'z', fillPct: 100, lastServiceHrs: 72 }
    const r = drainRisk({ zone, drainNodes: [node] })
    expect(r.score).toBe(100)
    expect(r.parts).toEqual({ blockage: 100, capacity: 100, unserved: 100, waste: 100 })
  })

  it('scores Shahdara off its own trunk drain', () => {
    // d1: 87% full, unserved 52h → blockage 83; capacity deficit 1−0.38 = 62;
    // unserved 52/72 = 72; waste 190k against the 300k reference = 63.
    const r = drainRisk({ zone: shahdara, drainNodes: DRAIN_NODES })
    expect(r.parts).toEqual({ blockage: 83, capacity: 62, unserved: 72, waste: 63 })
    expect(r.score).toBe(73)
    expect(r.worstDrain.id).toBe('d1')
    expect(r.missing).toEqual({ blockage: false, capacity: false, unserved: false, waste: false })
  })

  it('renormalizes to telemetry-only when a zone has no drain node', () => {
    const zone = { id: 'z', drainageCapacity: 0.2, population: 150000 }
    const r = drainRisk({ zone, drainNodes: [] })
    expect(r.missing).toEqual({ blockage: true, capacity: false, unserved: true, waste: false })
    // (0.25·0.8 + 0.15·0.5) / 0.40 = 0.6875 — NOT the 0.275 a zeroed
    // blockage would have produced had the weights stayed at a full 1.0.
    expect(r.score).toBe(69)
    expect(r.score).toBeGreaterThan(Math.round(100 * (0.25 * 0.8 + 0.15 * 0.5)))
    expect(r.worstDrain).toBe(null)
  })

  it('treats a missing drainNodes list the same as an empty one', () => {
    const zone = { id: 'z', drainageCapacity: 0.2, population: 150000 }
    expect(drainRisk({ zone }).score).toBe(drainRisk({ zone, drainNodes: [] }).score)
    expect(drainRisk({ zone }).missing.blockage).toBe(true)
  })

  it('lets the worst drain drive the score, not the average', () => {
    const clear = { id: 'clear', zone: 'shahdara', fillPct: 5, lastServiceHrs: 1 }
    const withClear = drainRisk({ zone: shahdara, drainNodes: [clear, ...DRAIN_NODES] })
    expect(withClear.score).toBe(drainRisk({ zone: shahdara, drainNodes: DRAIN_NODES }).score)
  })

  it('keeps every score inside 0–100 across the real zones', () => {
    for (const z of ZONES) {
      const r = drainRisk({ zone: z, drainNodes: DRAIN_NODES })
      expect(r.score).toBeGreaterThanOrEqual(0)
      expect(r.score).toBeLessThanOrEqual(100)
      for (const part of Object.values(r.parts)) {
        expect(part).toBeGreaterThanOrEqual(0)
        expect(part).toBeLessThanOrEqual(100)
      }
    }
  })

  it('ranks Shahdara above DHA, matching the calibrated capacities', () => {
    const dha = ZONES.find(z => z.id === 'dha')
    const shahdaraR = drainRisk({ zone: shahdara, drainNodes: DRAIN_NODES })
    const dhaR = drainRisk({ zone: dha, drainNodes: DRAIN_NODES })
    expect(shahdaraR.score).toBeGreaterThan(dhaR.score)
    expect(dhaR.parts.blockage).toBe(28) // 35% full, 8h unserved
  })

  it('is null-safe for a missing or unidentified zone', () => {
    for (const input of [undefined, {}, { zone: null }, { zone: {} }, { drainNodes: DRAIN_NODES }]) {
      const r = drainRisk(input)
      expect(r.score).toBe(0)
      expect(r.missing.zone).toBe(true)
      expect(r.parts).toEqual({})
    }
  })

  it('is null-safe with no arguments at all', () => {
    expect(drainRisk().score).toBe(0)
    expect(drainRisk({ zone: shahdara }).missing.capacity).toBe(false)
  })
})

describe('drainWhy', () => {
  it('explains a high-blockage zone', () => {
    const result = drainRisk({ zone: shahdara, drainNodes: DRAIN_NODES })
    const whys = drainWhy(result, { zone: shahdara })
    expect(whys.some(w => w.includes('Drain D-1'))).toBe(true)
    expect(whys.some(w => w.includes('design-storm capacity'))).toBe(true)
    expect(whys.some(w => w.includes('service interval'))).toBe(true)
    expect(whys.some(w => w.includes('waste load'))).toBe(true)
  })

  it('flags a zone with no drain telemetry instead of reading as safe', () => {
    const zone = { id: 'z', name: 'Test Zone', drainageCapacity: 0.2, population: 150000 }
    const whys = drainWhy(drainRisk({ zone, drainNodes: [] }), { zone })
    expect(whys[0]).toContain('No drain telemetry')
  })

  it('says nothing alarming about a well-serviced drain', () => {
    const zone = { id: 'z', name: 'Test Zone', drainageCapacity: 0.9, population: 50000 }
    const node = { zone: 'z', name: 'Drain Z-1', fillPct: 10, lastServiceHrs: 2 }
    const whys = drainWhy(drainRisk({ zone, drainNodes: [node] }), { zone })
    expect(whys).toEqual(['Drain Z-1 is holding at 10% — nothing critical yet'])
  })

  it('handles a missing zone', () => {
    expect(drainWhy(drainRisk(), {})).toEqual(['No zone selected'])
    expect(drainWhy()).toEqual(['No zone selected'])
  })
})

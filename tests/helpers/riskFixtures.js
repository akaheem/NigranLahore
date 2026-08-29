/** Shared risk-object fixtures for component tests (controlled props). */
import { ZONES, DRAIN_NODES } from '../../src/data/lahore.js'

export const liveWeather = {
  tempC: 34, humidityPct: 60, rainNowMm: 0,
  rain6hMm: 12, rain24hMm: 5,
  next6h: [0.5, 2, 4, 3, 1, 0.5],
  next6hProb: [10, 20, 40, 40, 30, 10],
  next24h: Array.from({ length: 24 }, (_, i) => (i === 5 ? 18 : i % 4)),
  next24hProb: Array.from({ length: 24 }, () => 20),
  next24hTime: Array.from({ length: 24 }, (_, i) => {
    const h = String((10 + i) % 24).padStart(2, '0')
    return `2026-08-29T${h}:00`
  }),
  hourlyTime: ['2026-08-29T10:00', '2026-08-29T11:00', '2026-08-29T12:00', '2026-08-29T13:00', '2026-08-29T14:00', '2026-08-29T15:00'],
  fetchedAt: new Date('2026-08-29T10:00:00+05:00'),
}

export const liveAir = {
  score: 50, band: 'moderate', aqi: 150, parts: { aqi: 150 }, missing: false,
  series: [120, 135, 150, 160, 150],
  times: ['2026-08-29T06:00', '2026-08-29T07:00', '2026-08-29T08:00', '2026-08-29T09:00', '2026-08-29T10:00'],
}

export const liveHeat = { score: 55, band: 'moderate', parts: { temp: 27, humidity: 33 }, missing: { temp: false, humidity: false } }

function buildZoneScores() {
  const out = {}
  for (const z of ZONES) out[z.id] = { score: Math.round(z.floodHistory * 100), parts: { rain: 30, blockage: 60, history: Math.round(z.floodHistory * 100), vulnerability: Math.round(z.vulnerability * 100) }, missing: { rain: false, blockage: false, history: false, vulnerability: false } }
  return out
}

export function buildTaskQueue() {
  return DRAIN_NODES
    .map(n => {
      const zone = ZONES.find(z => z.id === n.zone)
      return {
        ...n,
        zoneId: zone.id,
        zoneName: zone.name,
        population: zone.population,
        priority: n.fillPct,
        parts: { blockage: n.fillPct, urgency: 50, population: 60, stale: 40 },
        blockage: n.fillPct,
      }
    })
    .sort((a, b) => b.priority - a.priority)
}

export function buildRisk(overrides = {}) {
  return {
    weather: liveWeather,
    air: liveAir,
    heat: liveHeat,
    rain6hMm: 12,
    rainNowMm: 0,
    status: 'live',
    lastUpdated: new Date('2026-08-29T10:00:00+05:00'),
    retry: () => {},
    error: null,
    zoneScores: buildZoneScores(),
    taskQueue: buildTaskQueue(),
    floodWhyFor: zone => [`Drain D-1 is 87% full`, `${zone.name} has a history of waterlogging`],
    ...overrides,
  }
}

export const shahdara = ZONES.find(z => z.id === 'shahdara')

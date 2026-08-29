import { useMemo } from 'react'
import { useLahoreData } from '../hooks/useLahoreData.js'
import { ZONES, DRAIN_NODES } from '../data/lahore.js'
import { floodRisk, heatRisk, airRisk, blockageScore, taskPriority, floodWhy } from '../lib/risk.js'

/**
 * Central derived-state hook: live data + static geo + risk engine →
 * per-zone scores, air/heat cards, and the sorted field-team task queue.
 * Missing live rain stays `null` (never 0) so the engine can flag it.
 */
export function useCityRisk() {
  const { weather, air: airDataRaw, error, status, lastUpdated, retry } = useLahoreData()

  const rain6hMm = weather?.rain6hMm ?? null
  const rainNowMm = weather?.rainNowMm ?? null

  const zoneScores = useMemo(() => {
    const out = {}
    for (const z of ZONES) {
      out[z.id] = floodRisk({ rain6hMm, rainNowMm, zone: z, drainNodes: DRAIN_NODES })
    }
    return out
  }, [rain6hMm, rainNowMm])

  const air = useMemo(() => {
    if (!airDataRaw) return null
    return {
      ...airRisk({ usAqi: airDataRaw.usAqi, pm25: airDataRaw.pm25 }),
      series: airDataRaw.aqiSeries,
      times: airDataRaw.aqiTime,
    }
  }, [airDataRaw])

  const heat = useMemo(() => (weather ? heatRisk({ tempC: weather.tempC, humidityPct: weather.humidityPct }) : null), [weather])

  const taskQueue = useMemo(() => {
    const tasks = DRAIN_NODES.map(n => {
      const zone = ZONES.find(z => z.id === n.zone)
      const pr = taskPriority(n, zone, rain6hMm)
      return {
        ...n,
        zoneId: n.zone,
        zoneName: zone.name,
        population: zone.population,
        priority: pr.score,
        parts: pr.parts,
        blockage: blockageScore(n),
      }
    })
    return tasks.sort((a, b) => b.priority - a.priority)
  }, [rain6hMm])

  return {
    weather, air, heat,
    rain6hMm, rainNowMm,
    status, lastUpdated, retry, error,
    zoneScores, taskQueue,
    floodWhyFor: (zone) => floodWhy(zoneScores[zone.id], { zone, weather, nodes: DRAIN_NODES }),
  }
}

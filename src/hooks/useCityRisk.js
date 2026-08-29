import { useMemo } from 'react'
import { useLahoreData } from '../hooks/useLahoreData.js'
import { ZONES, DRAIN_NODES } from '../data/lahore.js'
import { floodRisk, heatRisk, airRisk, blockageScore, taskPriority, floodWhy } from '../lib/risk.js'

/**
 * Central derived-state hook: live data + static geo + risk engine →
 * per-zone scores, air/heat cards, and the sorted field-team task queue.
 */
export function useCityRisk() {
  const { weather, air: airDataRaw, error } = useLahoreData()

  const rain6hMm = weather?.rain6hMm ?? 0
  const rainNowMm = weather?.rainNowMm ?? 0

  const zoneScores = useMemo(() => {
    const out = {}
    for (const z of ZONES) {
      out[z.id] = floodRisk({ rain6hMm, rainNowMm, zone: z, drainNodes: DRAIN_NODES })
    }
    return out
  }, [rain6hMm, rainNowMm])

  const air = airDataRaw ? airResult(airDataRaw) : null
  const heat = weather ? heatResult(weather) : null

  const taskQueue = useMemo(() => {
    const tasks = DRAIN_NODES.map(n => {
      const zone = ZONES.find(z => z.id === n.zone)
      const pr = taskPriority(n, zone, rain6hMm)
      return {
        ...n,
        zoneName: zone.name,
        priority: pr.score,
        parts: pr.parts,
        blockage: blockageScore(n),
      }
    })
    return tasks.sort((a, b) => b.priority - a.priority)
  }, [rain6hMm])

  return {
    weather, airData: air, airError: error,
    rain6hMm, rainNowMm,
    zoneScores, air, heat, taskQueue,
    floodWhyFor: (zone) => floodWhy(zoneScores[zone.id], { zone, weather, nodes: DRAIN_NODES }),
  }
}

function airResult(air) {
  return airRisk({ usAqi: air.usAqi, pm25: air.pm25 })
}

function heatResult(weather) {
  return heatRisk({ tempC: weather.tempC, humidityPct: weather.humidityPct })
}

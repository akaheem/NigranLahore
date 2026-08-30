import { useMemo } from 'react'
import { useLahoreData } from '../hooks/useLahoreData.js'
import { ZONES, DRAIN_NODES } from '../data/lahore.js'
import { floodRisk, heatRisk, airRisk, blockageScore, taskPriority, floodWhy, applyServicedState } from '../lib/risk.js'

/**
 * Central derived-state hook: live data + static geo + risk engine →
 * per-zone scores, air/heat cards, and the sorted field-team task queue.
 * Missing live rain stays `null` (never 0) so the engine can flag it.
 *
 * `doneMap` ({ [drainId]: true }) carries the "mark serviced (demo)" state:
 * serviced drains are simulated as freshly emptied via applyServicedState, so
 * zone scores, the task queue, and the flood explanations all recompute.
 */
export function useCityRisk(doneMap = {}) {
  const { weather, air: airDataRaw, error, status, lastUpdated, retry } = useLahoreData()

  const rain6hMm = weather?.rain6hMm ?? null
  const rainNowMm = weather?.rainNowMm ?? null

  // Serviced-drain overlay — recomputed whenever the done map changes. The
  // derived key keeps the dependency stable across parent re-renders.
  const drainNodes = useMemo(
    () => applyServicedState(DRAIN_NODES, doneMap),
    [doneMap],
  )

  const zoneScores = useMemo(() => {
    const out = {}
    for (const z of ZONES) {
      out[z.id] = floodRisk({ rain6hMm, rainNowMm, zone: z, drainNodes })
    }
    return out
  }, [rain6hMm, rainNowMm, drainNodes])

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
    const tasks = drainNodes.map(n => {
      const zone = ZONES.find(z => z.id === n.zone)
      const pr = taskPriority(n, zone, rain6hMm)
      const isDone = doneMap?.[n.id] === true
      return {
        ...n,
        zoneId: n.zone,
        zoneName: zone.name,
        population: zone.population,
        priority: pr.score,
        parts: pr.parts,
        blockage: blockageScore(n),
        __done: isDone,
      }
    })
    // Open tasks first (priority desc), serviced tasks sink to the end (also
    // priority desc) so the field team always sees actionable work on top.
    return tasks
      .sort((a, b) => (a.__done === b.__done ? b.priority - a.priority : a.__done ? 1 : -1))
      .map(({ __done, ...task }) => task)
  }, [rain6hMm, drainNodes, doneMap])

  return {
    weather, air, heat,
    rain6hMm, rainNowMm,
    status, lastUpdated, retry, error,
    zoneScores, taskQueue,
    floodWhyFor: (zone) => floodWhy(zoneScores[zone.id], { zone, weather, nodes: drainNodes }),
  }
}

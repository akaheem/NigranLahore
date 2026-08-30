import { useMemo, useState, useEffect } from 'react'
import { useLahoreData } from '../hooks/useLahoreData.js'
import { ZONES, DRAIN_NODES } from '../data/lahore.js'
import { applyLiveTelemetry } from '../data/telemetry.js'
import { floodRisk, heatRisk, airRisk, blockageScore, taskPriority, floodWhy } from '../lib/risk.js'

/**
 * Central derived-state hook: live data + static geo + risk engine →
 * per-zone scores, air/heat cards, and the sorted field-team task queue.
 * Missing live rain stays `null` (never 0) so the engine can flag it.
 *
 * All weather/air inputs are REAL per-zone Open-Meteo values — the selected
 * zone's own temperature, humidity, rain forecast, and AQI, not a city
 * average. When a zone's feed is unavailable its inputs are null and the
 * engine flags the gap instead of inventing numbers.
 *
 * Drain telemetry is a time-driven model (data/telemetry.js): fill levels
 * rise steadily from calibrated seeds, servicing empties them and the model
 * refills them — no static numbers, no fake reset-to-5%-forever.
 *
 * `doneMap` ({ [drainId]: true }) carries the "mark serviced" state;
 * `doneAtMap` ({ [drainId]: epochMs }) carries WHEN it was serviced.
 */
export function useCityRisk(doneMap = {}, doneAtMap = {}, selectedZoneId = null) {
  const {
    weather, air, zoneWeather, zoneAir,
    error, status, lastUpdated, retry,
  } = useLahoreData()

  // Wall-clock tick: advances every 60s so drain fill levels visibly move
  // and refills progress between live-data refreshes.
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  // The selected zone's own live feed (falls back to the city-center feed)
  const zoneId = ZONES.some(z => z.id === selectedZoneId) ? selectedZoneId : 'city'
  const zWeather = (zoneWeather && zoneWeather[zoneId]) || weather
  const zAir = (zoneAir && zoneAir[zoneId]) || air

  const rain6hMm = zWeather?.rain6hMm ?? null
  const rainNowMm = zWeather?.rainNowMm ?? null

  // Time-driven drain telemetry — fill levels climb in real time; servicing
  // empties the drain and the model refills it. `tick` (wall clock) keeps the
  // levels moving between refreshes without any API traffic.
  const drainNodes = useMemo(
    () => applyLiveTelemetry(DRAIN_NODES, tick, doneMap, doneAtMap),
    [tick, doneMap, doneAtMap],
  )

  const zoneScores = useMemo(() => {
    const out = {}
    for (const z of ZONES) {
      // Each zone scores on ITS OWN rain feed; city feed as fallback.
      const zw = (zoneWeather && zoneWeather[z.id]) || weather
      out[z.id] = floodRisk({
        rain6hMm: zw?.rain6hMm ?? null,
        rainNowMm: zw?.rainNowMm ?? null,
        zone: z,
        drainNodes,
      })
    }
    return out
  }, [zoneWeather, weather, drainNodes])

  const airCard = useMemo(() => {
    if (!zAir) return null
    return {
      ...airRisk({ usAqi: zAir.usAqi, pm25: zAir.pm25 }),
      series: zAir.aqiSeries,
      times: zAir.aqiTime,
    }
  }, [zAir])

  const heat = useMemo(
    () => (zWeather ? heatRisk({ tempC: zWeather.tempC, humidityPct: zWeather.humidityPct }) : null),
    [zWeather],
  )

  const taskQueue = useMemo(() => {
    const tasks = drainNodes.map(n => {
      const zone = ZONES.find(z => z.id === n.zone)
      // Task urgency uses that drain's own zone rain feed
      const nWeather = (zoneWeather && zoneWeather[n.zone]) || weather
      const pr = taskPriority(n, zone, nWeather?.rain6hMm ?? null)
      const isDone = doneMap?.[n.id] === true || doneAtMap?.[n.id] != null
      return {
        ...n,
        zoneId: n.zone,
        zoneName: zone.name,
        population: zone.population,
        priority: pr.score,
        parts: pr.parts,
        blockage: blockageScore(n),
        __done: isDone,
        servicedAt: doneAtMap?.[n.id] ?? null,
      }
    })
    // Open tasks first (priority desc), serviced tasks sink to the end (also
    // priority desc) so the field team always sees actionable work on top.
    return tasks
      .sort((a, b) => (a.__done === b.__done ? b.priority - a.priority : a.__done ? 1 : -1))
      .map(({ __done, ...task }) => task)
  }, [zoneWeather, weather, drainNodes, doneMap, doneAtMap])

  return {
    weather: zWeather, air: airCard, heat,
    rain6hMm, rainNowMm,
    zoneTempC: zWeather?.tempC ?? null,
    zoneHumidityPct: zWeather?.humidityPct ?? null,
    zoneAqi: zAir?.usAqi ?? null,
    status, lastUpdated, retry, error,
    zoneScores, taskQueue,
    floodWhyFor: (zone) => {
      const zw = (zoneWeather && zoneWeather[zone.id]) || weather
      const zr = zoneScores[zone.id]
      return floodWhy(zr, { zone, weather: zw ?? {}, nodes: drainNodes })
    },
  }
}

import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { useLahoreData } from '../hooks/useLahoreData.js'
import { ZONES, DRAIN_NODES } from '../data/lahore.js'
import { applyLiveTelemetry, REAL_TIME, TIME_LAPSE } from '../data/telemetry.js'
import { floodRisk, heatRisk, airRisk, blockageScore, taskPriority, floodWhy, drainRisk, drainIsOpen, serviceState } from '../lib/risk.js'

/**
 * How often the simulated clock is folded forward, per mode. Real time keeps
 * the original one-minute cadence; the lapse ticks every second, which is 24
 * simulated minutes a tick — fast enough that the two decimals visibly move,
 * slow enough that it reads as motion rather than a jump.
 */
const TICK_MS = { [REAL_TIME]: 60_000, [TIME_LAPSE]: 1_000 }

const HOUR_MS = 3600 * 1000

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
 * rise steadily from calibrated seeds; servicing empties a drain and the model
 * refills it until it is work again — the four-band lifecycle in
 * SERVICE_POLICY. Nothing about "serviced" is stored: a drain's state is
 * DERIVED from its current fill, so it reopens on its own as it refills and
 * closes again when cleared. `drainIsOpen` owns that rule.
 *
 * There is exactly ONE clock: `tick`, a simulated epoch in ms. In real-time
 * mode it tracks the wall clock, so everything behaves as it always has. In
 * time-lapse mode it runs 1440x, so one real minute is one simulated day and
 * the calibrated rates (D-1: 11%/day) arrive in a minute of watching. The
 * rates themselves never change — only the clock feeding them. Every timestamp
 * in the app comes from this clock, including the serviced times `simNow()`
 * hands to the caller, so nothing is ever compared across two time domains.
 *
 * `serviceLog` ({ [drainId]: [event] }) is the merged service history — local
 * events plus whatever the shared log returned. Each event is
 * { at, simulated, speed, crewId, fillAtService }. `at` must be on the same
 * clock `simNow()` reads; the caller is responsible for that.
 */
export function useCityRisk(serviceLog = {}, selectedZoneId = null) {
  const {
    weather, air, zoneWeather, zoneAir,
    error, status, lastUpdated, retry,
  } = useLahoreData()

  // The simulated clock, split in two along the line render cares about.
  //
  // `start` is the zero point every elapsed-hour figure is measured from, and it
  // never moves — so it is state, because a render reads it. The integration
  // buffer below it is the other half: `sim` is the simulated epoch at the last
  // fold, `real` the wall clock then, so the simulated time that passes is
  // exactly (wall elapsed x speed) — folded in, never extrapolated, so raising
  // the speed can't retroactively rescale time that has already gone by. That
  // half is written only from callbacks and the tick interval, so it stays a
  // ref and render never looks at it.
  const [start] = useState(() => Date.now())
  const clock = useRef(null)

  // Created on first use rather than during render, so a render React discards
  // cannot have written to it. Every caller below runs from a callback, an
  // effect or an event — never from render.
  const clockState = useCallback(() => {
    if (clock.current === null) clock.current = { sim: start, real: start, speed: REAL_TIME }
    return clock.current
  }, [start])

  const [speed, setSpeedState] = useState(REAL_TIME)
  const [tick, setTick] = useState(start)

  const advance = useCallback(() => {
    const c = clockState()
    const wallNow = Date.now()
    c.sim += (wallNow - c.real) * c.speed
    c.real = wallNow
    return c.sim
  }, [clockState])

  useEffect(() => {
    const id = setInterval(() => setTick(advance()), TICK_MS[speed] ?? TICK_MS[REAL_TIME])
    return () => clearInterval(id)
  }, [speed, advance])

  /**
   * The exact simulated "now", for anything that has to stamp a timestamp —
   * marking a drain serviced, above all. Reading it as `sim + elapsed x speed`
   * rather than the last tick means real-time mode returns the true wall clock
   * to the millisecond, exactly as it did before there was a lapse.
   */
  const simNow = useCallback(() => {
    const c = clockState()
    return c.sim + (Date.now() - c.real) * c.speed
  }, [clockState])

  /** Switch clock modes. Folds the elapsed stretch at the OLD rate first. */
  const setSpeed = useCallback((next) => {
    advance()
    const c = clockState()
    c.speed = next
    setSpeedState(next)
    setTick(c.sim)
  }, [advance, clockState])

  // The selected zone's own live feed (falls back to the city-center feed)
  const zoneId = ZONES.some(z => z.id === selectedZoneId) ? selectedZoneId : 'city'
  const zWeather = (zoneWeather && zoneWeather[zoneId]) || weather
  const zAir = (zoneAir && zoneAir[zoneId]) || air

  const rain6hMm = zWeather?.rain6hMm ?? null
  const rainNowMm = zWeather?.rainNowMm ?? null

  // What the fill model needs from the log: the most recent service time per
  // drain, on the caller's clock. A drain never serviced is absent, and the
  // model leaves it climbing from its calibrated seed.
  const serviceAt = useMemo(() => {
    const out = {}
    for (const [id, events] of Object.entries(serviceLog || {})) {
      let latest = null
      for (const e of events || []) {
        // A real number, not `Number(e.at)`: that would read a null `at` as 0,
        // and a service dated 1970 puts the drain at the 95% cap forever.
        const at = e?.at
        if (typeof at === 'number' && Number.isFinite(at) && (latest == null || at > latest)) latest = at
      }
      if (latest != null) out[id] = latest
    }
    return out
  }, [serviceLog])

  // The published count is REAL services only. A time-lapse session records its
  // own events so the demo shows a history, but they are excluded here: one
  // afternoon of 1440x clicking must not read as years of maintenance.
  const serviceCounts = useMemo(() => {
    const out = {}
    for (const [id, events] of Object.entries(serviceLog || {})) {
      out[id] = (events || []).filter(e => e && !e.simulated).length
    }
    return out
  }, [serviceLog])

  // Time-driven drain telemetry — fill levels climb on the simulated clock;
  // servicing empties the drain and the model refills it. `tick` keeps the
  // levels moving between live-data refreshes without any API traffic.
  const drainNodes = useMemo(() => {
    const elapsedHours = Math.max(0, (tick - start) / HOUR_MS)
    return applyLiveTelemetry(DRAIN_NODES, tick, serviceAt, elapsedHours)
  }, [tick, start, serviceAt])

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

  // Waste & drainage — the selected zone's drain telemetry + static capacity.
  // Null zone → the engine flags it rather than scoring a phantom area.
  const activeZone = useMemo(() => ZONES.find(z => z.id === selectedZoneId) ?? null, [selectedZoneId])
  const drainCard = useMemo(
    () => drainRisk({ zone: activeZone, drainNodes }),
    [activeZone, drainNodes],
  )

  const taskQueue = useMemo(() => {
    const tasks = drainNodes.map(n => {
      const zone = ZONES.find(z => z.id === n.zone)
      // Task urgency uses that drain's own zone rain feed
      const nWeather = (zoneWeather && zoneWeather[n.zone]) || weather
      const pr = taskPriority(n, zone, nWeather?.rain6hMm ?? null)
      const events = serviceLog?.[n.id] ?? []
      const hasHistory = events.length > 0
      // State and openness are DERIVED from fill — never stored. That is what
      // lets a drain reopen by itself as it refills, and there is no flag left
      // to get out of step with the model.
      const state = serviceState(n.fillPct, hasHistory)
      return {
        ...n,
        zoneId: n.zone,
        zoneName: zone.name,
        population: zone.population,
        priority: pr.score,
        parts: pr.parts,
        blockage: blockageScore(n),
        state,
        open: drainIsOpen(n.fillPct, hasHistory),
        serviceCount: serviceCounts[n.id] ?? 0,
        serviceEvents: events,
        lastServiceAt: serviceAt[n.id] ?? null,
      }
    })
    // Open tasks first (priority desc), the rest sink to the end (also priority
    // desc) so the field team always sees actionable work on top — a drain that
    // was just cleared and is refilling is the least urgent thing on screen.
    return tasks.sort((a, b) => (a.open === b.open ? b.priority - a.priority : a.open ? -1 : 1))
  }, [zoneWeather, weather, drainNodes, serviceLog, serviceAt, serviceCounts])

  return {
    weather: zWeather, air: airCard, heat, drainCard,
    rain6hMm, rainNowMm,
    zoneTempC: zWeather?.tempC ?? null,
    zoneHumidityPct: zWeather?.humidityPct ?? null,
    zoneAqi: zAir?.usAqi ?? null,
    status, lastUpdated, retry, error,
    zoneScores, taskQueue, drainNodes,
    speed, setSpeed, simNow,
    floodWhyFor: (zone) => {
      const zw = (zoneWeather && zoneWeather[zone.id]) || weather
      const zr = zoneScores[zone.id]
      return floodWhy(zr, { zone, weather: zw ?? {}, nodes: drainNodes })
    },
  }
}

import { useEffect, useState } from 'react'
import { ZONES, LAHORE_CENTER } from '../data/lahore.js'

/**
 * Live weather + air quality — Open-Meteo, no API key, fetched client-side.
 * ONE multi-location request per endpoint: city center first (for city-level
 * timelines/counters), then every zone. Every zone's temperature, humidity,
 * rain, and AQI are its own real model values — never averaged, never invented.
 *
 * There is NO synthetic offline snapshot. If the network fails and no cache
 * exists, values stay null and the UI says so — a missing number is honest,
 * a fabricated one is not.
 */

// City center first — response order always matches request order (Open-Meteo).
const LOCATIONS = [
  { id: 'city', lat: LAHORE_CENTER.lat, lng: LAHORE_CENTER.lng },
  ...ZONES.map(z => ({ id: z.id, lat: z.lat, lng: z.lng })),
]
const LAT = LOCATIONS.map(l => l.lat.toFixed(4)).join(',')
const LNG = LOCATIONS.map(l => l.lng.toFixed(4)).join(',')

const WEATHER_URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LNG}` +
  `&hourly=temperature_2m,relative_humidity_2m,precipitation,precipitation_probability` +
  `&past_days=2&forecast_days=4&timezone=Asia%2FKarachi`

const AIR_URL =
  `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LAT}&longitude=${LNG}` +
  `&hourly=pm2_5,pm10,us_aqi&past_days=1&forecast_days=4&timezone=Asia%2FKarachi`

// v2: multi-location payload shape (arrays, not single objects)
const CACHE_KEY = 'nigran-live-cache-v2'
const REFRESH_MS = 10 * 60 * 1000 // refresh every 10 min
const FRESH_MS = 30 * 60 * 1000 // cache < 30 min old still counts as live

/**
 * Asia/Karachi has no DST, so every API wall-clock string is a fixed +05:00.
 * Parsing with an explicit offset keeps "current hour" selection correct in
 * any browser timezone (the API returns local Karachi strings).
 */
export const parseKarachiHour = t => new Date(`${t}:00+05:00`)

/** Index of the last hour <= target (for "current" values). */
export function findHourIndex(times, target) {
  let idx = 0
  for (let i = 0; i < times.length; i++) {
    if (parseKarachiHour(times[i]) <= target) idx = i
    else break
  }
  return idx
}

/** Exactly 6 hourly buckets (current hour through +5h) — the flood window. */
export const RAIN_WINDOW_HOURS = 6

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

function readCache() {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    // Reject any cache entry that doesn't match the current v2 shape — an old
    // shape (or a partially-written entry) must never reach the parsers.
    if (!parsed || !parsed.fetchedAt || !parsed.weather || !parsed.air) return null
    if (typeof parsed.weather.city !== 'object' || !parsed.weather.city?.hourly?.time) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(cache) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    /* storage unavailable — cache is best-effort */
  }
}

/** Parse one location's weather payload into the app's weather shape. */
function parseWeatherOne(w, now = new Date()) {
  // Defensive: a malformed payload must throw with a useful message, not
  // crash deep in a component render.
  if (!w?.hourly?.time || !Array.isArray(w.hourly.time)) {
    throw new Error('Malformed weather payload — missing hourly.time')
  }
  const wTimes = w.hourly.time.map(t => parseKarachiHour(t))
  const wIdx = findHourIndex(wTimes, now)
  const prec = Array.isArray(w.hourly.precipitation) ? w.hourly.precipitation : []
  const prob = Array.isArray(w.hourly.precipitation_probability) ? w.hourly.precipitation_probability : []

  // Next 6h rainfall window — the core input to the flood engine
  const next6h = prec.slice(wIdx, wIdx + RAIN_WINDOW_HOURS)
  const next6hProb = prob.slice(wIdx, wIdx + RAIN_WINDOW_HOURS)
  const rain6hMm = next6h.reduce((s, v) => s + (v || 0), 0)

  // Next 24h outlook (City Overview timeline); clamped near the horizon
  const end24 = Math.min(wIdx + 24, prec.length)
  const next24h = prec.slice(wIdx, end24)
  const next24hProb = prob.slice(wIdx, end24)
  const next24hTime = w.hourly.time.slice(wIdx, end24)

  // Next 72h outlook — the full forecast horizon the UI offers
  const end72 = Math.min(wIdx + 72, prec.length)
  const next72h = prec.slice(wIdx, end72)
  const next72hProb = prob.slice(wIdx, end72)
  const next72hTime = w.hourly.time.slice(wIdx, end72)

  // Past 24h rainfall (last 24 hourly entries before now)
  const past24h = prec.slice(Math.max(0, wIdx - 24), wIdx)
  const rain24hMm = past24h.reduce((s, v) => s + (v || 0), 0)

  return {
    tempC: w.hourly.temperature_2m?.[wIdx] ?? null,
    humidityPct: w.hourly.relative_humidity_2m?.[wIdx] ?? null,
    rainNowMm: prec[wIdx] || 0,
    rain6hMm,
    rain24hMm,
    next6h,
    next6hProb,
    next24h,
    next24hProb,
    next24hTime,
    next72h,
    next72hProb,
    next72hTime,
    hourlyTime: w.hourly.time.slice(wIdx, wIdx + RAIN_WINDOW_HOURS),
    fetchedAt: now,
  }
}

/** Parse one location's air payload; AQI series only kept where requested. */
function parseAirOne(a, now = new Date(), withSeries = false) {
  if (!a?.hourly?.time || !Array.isArray(a.hourly.time)) {
    throw new Error('Malformed air payload — missing hourly.time')
  }
  const aIdx = findHourIndex(a.hourly.time.map(t => parseKarachiHour(t)), now)
  const safe = arr => (Array.isArray(arr) ? arr : [])
  return {
    pm25: a.hourly.pm2_5?.[aIdx] ?? null,
    pm10: a.hourly.pm10?.[aIdx] ?? null,
    usAqi: a.hourly.us_aqi?.[aIdx] ?? null,
    ...(withSeries && {
      aqiSeries: safe(a.hourly.us_aqi).slice(Math.max(0, aIdx - 12), aIdx + 13),
      aqiTime: safe(a.hourly.time).slice(Math.max(0, aIdx - 12), aIdx + 13),
    }),
    fetchedAt: now,
  }
}

/**
 * Parse a multi-location response array into a { locationId: parsed } map.
 * Response order matches LOCATIONS order; the first entry is the city center.
 */
function parseLocationArray(responses, now, parseFn, extraArgs = []) {
  const out = {}
  responses.forEach((payload, i) => {
    const id = LOCATIONS[i]?.id
    if (!id) return
    out[id] = parseFn(payload, now, ...extraArgs)
  })
  return out
}

/**
 * Live per-zone weather + air quality for Lahore.
 *
 * Status machine:
 *  loading  — first fetch in flight
 *  live     — fresh from the API (or a <30min-old cache after a failure)
 *  stale    — older cache after a failure
 *  offline  — no usable cache; values stay null and the UI says so
 */
export function useLahoreData() {
  const [weather, setWeather] = useState(null)
  const [air, setAir] = useState(null)
  const [zoneWeather, setZoneWeather] = useState(null)
  const [zoneAir, setZoneAir] = useState(null)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState('loading')
  const [lastUpdated, setLastUpdated] = useState(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let clearSeed = null

    // Optimistic paint from cache before the first fetch resolves.
    // Deferred one tick so this is cache-seeding, not a cascading render.
    const cached = readCache()
    if (cached && attempt === 0) {
      const age = Date.now() - new Date(cached.fetchedAt).getTime()
      const seed = () => {
        if (cancelled) return
        const fetchedAt = new Date(cached.fetchedAt)
        if (cached.weather && cached.air) {
          const wById = {}
          const aById = {}
          LOCATIONS.forEach(({ id }) => {
            // Per-location guards: readCache validates the city entry; zones
            // may still be partial if the cache was written by an older build.
            if (cached.weather[id]?.hourly?.time) {
              try { wById[id] = parseWeatherOne(cached.weather[id], fetchedAt) } catch { /* skip broken entry */ }
            }
            if (cached.air[id]?.hourly?.time) {
              try { aById[id] = parseAirOne(cached.air[id], fetchedAt, id === 'city') } catch { /* skip broken entry */ }
            }
          })
          setWeather(wById.city ?? null)
          setAir(aById.city ?? null)
          setZoneWeather(wById)
          setZoneAir(aById)
          setStatus(age < FRESH_MS ? 'live' : 'stale')
          setLastUpdated(fetchedAt)
        }
      }
      const t = setTimeout(seed, 0)
      clearSeed = () => clearTimeout(t)
    }

    async function load() {
      try {
        const [wArr, aArr] = await Promise.all([fetchJson(WEATHER_URL), fetchJson(AIR_URL)])
        if (cancelled) return
        const now = new Date()
        const weatherById = parseLocationArray(
          Array.isArray(wArr) ? wArr : [wArr], now,
          (payload, t) => parseWeatherOne(payload, t),
        )
        const airById = parseLocationArray(
          Array.isArray(aArr) ? aArr : [aArr], now,
          (payload, t, id) => parseAirOne(payload, t, id === 'city'),
        )
        setWeather(weatherById.city ?? null)
        setAir(airById.city ?? null)
        setZoneWeather(weatherById)
        setZoneAir(airById)
        setError(null)
        setStatus('live')
        setLastUpdated(now)
        writeCache({ weather: weatherById, air: airById, fetchedAt: now.toISOString() })
      } catch (e) {
        if (cancelled) return
        setError(e.message)
        // Fall back through the cache. No cache → honest nulls: a network
        // failure must never read as invented values or as "no rain".
        const cache = readCache()
        if (cache && cache.weather && cache.air) {
          const fetchedAt = new Date(cache.fetchedAt)
          const age = Date.now() - fetchedAt.getTime()
          const wById = {}
          const aById = {}
          LOCATIONS.forEach(({ id }) => {
            // Per-location guards: readCache validates the city entry; zones
            // may still be partial if the cache was written by an older build.
            if (cache.weather[id]?.hourly?.time) {
              try { wById[id] = parseWeatherOne(cache.weather[id], fetchedAt) } catch { /* skip broken entry */ }
            }
            if (cache.air[id]?.hourly?.time) {
              try { aById[id] = parseAirOne(cache.air[id], fetchedAt, id === 'city') } catch { /* skip broken entry */ }
            }
          })
          setWeather(wById.city ?? null)
          setAir(aById.city ?? null)
          setZoneWeather(wById)
          setZoneAir(aById)
          setLastUpdated(fetchedAt)
          setStatus(age < FRESH_MS ? 'live' : 'stale')
        } else {
          setWeather(null)
          setAir(null)
          setZoneWeather(null)
          setZoneAir(null)
          setLastUpdated(null)
          setStatus('offline')
        }
      }
    }

    load()
    const id = setInterval(load, REFRESH_MS)
    return () => { cancelled = true; clearInterval(id); clearSeed?.() }
  }, [attempt])

  const retry = () => setAttempt(n => n + 1)

  return { weather, air, zoneWeather, zoneAir, error, status, lastUpdated, retry }
}

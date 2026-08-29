import { useEffect, useState } from 'react'
import { LAHORE_CENTER } from '../data/lahore.js'
import { buildFallbackWeather, buildFallbackAir } from '../data/fallback.js'

const WEATHER_URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${LAHORE_CENTER.lat}&longitude=${LAHORE_CENTER.lng}` +
  `&hourly=temperature_2m,relative_humidity_2m,precipitation,precipitation_probability` +
  `&past_days=2&forecast_days=2&timezone=Asia%2FKarachi`

const AIR_URL =
  `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LAHORE_CENTER.lat}&longitude=${LAHORE_CENTER.lng}` +
  `&hourly=pm2_5,pm10,us_aqi&past_days=1&forecast_days=2&timezone=Asia%2FKarachi`

const CACHE_KEY = 'nigran-live-cache'
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
    return raw ? JSON.parse(raw) : null
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

function parseWeather(w, now = new Date()) {
  const wTimes = w.hourly.time.map(t => parseKarachiHour(t))
  const wIdx = findHourIndex(wTimes, now)

  // Next 6h rainfall window — the core input to the flood engine
  const next6h = w.hourly.precipitation.slice(wIdx, wIdx + RAIN_WINDOW_HOURS)
  const next6hProb = w.hourly.precipitation_probability.slice(wIdx, wIdx + RAIN_WINDOW_HOURS)
  const rain6hMm = next6h.reduce((s, v) => s + (v || 0), 0)

  // Next 24h outlook (City Overview timeline); clamped near the horizon
  const end24 = Math.min(wIdx + 24, w.hourly.precipitation.length)
  const next24h = w.hourly.precipitation.slice(wIdx, end24)
  const next24hProb = w.hourly.precipitation_probability.slice(wIdx, end24)
  const next24hTime = w.hourly.time.slice(wIdx, end24)

  // Past 24h rainfall (last 24 hourly entries before now)
  const past24h = w.hourly.precipitation.slice(Math.max(0, wIdx - 24), wIdx)
  const rain24hMm = past24h.reduce((s, v) => s + (v || 0), 0)

  return {
    tempC: w.hourly.temperature_2m[wIdx],
    humidityPct: w.hourly.relative_humidity_2m[wIdx],
    rainNowMm: w.hourly.precipitation[wIdx] || 0,
    rain6hMm,
    rain24hMm,
    next6h,
    next6hProb,
    next24h,
    next24hProb,
    next24hTime,
    hourlyTime: w.hourly.time.slice(wIdx, wIdx + RAIN_WINDOW_HOURS),
    fetchedAt: now,
  }
}

function parseAir(a, now = new Date()) {
  const aIdx = findHourIndex(a.hourly.time.map(t => parseKarachiHour(t)), now)
  return {
    pm25: a.hourly.pm2_5[aIdx],
    pm10: a.hourly.pm10[aIdx],
    usAqi: a.hourly.us_aqi[aIdx],
    aqiSeries: a.hourly.us_aqi.slice(Math.max(0, aIdx - 12), aIdx + 13),
    aqiTime: a.hourly.time.slice(Math.max(0, aIdx - 12), aIdx + 13),
    fetchedAt: now,
  }
}

/**
 * Live weather + air quality for Lahore (Open-Meteo, no API key).
 * Both endpoints curl-verified 2026-08-29.
 *
 * Status machine:
 *  loading  — first fetch in flight
 *  live     — fresh from the API (or a <30min-old cache after a failure)
 *  stale    — older cache after a failure
 *  offline  — no usable cache; deterministic static snapshot in use
 */
export function useLahoreData() {
  const [weather, setWeather] = useState(null)
  const [air, setAir] = useState(null)
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
        if (cached.weather) setWeather(parseWeather(cached.weather, new Date(cached.fetchedAt)))
        if (cached.air) setAir(parseAir(cached.air, new Date(cached.fetchedAt)))
        if (cached.weather || cached.air) {
          setStatus(age < FRESH_MS ? 'live' : 'stale')
          setLastUpdated(new Date(cached.fetchedAt))
        }
      }
      const t = setTimeout(seed, 0)
      clearSeed = () => clearTimeout(t)
    }

    async function load() {
      try {
        const [w, a] = await Promise.all([fetchJson(WEATHER_URL), fetchJson(AIR_URL)])
        if (cancelled) return
        const now = new Date()
        setWeather(parseWeather(w, now))
        setAir(parseAir(a, now))
        setError(null)
        setStatus('live')
        setLastUpdated(now)
        writeCache({ weather: w, air: a, fetchedAt: now.toISOString() })
      } catch (e) {
        if (cancelled) return
        setError(e.message)
        // Fall back through the cache, then to the static snapshot — a
        // network failure must never read as "no rain".
        const cache = readCache()
        if (cache && (cache.weather || cache.air)) {
          const fetchedAt = new Date(cache.fetchedAt)
          const age = Date.now() - fetchedAt.getTime()
          if (cache.weather) setWeather(parseWeather(cache.weather, fetchedAt))
          if (cache.air) setAir(parseAir(cache.air, fetchedAt))
          setLastUpdated(fetchedAt)
          setStatus(age < FRESH_MS ? 'live' : 'stale')
        } else {
          const now = new Date()
          setWeather(parseWeather(buildFallbackWeather(now.getTime()), now))
          setAir(parseAir(buildFallbackAir(now.getTime()), now))
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

  return { weather, air, error, status, lastUpdated, retry }
}

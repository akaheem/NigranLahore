import { useEffect, useState } from 'react'
import { LAHORE_CENTER } from '../data/lahore.js'

const WEATHER_URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${LAHORE_CENTER.lat}&longitude=${LAHORE_CENTER.lng}` +
  `&hourly=temperature_2m,relative_humidity_2m,precipitation,precipitation_probability` +
  `&past_days=2&forecast_days=2&timezone=Asia%2FKarachi`

const AIR_URL =
  `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LAHORE_CENTER.lat}&longitude=${LAHORE_CENTER.lng}` +
  `&hourly=pm2_5,pm10,us_aqi&past_days=1&forecast_days=2&timezone=Asia%2FKarachi`

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

function findHourIndex(times, target) {
  // index of the hour <= target (for "current" values)
  let idx = 0
  for (let i = 0; i < times.length; i++) {
    if (new Date(times[i] + ':00') <= target) idx = i
    else break
  }
  return idx
}

/**
 * Live weather + air quality for Lahore (Open-Meteo, no API key).
 * Both endpoints curl-verified 2026-08-29.
 */
export function useLahoreData() {
  const [weather, setWeather] = useState(null)
  const [air, setAir] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [w, a] = await Promise.all([fetchJson(WEATHER_URL), fetchJson(AIR_URL)])
        if (cancelled) return

        const now = new Date()
        const wTimes = w.hourly.time.map(t => new Date(t + ':00'))
        const aTimes = a.hourly.time.map(t => new Date(t + ':00'))

        const wIdx = findHourIndex(wTimes, now)
        const aIdx = findHourIndex(aTimes, now)

        // Next 6h rainfall window — the core input to the flood engine
        const next6h = w.hourly.precipitation.slice(wIdx, wIdx + 7)
        const next6hProb = w.hourly.precipitation_probability.slice(wIdx, wIdx + 7)
        const rain6hMm = next6h.reduce((s, v) => s + (v || 0), 0)

        // Past 24h rainfall (last 24 hourly entries before now)
        const past24h = w.hourly.precipitation.slice(Math.max(0, wIdx - 24), wIdx)
        const rain24hMm = past24h.reduce((s, v) => s + (v || 0), 0)

        setWeather({
          tempC: w.hourly.temperature_2m[wIdx],
          humidityPct: w.hourly.relative_humidity_2m[wIdx],
          rainNowMm: w.hourly.precipitation[wIdx] || 0,
          rain6hMm,
          rain24hMm,
          next6h,
          next6hProb,
          hourlyTime: w.hourly.time.slice(wIdx, wIdx + 7),
          fetchedAt: now,
        })

        setAir({
          pm25: a.hourly.pm2_5[aIdx],
          pm10: a.hourly.pm10[aIdx],
          usAqi: a.hourly.us_aqi[aIdx],
          aqiSeries: a.hourly.us_aqi.slice(Math.max(0, aIdx - 12), aIdx + 13),
          aqiTime: a.hourly.time.slice(Math.max(0, aIdx - 12), aIdx + 13),
          fetchedAt: now,
        })
      } catch (e) {
        if (!cancelled) setError(e.message)
      }
    }

    load()
    const id = setInterval(load, 10 * 60 * 1000) // refresh every 10 min
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  return { weather, air, error }
}

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useLahoreData, parseKarachiHour, findHourIndex, RAIN_WINDOW_HOURS } from '../../src/hooks/useLahoreData.js'
import { ZONES } from '../../src/data/lahore.js'

const HOUR = 3600 * 1000
const LOC_COUNT = ZONES.length + 1 // city center + one per zone

/** Build an Open-Meteo-shaped multi-location payload with Karachi wall-clock strings. */
function karachiTimeString(date) {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
  return `${d}T${t}`
}

function buildLocationPayload(now = new Date(), offset = 0) {
  const start = new Date(now.getTime() - 24 * HOUR)
  const time = Array.from({ length: 96 }, (_, i) => karachiTimeString(new Date(start.getTime() + i * HOUR)))
  return {
    hourly: {
      time,
      // Each location gets a distinct base temperature so per-zone feeds are provable
      temperature_2m: time.map((_, i) => 30 + (i % 10) + offset),
      relative_humidity_2m: time.map(() => 60),
      precipitation: time.map((_, i) => (i > 24 && i <= 24 + RAIN_WINDOW_HOURS ? 2 : 0)),
      precipitation_probability: time.map(() => 10),
    },
  }
}

function buildAirLocationPayload(now = new Date(), offset = 0) {
  const start = new Date(now.getTime() - 24 * HOUR)
  const time = Array.from({ length: 96 }, (_, i) => karachiTimeString(new Date(start.getTime() + i * HOUR)))
  return {
    hourly: {
      time,
      pm2_5: time.map(() => 70 + offset),
      pm10: time.map(() => 140 + offset),
      us_aqi: time.map(() => 140 + offset),
    },
  }
}

/** Array of per-location weather payloads (city first, then zones). */
function buildWeatherPayload(now = new Date()) {
  return Array.from({ length: LOC_COUNT }, (_, i) => buildLocationPayload(now, i))
}
function buildAirPayload(now = new Date()) {
  return Array.from({ length: LOC_COUNT }, (_, i) => buildAirLocationPayload(now, i))
}

beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseKarachiHour', () => {
  it('parses wall-clock strings with the fixed +05:00 offset in any local TZ', () => {
    expect(parseKarachiHour('2026-08-29T12:00')).toEqual(new Date('2026-08-29T12:00:00+05:00'))
  })
})

describe('findHourIndex', () => {
  it('selects the last hour <= target', () => {
    const now = new Date('2026-08-29T12:30:00+05:00')
    const times = ['2026-08-29T10:00', '2026-08-29T11:00', '2026-08-29T12:00', '2026-08-29T13:00']
    expect(findHourIndex(times, now)).toBe(2)
  })
})

describe('useLahoreData', () => {
  it('loads live data with 6-bucket window, 24h and 72h outlooks', async () => {
    const wPayload = buildWeatherPayload()
    const aPayload = buildAirPayload()
    global.fetch.mockImplementation(url =>
      url.includes('air-quality') ? Promise.resolve({ ok: true, json: () => Promise.resolve(aPayload) })
        : Promise.resolve({ ok: true, json: () => Promise.resolve(wPayload) }))

    const { result } = renderHook(() => useLahoreData())
    await waitFor(() => expect(result.current.status).toBe('live'))

    expect(result.current.weather.next6h).toHaveLength(6)
    expect(result.current.weather.rain6hMm).toBe(2 * RAIN_WINDOW_HOURS - 2) // buckets 1..6 of the spike
    expect(result.current.weather.next24h.length).toBe(24)
    expect(result.current.weather.next24hTime.length).toBe(24)
    expect(result.current.weather.next72h.length).toBeGreaterThan(48) // 4-day request horizon
    expect(result.current.air.usAqi).toBe(140) // city center = first location
    expect(result.current.error).toBe(null)
  })

  it('returns a distinct live feed per zone (city 140 AQI, zones offset)', async () => {
    const wPayload = buildWeatherPayload()
    const aPayload = buildAirPayload()
    global.fetch.mockImplementation(url =>
      url.includes('air-quality') ? Promise.resolve({ ok: true, json: () => Promise.resolve(aPayload) })
        : Promise.resolve({ ok: true, json: () => Promise.resolve(wPayload) }))

    const { result } = renderHook(() => useLahoreData())
    await waitFor(() => expect(result.current.status).toBe('live'))

    // city = index 0 → AQI 140; zone index 1 → 141; zone index 3 → 143
    expect(result.current.zoneAir.city.usAqi).toBe(140)
    expect(result.current.zoneAir[ZONES[0].id].usAqi).toBe(141)
    expect(result.current.zoneAir[ZONES[2].id].usAqi).toBe(143)
    // per-zone temperature likewise distinct (30 + hour + offset)
    expect(result.current.zoneWeather[ZONES[0].id].tempC).toBe(result.current.zoneWeather.city.tempC + 1)
  })

  it('stays honest when offline: null weather, offline status, no invented values', async () => {
    global.fetch.mockRejectedValue(new Error('network down'))

    const { result } = renderHook(() => useLahoreData())
    await waitFor(() => expect(result.current.status).toBe('offline'))

    expect(result.current.weather).toBeNull()
    expect(result.current.air).toBeNull()
    expect(result.current.zoneWeather).toBeNull()
    expect(result.current.error).toContain('network down')
  })

  it('uses a stale cache after failure and marks status stale', async () => {
    const wPayload = buildWeatherPayload()
    const aPayload = buildAirPayload()
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000) // 2h old
    window.localStorage.setItem('nigran-live-cache-v2', JSON.stringify({
      weather: buildCacheWeather(wPayload), air: buildCacheAir(aPayload), fetchedAt: old.toISOString(),
    }))

    global.fetch.mockRejectedValue(new Error('offline'))

    const { result } = renderHook(() => useLahoreData())
    await waitFor(() => expect(result.current.status).toBe('stale'))

    expect(result.current.weather).not.toBeNull()
    expect(result.current.zoneWeather[ZONES[0].id]).not.toBeNull()
    expect(result.current.lastUpdated).toEqual(old)
  })

  it('recovers to live after retry', async () => {
    global.fetch.mockRejectedValueOnce(new Error('first failure'))

    const { result } = renderHook(() => useLahoreData())
    await waitFor(() => expect(result.current.status).toBe('offline'))

    const wPayload = buildWeatherPayload()
    const aPayload = buildAirPayload()
    global.fetch.mockImplementation(url =>
      url.includes('air-quality') ? Promise.resolve({ ok: true, json: () => Promise.resolve(aPayload) })
        : Promise.resolve({ ok: true, json: () => Promise.resolve(wPayload) }))

    await act(async () => { result.current.retry() })
    await waitFor(() => expect(result.current.status).toBe('live'))
  })

  it('persists a successful fetch to the cache', async () => {
    const wPayload = buildWeatherPayload()
    const aPayload = buildAirPayload()
    global.fetch.mockImplementation(url =>
      url.includes('air-quality') ? Promise.resolve({ ok: true, json: () => Promise.resolve(aPayload) })
        : Promise.resolve({ ok: true, json: () => Promise.resolve(wPayload) }))

    const { result } = renderHook(() => useLahoreData())
    await waitFor(() => expect(result.current.status).toBe('live'))

    const raw = window.localStorage.getItem('nigran-live-cache-v2')
    expect(raw).not.toBeNull()
    const cache = JSON.parse(raw)
    expect(Object.keys(cache.weather)).toHaveLength(LOC_COUNT) // city + 8 zones
  })
})

/** Cache shape: { [locationId]: rawPayload } keyed by location id. */
function buildCacheWeather(wPayload) {
  const out = {}
  const ids = ['city', ...ZONES.map(z => z.id)]
  ids.forEach((id, i) => { out[id] = wPayload[i] })
  return out
}
function buildCacheAir(aPayload) {
  const out = {}
  const ids = ['city', ...ZONES.map(z => z.id)]
  ids.forEach((id, i) => { out[id] = aPayload[i] })
  return out
}

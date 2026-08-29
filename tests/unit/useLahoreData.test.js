import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useLahoreData, parseKarachiHour, findHourIndex, RAIN_WINDOW_HOURS } from '../../src/hooks/useLahoreData.js'

const HOUR = 3600 * 1000

/** Build an Open-Meteo-shaped payload with Karachi wall-clock strings. */
function karachiTimeString(date) {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
  return `${d}T${t}`
}

function buildPayload(now = new Date()) {
  const start = new Date(now.getTime() - 24 * HOUR)
  const time = Array.from({ length: 72 }, (_, i) => karachiTimeString(new Date(start.getTime() + i * HOUR)))
  return {
    weather: {
      hourly: {
        time,
        temperature_2m: time.map((_, i) => 30 + (i % 10)),
        relative_humidity_2m: time.map(() => 60),
        precipitation: time.map((_, i) => (i > 24 && i <= 24 + RAIN_WINDOW_HOURS ? 2 : 0)),
        precipitation_probability: time.map(() => 10),
      },
    },
    air: {
      hourly: {
        time,
        pm2_5: time.map(() => 70),
        pm10: time.map(() => 140),
        us_aqi: time.map(() => 140),
      },
    },
  }
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
  it('loads live data with a 6-bucket window and 24h outlook', async () => {
    const payload = buildPayload()
    global.fetch.mockImplementation(url =>
      url.includes('air-quality') ? Promise.resolve({ ok: true, json: () => Promise.resolve(payload.air) })
        : Promise.resolve({ ok: true, json: () => Promise.resolve(payload.weather) }))

    const { result } = renderHook(() => useLahoreData())
    await waitFor(() => expect(result.current.status).toBe('live'))

    expect(result.current.weather.next6h).toHaveLength(6)
    expect(result.current.weather.rain6hMm).toBe(2 * RAIN_WINDOW_HOURS - 2) // buckets 1..6 of the spike
    expect(result.current.weather.next24h.length).toBe(24)
    expect(result.current.weather.next24hTime.length).toBe(24)
    expect(result.current.air.usAqi).toBe(140)
    expect(result.current.error).toBe(null)
  })

  it('falls back to the static snapshot (offline) and never shows null weather', async () => {
    global.fetch.mockRejectedValue(new Error('network down'))

    const { result } = renderHook(() => useLahoreData())
    await waitFor(() => expect(result.current.status).toBe('offline'))

    expect(result.current.weather).not.toBeNull()
    expect(result.current.air).not.toBeNull()
    expect(result.current.error).toContain('network down')
    // fallback window is still a full 6-bucket rain window
    expect(result.current.weather.next6h).toHaveLength(6)
  })

  it('uses a stale cache after failure and marks status stale', async () => {
    const payload = buildPayload()
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000) // 2h old
    window.localStorage.setItem('nigran-live-cache', JSON.stringify({
      weather: payload.weather, air: payload.air, fetchedAt: old.toISOString(),
    }))

    global.fetch.mockRejectedValue(new Error('offline'))

    const { result } = renderHook(() => useLahoreData())
    await waitFor(() => expect(result.current.status).toBe('stale'))

    expect(result.current.weather).not.toBeNull()
    expect(result.current.lastUpdated).toEqual(old)
  })

  it('recovers to live after retry', async () => {
    const payload = buildPayload()
    global.fetch.mockRejectedValueOnce(new Error('first failure'))

    const { result } = renderHook(() => useLahoreData())
    await waitFor(() => expect(result.current.status).toBe('offline'))

    global.fetch.mockImplementation(url =>
      url.includes('air-quality') ? Promise.resolve({ ok: true, json: () => Promise.resolve(payload.air) })
        : Promise.resolve({ ok: true, json: () => Promise.resolve(payload.weather) }))

    await act(async () => { result.current.retry() })
    await waitFor(() => expect(result.current.status).toBe('live'))
  })

  it('persists a successful fetch to the cache', async () => {
    const payload = buildPayload()
    global.fetch.mockImplementation(url =>
      url.includes('air-quality') ? Promise.resolve({ ok: true, json: () => Promise.resolve(payload.air) })
        : Promise.resolve({ ok: true, json: () => Promise.resolve(payload.weather) }))

    const { result } = renderHook(() => useLahoreData())
    await waitFor(() => expect(result.current.status).toBe('live'))

    expect(window.localStorage.getItem('nigran-live-cache')).not.toBeNull()
  })
})

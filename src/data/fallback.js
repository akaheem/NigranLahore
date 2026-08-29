const HOURS = 48

/**
 * Deterministic Open-Meteo-shaped fallback payloads. Used only when the live
 * API is unreachable AND no cached snapshot exists — the app never shows
 * "safe" just because the network is missing.
 */

function karachiHourString(offsetHours, now = Date.now()) {
  const d = new Date(now + offsetHours * 3600 * 1000)
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
  return `${date}T${hhmm}`
}

/** Diurnal temperature curve for Lahore (°C): min ~24 pre-dawn, peak ~38 mid-afternoon. */
function fallbackTempC(hourOfDay) {
  return 31 - 7 * Math.cos((2 * Math.PI * (hourOfDay - 15)) / 24)
}

/** Diurnal humidity (%): inverse of the temperature curve, 40–90. */
function fallbackHumidity(hourOfDay) {
  return 65 + 25 * Math.cos((2 * Math.PI * (hourOfDay - 15)) / 24)
}

/**
 * Rainfall pattern: dry most hours, a monsoon-evening spike (16:00–19:00)
 * on the first day — enough to exercise the "high" band of the engine.
 */
function fallbackPrecip(index) {
  const hourOfDay = Number(karachiHourString(index).slice(11, 13))
  const isDay1 = index >= 0 && index < 24
  if (isDay1 && hourOfDay >= 16 && hourOfDay <= 19) return index === 17 ? 12 : 5
  return 0
}

export function buildFallbackWeather(now = Date.now()) {
  const time = Array.from({ length: HOURS }, (_, i) => karachiHourString(i, now))
  const hourOf = i => Number(time[i].slice(11, 13))
  return {
    hourly: {
      time,
      temperature_2m: time.map((_, i) => Math.round(fallbackTempC(hourOf(i)) * 10) / 10),
      relative_humidity_2m: time.map((_, i) => Math.round(fallbackHumidity(hourOf(i)))),
      precipitation: time.map((_, i) => fallbackPrecip(i)),
      precipitation_probability: time.map((_, i) => (fallbackPrecip(i) > 0 ? 70 : 10)),
    },
  }
}

export function buildFallbackAir(now = Date.now()) {
  const time = Array.from({ length: HOURS }, (_, i) => karachiHourString(i, now))
  return {
    hourly: {
      time,
      // Lahore's documented range (61–83 µg/m³ live PM2.5)
      pm2_5: time.map(() => 72),
      pm10: time.map(() => 150),
      us_aqi: time.map(() => 150),
    },
  }
}

export const FALLBACK_META = { label: 'static snapshot' }

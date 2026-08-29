/**
 * Nigran risk engine — deterministic, explainable weighted overlays.
 * Every weight traces to published parameters in Research Papers/ (see
 * PROJECT_PLAN.md §5). Scores are 0-100; bands: safe/moderate/high/severe.
 */

export const BANDS = [
  { max: 25, key: 'safe', label: 'Safe' },
  { max: 50, key: 'moderate', label: 'Moderate' },
  { max: 75, key: 'high', label: 'High' },
  { max: 101, key: 'severe', label: 'Severe' },
]

export const RAIN_BANDS = [
  { max: 5, key: 'safe', label: 'Safe' },
  { max: 15, key: 'moderate', label: 'Moderate' },
  { max: 30, key: 'high', label: 'High' },
  { max: Infinity, key: 'severe', label: 'Severe' },
]

export const BAND_COLORS = { safe: 'var(--risk-safe)', moderate: 'var(--risk-moderate)', high: 'var(--risk-high)', severe: 'var(--risk-severe)' }
export const bandColor = score => BAND_COLORS[bandOf(score).key]
export const bandLabel = score => bandOf(score).label

export function bandOf(score) {
  const value = Number.isFinite(score) ? score : 0
  return BANDS.find(b => value < b.max) || BANDS[BANDS.length - 1]
}

const clamp01 = v => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
const numberOrNull = value => (value == null ? null : Number.isFinite(Number(value)) ? Number(value) : null)

export function rainScore(rain6hMm, rainNowMm = 0) {
  const accum = clamp01((numberOrNull(rain6hMm) ?? 0) / 40)
  const intensity = clamp01((numberOrNull(rainNowMm) ?? 0) / 5)
  return Math.round(100 * Math.max(accum, intensity))
}

export function blockageScore(node = {}) {
  const fill = clamp01(numberOrNull(node.fillPct) == null ? 0 : node.fillPct / 100)
  const stale = clamp01(numberOrNull(node.lastServiceHrs) == null ? 0 : node.lastServiceHrs / 72)
  return Math.round(100 * (0.7 * fill + 0.3 * stale))
}

export function floodRisk({ rain6hMm, rainNowMm, zone, drainNodes } = {}) {
  if (!zone || zone.id == null) return { score: 0, parts: {}, missing: { zone: true } }
  const rainPresent = numberOrNull(rain6hMm) != null || numberOrNull(rainNowMm) != null
  const rain = rainPresent ? rainScore(rain6hMm, rainNowMm) / 100 : 0
  const zoneNodes = (drainNodes || []).filter(n => n.zone === zone.id)
  const blockagePresent = zoneNodes.length > 0
  const blockage = blockagePresent ? Math.max(...zoneNodes.map(blockageScore)) / 100 : 0
  const history = clamp01(zone.floodHistory)
  const vulnerability = clamp01(zone.vulnerability)
  const weights = { rain: rainPresent ? 0.45 : 0, blockage: blockagePresent ? 0.25 : 0, history: zone.floodHistory == null ? 0 : 0.15, vulnerability: zone.vulnerability == null ? 0 : 0.15 }
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1
  const composite = (weights.rain * rain + weights.blockage * blockage + weights.history * history + weights.vulnerability * vulnerability) / total
  return { score: Math.round(100 * composite), parts: { rain: Math.round(100 * rain), blockage: Math.round(100 * blockage), history: Math.round(100 * history), vulnerability: Math.round(100 * vulnerability) }, missing: { rain: !rainPresent, blockage: !blockagePresent, history: zone.floodHistory == null, vulnerability: zone.vulnerability == null } }
}

export function heatRisk({ tempC, humidityPct } = {}) {
  if (tempC == null || !Number.isFinite(Number(tempC))) return { score: 0, band: 'safe', parts: {}, missing: { temp: true, humidity: humidityPct == null } }
  const t = clamp01((Number(tempC) - 30) / 15)
  const h = clamp01(((numberOrNull(humidityPct) ?? 40) - 40) / 60)
  const score = Math.round(100 * clamp01(0.75 * t + 0.25 * h))
  return { score, band: bandOf(score).key, parts: { temp: Math.round(100 * t), humidity: Math.round(100 * h) }, missing: { temp: false, humidity: humidityPct == null } }
}

export function airRisk({ usAqi, pm25 } = {}) {
  const suppliedAqi = numberOrNull(usAqi)
  const suppliedPm = numberOrNull(pm25)
  if (suppliedAqi == null && suppliedPm == null) return { score: 0, band: 'safe', aqi: null, parts: {}, missing: true }
  const aqi = suppliedAqi ?? Math.round(suppliedPm * 1.9)
  const score = Math.min(100, Math.round(aqi / 3))
  return { score, band: bandOf(score).key, aqi, parts: { aqi }, missing: false }
}

export function taskPriority(node = {}, zone = {}, rain6hMm) {
  const blockage = blockageScore(node) / 100
  const urgency = 0.2 + 0.8 * clamp01((numberOrNull(rain6hMm) ?? 0) / 40)
  const population = clamp01((numberOrNull(zone.population) ?? 0) / 300000)
  const stale = clamp01((numberOrNull(node.lastServiceHrs) ?? 0) / 72)
  const composite = 0.40 * blockage + 0.30 * urgency + 0.20 * population + 0.10 * stale
  return { score: Math.round(100 * composite), parts: { blockage: Math.round(100 * blockage), urgency: Math.round(100 * urgency), population: Math.round(100 * population), stale: Math.round(100 * stale) } }
}

export function floodWhy(result = {}, { zone = {}, weather = {}, nodes } = {}) {
  const whys = []
  const p = result.parts || {}
  if (result.missing?.rain) whys.push('Rainfall telemetry is unavailable')
  else if (p.rain >= 50) whys.push(`${Number(weather.rain6hMm || 0).toFixed(1)} mm of rain forecast in the next 6 hours`)
  else whys.push(`Light rain expected (${Number(weather.rain6hMm || 0).toFixed(1)} mm / 6h)`)
  const zoneNodes = (nodes || []).filter(n => n.zone === zone.id)
  if (zoneNodes.length) {
    const worst = zoneNodes.reduce((a, b) => blockageScore(a) > blockageScore(b) ? a : b)
    if (blockageScore(worst) >= 60) whys.push(`${worst.name} is ${worst.fillPct ?? '—'}% full and unserved for ${worst.lastServiceHrs ?? '—'}h`)
  }
  if (p.history >= 70) whys.push(`${zone.name || 'This zone'} has a history of waterlogging (near the Ravi low-lying belt)`)
  if (p.vulnerability >= 70) whys.push('Dense population with limited drainage capacity')
  return whys
}

export function airWhy(result = {}) {
  if (result.missing) return ['Air-quality telemetry is unavailable']
  if (result.score >= 50) return [`AQI ${result.aqi} indicates unhealthy air`]
  return [`AQI ${result.aqi} is currently ${result.band}`]
}

export function heatWhy(result = {}, weather = {}) {
  if (result.missing?.temp) return ['Temperature telemetry is unavailable']
  const reasons = [`${weather.tempC}°C temperature`]
  if (result.missing?.humidity) reasons.push('humidity telemetry unavailable')
  else if (result.parts?.humidity >= 40) reasons.push(`${weather.humidityPct}% humidity amplifies heat stress`)
  return reasons
}

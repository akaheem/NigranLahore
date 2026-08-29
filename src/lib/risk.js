/**
 * Raah risk engine — deterministic, explainable weighted overlays.
 * Every weight traces to published parameters in Research Papers/ (see
 * PROJECT_PLAN.md §5). Scores are 0-100; bands: safe/moderate/high/severe.
 */

export const BANDS = [
  { max: 25, key: 'safe',    label: 'Safe' },
  { max: 50, key: 'moderate', label: 'Moderate' },
  { max: 75, key: 'high',    label: 'High' },
  { max: 101, key: 'severe', label: 'Severe' },
]

export function bandOf(score) {
  return BANDS.find(b => score < b.max) || BANDS[BANDS.length - 1]
}

const clamp01 = v => Math.max(0, Math.min(1, v))

/**
 * Rainfall intensity score — anchored on Lahore flash-flood thresholds.
 * Verified archive: 60.7 mm/day (2026-07-22) produced street flooding;
 * SWMM literature (water-16-01464) uses 15-30mm/h cloudburst scenarios.
 */
export function rainScore(rain6hMm, rainNowMm = 0) {
  // 6h accumulation bands: <5 safe → >40 severe (cloudburst class)
  const accum = clamp01(rain6hMm / 40)
  // Current intensity: 5 mm/h already overwhelms 45% capacity drains
  const intensity = clamp01(rainNowMm / 5)
  return Math.round(100 * Math.max(accum, intensity))
}

/**
 * Drain blockage score per node — from simulated telemetry.
 * Fill % dominates; staleness of service adds risk.
 */
export function blockageScore(node) {
  const fill = clamp01(node.fillPct / 100)
  const stale = clamp01(node.lastServiceHrs / 72) // 3 days unserved = max stale
  return Math.round(100 * (0.7 * fill + 0.3 * stale))
}

/**
 * Zone flood risk — the citizen-facing headline number.
 * 0.45 rain forecast (live Open-Meteo)
 * 0.25 local drain blockage (telemetry)
 * 0.15 historical waterlogging (published flood literature)
 * 0.15 zone vulnerability (population × low-lying)
 */
export function floodRisk({ rain6hMm, rainNowMm, zone, drainNodes }) {
  const rain = rainScore(rain6hMm, rainNowMm) / 100
  const zoneNodes = (drainNodes || []).filter(n => n.zone === zone.id)
  const blockage = zoneNodes.length
    ? Math.max(...zoneNodes.map(blockageScore)) / 100
    : 0.3
  const history = zone.floodHistory
  const vulnerability = zone.vulnerability

  const composite = 0.45 * rain + 0.25 * blockage + 0.15 * history + 0.15 * vulnerability
  return {
    score: Math.round(100 * composite),
    parts: { rain: Math.round(100 * rain), blockage: Math.round(100 * blockage), history: Math.round(100 * history), vulnerability: Math.round(100 * vulnerability) },
  }
}

/**
 * Heat risk — humid-heat banding. Lahore heatwave plan triggers advisories
 * above 40°C; humidity amplification via simplified Steadman approach.
 */
export function heatRisk({ tempC, humidityPct }) {
  if (tempC == null) return { score: 0, parts: {} }
  const t = clamp01((tempC - 30) / 15)          // 30→0, 45+→1
  const h = clamp01(((humidityPct || 40) - 40) / 60)
  const score = Math.round(100 * clamp01(0.75 * t + 0.25 * h))
  return { score, parts: { temp: Math.round(100 * t), humidity: Math.round(100 * h) } }
}

/**
 * Air risk — US AQI bands mapped to 0-100 + health guidance.
 * AQI 0-50 safe … 300+ severe. PM2.5 observed live: 61-83 µg/m³ (AQI ~150-170).
 */
export function airRisk({ usAqi, pm25 }) {
  const aqi = usAqi ?? (pm25 != null ? Math.round(pm25 * 1.9) : 0) // rough PM2.5→AQI fallback
  const score = Math.min(100, Math.round(aqi / 3))
  const band = aqi <= 50 ? 'safe' : aqi <= 100 ? 'moderate' : aqi <= 150 ? 'high' : aqi <= 200 ? 'severe' : 'severe'
  return { score, band, aqi, parts: { aqi } }
}

/**
 * Field-task priority — the dispatch ordering for field teams.
 * 0.40 blockage + 0.30 rain urgency + 0.20 affected population + 0.10 staleness.
 */
export function taskPriority(node, zone, rain6hMm) {
  const blockage = blockageScore(node) / 100
  // urgency ramps as rain approaches: no rain → 0.2 baseline, 40mm+ → 1
  const urgency = 0.2 + 0.8 * clamp01(rain6hMm / 40)
  const population = clamp01(zone.population / 300000)
  const stale = clamp01(node.lastServiceHrs / 72)

  const composite = 0.40 * blockage + 0.30 * urgency + 0.20 * population + 0.10 * stale
  return {
    score: Math.round(100 * composite),
    parts: {
      blockage: Math.round(100 * blockage),
      urgency: Math.round(100 * urgency),
      population: Math.round(100 * population),
      stale: Math.round(100 * stale),
    },
  }
}

/** Human-readable "why" strings for a flood-risk result. */
export function floodWhy(result, { zone, weather, nodes }) {
  const whys = []
  const p = result.parts
  if (p.rain >= 50) whys.push(`${weather?.rain6hMm?.toFixed(1) ?? '—'} mm of rain forecast in the next 6 hours`)
  else whys.push(`Light rain expected (${weather?.rain6hMm?.toFixed(1) ?? '0'} mm / 6h)`)
  const zoneNodes = (nodes || []).filter(n => n.zone === zone.id)
  if (zoneNodes.length) {
    const worst = zoneNodes.reduce((a, b) => (blockageScore(a) > blockageScore(b) ? a : b))
    if (blockageScore(worst) >= 60) whys.push(`${worst.name} is ${worst.fillPct}% full and unserved for ${worst.lastServiceHrs}h`)
  }
  if (p.history >= 70) whys.push(`${zone.name} has a history of waterlogging (near the Ravi low-lying belt)`)
  if (p.vulnerability >= 70) whys.push(`Dense population with limited drainage capacity`)
  return whys
}

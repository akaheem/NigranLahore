/**
 * Nigran risk engine — deterministic, explainable weighted overlays.
 * Weights are cited inline at each overlay: the flood and drain-priority sets
 * are published in PROJECT_PLAN.md §5, the waste/drainage set below is this
 * project's own choice. Scores are 0-100; bands: safe/moderate/high/severe.
 */

import { WASTE, SERVICE_POLICY } from '../data/calibration.js'

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

/**
 * Hex twins of the band colors — for SVG contexts (Leaflet) that can't resolve
 * CSS vars. These MUST track `--risk-*` in index.css; they are a hand-maintained
 * copy, and `safe` in particular is not the brand emerald (see the note on
 * `--risk-safe`). When the two drift, the map disagrees with every other surface
 * about what "safe" looks like.
 */
export const BAND_COLORS_HEX = { safe: '#15803D', moderate: '#D97706', high: '#EA580C', severe: '#DC2626' }
export const bandColorHex = score => BAND_COLORS_HEX[bandOf(score).key]
export const bandLabel = score => bandOf(score).label

export function bandOf(score) {
  const value = Number.isFinite(score) ? score : 0
  return BANDS.find(b => value < b.max) || BANDS[BANDS.length - 1]
}

const clamp01 = v => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))

/**
 * Fill levels read to two decimals wherever they are spoken about. The
 * decimals are the point: they are what lets a refilling drain look like it is
 * moving. Rounded here rather than at the source so a hand-built node in a
 * caller still prints consistently with the live model's.
 */
const fmtPct = v => (Number.isFinite(v) ? v.toFixed(2) : '—')
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

/**
 * The drain lifecycle state a fill level implies. Thresholds come from
 * SERVICE_POLICY in calibration.js — this project's operational policy, not a
 * cited parameter, and labelled as such in the UI.
 *
 * Note these are NOT the bands in BANDS above. Those band a 0-100 RISK SCORE
 * into safe/moderate/high/severe. These describe a drain's own condition, and
 * the two can disagree: a drain can be 'due' by fill while its zone's flood
 * risk is 'severe' because of forecast rain.
 *
 * `hasServiceHistory` matters only below the due line. Being under 40% means
 * "recently serviced" only if it actually was serviced — a drain that has never
 * been cleared and simply sits low is work waiting, not work done, and must not
 * wear a "Recently serviced" badge. (D-6's calibrated seed is 35%, and it has
 * never been cleared.)
 *
 * An unknown fill returns 'due' — the app's standing rule is that a missing
 * number must never read as safe, so an unreadable drain stays work.
 */
export function serviceState(fillPct, hasServiceHistory = true) {
  const v = numberOrNull(fillPct)
  if (v == null) return 'due'
  if (v >= SERVICE_POLICY.blockedAt) return 'blocked'
  if (v >= SERVICE_POLICY.criticalAt) return 'critical'
  if (v >= SERVICE_POLICY.dueAt) return 'due'
  return hasServiceHistory ? 'serviced' : 'due'
}

/** Label + palette colour per lifecycle state, so the UI states them once. */
export const SERVICE_STATE_META = {
  serviced: { label: 'Recently serviced', color: BAND_COLORS.safe, hex: BAND_COLORS_HEX.safe },
  due: { label: 'Due', color: BAND_COLORS.moderate, hex: BAND_COLORS_HEX.moderate },
  critical: { label: 'Critical', color: BAND_COLORS.high, hex: BAND_COLORS_HEX.high },
  blocked: { label: 'Blocked — must service', color: BAND_COLORS.severe, hex: BAND_COLORS_HEX.severe },
}

/**
 * Is this drain work right now?
 *
 * A drain that has been serviced is out of the queue until it refills past
 * SERVICE_POLICY.dueAt. A drain that has NEVER been serviced is always work
 * whatever its fill: its calibrated seed is its documented current condition,
 * so there is nothing for it to wait for. (D-6's seed is 35% — below the due
 * threshold — and it is an open task today.)
 *
 * Stated as one rule over `serviceState` rather than a second copy of it, so
 * the badge and the queue can never disagree about the same drain.
 */
export function drainIsOpen(fillPct, hasServiceHistory) {
  return serviceState(fillPct, hasServiceHistory) !== 'serviced'
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

/**
 * Waste & drainage risk (0-100) for one zone — the fourth hazard, alongside
 * flood / air / heat. These four weights are this project's own choice. They
 * are consistent with the flood and priority weightings in PROJECT_PLAN.md §5,
 * but that section sets neither of these numbers — nothing here should be read
 * as a citation, and README.md's calibration section lists them as a choice.
 * They follow the same renormalize-when-missing contract as floodRisk: an input
 * that is absent is dropped from both the numerator and the denominator, so a
 * zone with no drain node is never silently scored "safe".
 *
 *   drain = 0.45 × worst_blockage     (worst drain's blockage in the zone)
 *         + 0.25 × capacity_deficit   (1 - drainageCapacity, from lahore.js)
 *         + 0.15 × unserved           (worst drain's lastServiceHrs / 72)
 *         + 0.15 × waste_load         (population × WASTE.kgPerCapPerDay)
 */
export function drainRisk({ zone, drainNodes } = {}) {
  if (!zone || zone.id == null) return { score: 0, parts: {}, missing: { zone: true } }

  const zoneNodes = (drainNodes || []).filter(n => n.zone === zone.id)
  const blockagePresent = zoneNodes.length > 0
  // The zone's weakest link drives the score — a trunk drain at 90% is the
  // risk, not the average of it and a clear one.
  const worst = blockagePresent
    ? zoneNodes.reduce((a, b) => (blockageScore(a) >= blockageScore(b) ? a : b))
    : null
  const blockage = blockagePresent ? blockageScore(worst) / 100 : 0
  const unservedPresent = worst != null && numberOrNull(worst.lastServiceHrs) != null
  const unserved = unservedPresent ? clamp01(worst.lastServiceHrs / 72) : 0
  const capacityPresent = numberOrNull(zone.drainageCapacity) != null
  const capacityDeficit = capacityPresent ? clamp01(1 - zone.drainageCapacity) : 0
  const wastePresent = numberOrNull(zone.population) != null
  // 0.84 kg/cap/day (Batool & Ch 2009) against a 300k-resident reference zone
  const wasteLoad = wastePresent ? clamp01((zone.population * WASTE.kgPerCapPerDay) / (300000 * WASTE.kgPerCapPerDay)) : 0

  const weights = {
    blockage: blockagePresent ? 0.45 : 0,
    capacity: capacityPresent ? 0.25 : 0,
    unserved: unservedPresent ? 0.15 : 0,
    waste: wastePresent ? 0.15 : 0,
  }
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1
  const composite = (
    weights.blockage * blockage
    + weights.capacity * capacityDeficit
    + weights.unserved * unserved
    + weights.waste * wasteLoad
  ) / total

  return {
    score: Math.round(100 * composite),
    parts: {
      blockage: Math.round(100 * blockage),
      capacity: Math.round(100 * capacityDeficit),
      unserved: Math.round(100 * unserved),
      waste: Math.round(100 * wasteLoad),
    },
    missing: {
      blockage: !blockagePresent,
      capacity: !capacityPresent,
      unserved: !unservedPresent,
      waste: !wastePresent,
    },
    worstDrain: worst,
  }
}

export function drainWhy(result = {}, { zone = {} } = {}) {
  if (!result.parts || result.missing?.zone) return ['No zone selected']
  const whys = []
  const p = result.parts || {}
  const worst = result.worstDrain
  if (result.missing?.blockage) {
    whys.push('No drain telemetry is mapped to this zone — scoring on drainage capacity alone')
  } else if (worst) {
    // Phrased from the same lifecycle bands as the badge, so the explanation
    // can never contradict the card it opens from.
    const state = serviceState(worst.fillPct)
    const fill = `${fmtPct(worst.fillPct)}%`
    const unserved = `unserved for ${worst.lastServiceHrs ?? '—'}h`
    if (state === 'blocked') whys.push(`${worst.name} is blocked at ${fill} — it has stopped draining, and only servicing clears it`)
    else if (state === 'critical') whys.push(`${worst.name} is critical at ${fill}, ${unserved}`)
    // Below the due line. Stated as the position it is in, not as a service
    // that happened: this function has no service history to read, and a
    // never-cleared drain can sit here too.
    else if (state === 'serviced') whys.push(`${worst.name} is holding at ${fill} — under the ${SERVICE_POLICY.dueAt}% service line, ${unserved}`)
    else whys.push(`${worst.name} is at ${fill}, ${unserved}`)
  }
  if (p.capacity >= 60) whys.push(`${zone.name || 'This zone'} drains at only ${Math.round((zone.drainageCapacity ?? 0) * 100)}% of its design-storm capacity`)
  if (p.unserved >= 50) whys.push('This drain has gone well past its routine service interval')
  if (p.waste >= 60) whys.push(`Dense waste load — ~${WASTE.kgPerCapPerDay} kg per person per day, and only ~${Math.round(WASTE.collectionRate * 100)}% is collected`)
  return whys
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
    // Only the two states that actually threaten the street get named here.
    const state = serviceState(worst.fillPct)
    if (state === 'blocked' || state === 'critical') {
      whys.push(`${worst.name} is ${state} at ${fmtPct(worst.fillPct)}%, unserved for ${worst.lastServiceHrs ?? '—'}h`)
    }
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

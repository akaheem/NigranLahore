/**
 * Geospatial helpers — shared by the citizen view's locate-me and the
 * nearest-relief finder. Pure functions, no dependencies, no state.
 */

/** Great-circle distance in km between two { lat, lng } points. */
export function haversineKm(a, b) {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Average walking speed. This is a stated ASSUMPTION, not a cited parameter —
 * 4.5 km/h is the common planning figure for a comfortable urban pace, and the
 * label in the UI says "walk" so the number is never read as a driving time.
 */
export const WALK_KMH = 4.5

/** Minutes to walk `km` at WALK_KMH, rounded to the nearest minute. */
export function walkMinutes(km, kmh = WALK_KMH) {
  if (!Number.isFinite(km) || km < 0) return null
  return Math.round((km / kmh) * 60)
}

/**
 * The `limit` nearest items to `origin`, each annotated with `distanceKm`.
 * Sorted by distance ascending, ties broken by `capacity` descending so the
 * larger facility wins when two sit equally far away. Items missing usable
 * coordinates are dropped rather than sorted arbitrarily.
 *
 * Returns NEW objects — the input array is never mutated.
 */
export function nearestBy(origin, items = [], limit = Infinity) {
  if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) return []
  return (items || [])
    .filter(it => it && Number.isFinite(it.lat) && Number.isFinite(it.lng))
    .map(it => ({ ...it, distanceKm: haversineKm(origin, it) }))
    .sort((a, b) => (a.distanceKm === b.distanceKm
      ? (Number(b.capacity) || 0) - (Number(a.capacity) || 0)
      : a.distanceKm - b.distanceKm))
    .slice(0, limit)
}

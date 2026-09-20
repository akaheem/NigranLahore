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
 * How precisely a citizen's own location may be published: three decimal
 * places, ~111 m north–south and ~95 m east–west at Lahore's latitude.
 *
 * This is a privacy floor, not a storage format. A pin precise enough to name
 * the street is what makes the map useful; one precise enough to name the house
 * is a thing a person did not agree to when they tapped "use my location", and
 * the difference between the two is three decimal places.
 *
 * Mirrored by `COORD_DECIMALS` in server/src/validate.js, which re-rounds
 * whatever it is sent — the client rounds so the person sees what will be
 * stored, the server rounds because it cannot assume the client did.
 */
export const COORD_DECIMALS = 3

/** The size of that rounding, in metres — the figure the UI quotes. */
export const LOCATION_PRECISION_M = 111

/**
 * Snap a coordinate to `decimals` places, or null if it is not a usable number.
 *
 * Strict about its input: `Number(null)` and `Number('')` are both 0, so a
 * lenient version would silently place a report at (0, 0) in the Atlantic.
 */
export function roundCoordinate(value, decimals = COORD_DECIMALS) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * Lahore, roughly. A fix outside this box is a mis-set device rather than a
 * place someone is standing, and the form refuses it rather than pinning a
 * report to the sea. Mirrors `LAHORE_BOUNDS` in server/src/validate.js.
 */
export const LAHORE_BOUNDS = { minLat: 31.2, maxLat: 31.8, minLng: 74.1, maxLng: 74.6 }

export const inLahore = ({ lat, lng }) =>
  Number.isFinite(lat) && Number.isFinite(lng)
  && lat >= LAHORE_BOUNDS.minLat && lat <= LAHORE_BOUNDS.maxLat
  && lng >= LAHORE_BOUNDS.minLng && lng <= LAHORE_BOUNDS.maxLng

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

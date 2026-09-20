import { describe, it, expect } from 'vitest'
import { haversineKm, nearestBy, walkMinutes, WALK_KMH, roundCoordinate, inLahore, LOCATION_PRECISION_M } from '../../src/lib/geo.js'
import { ZONES, COOL_ASSETS, LAHORE_CENTER, DRAIN_NODES } from '../../src/data/lahore.js'

const shahdara = ZONES.find(z => z.id === 'shahdara')
const dha = ZONES.find(z => z.id === 'dha')

describe('haversineKm', () => {
  it('is zero for a point against itself', () => {
    expect(haversineKm(LAHORE_CENTER, LAHORE_CENTER)).toBe(0)
  })

  it('is symmetric', () => {
    expect(haversineKm(shahdara, dha)).toBeCloseTo(haversineKm(dha, shahdara), 10)
  })

  it('matches the known span of Lahore (Shahdara → DHA ≈ 24 km)', () => {
    expect(haversineKm(shahdara, dha)).toBeGreaterThan(22)
    expect(haversineKm(shahdara, dha)).toBeLessThan(26)
  })

  it('puts every zone within 20 km of the city centre', () => {
    for (const z of ZONES) {
      expect(haversineKm(LAHORE_CENTER, z)).toBeLessThan(20)
    }
  })
})

describe('walkMinutes', () => {
  it('converts km at the stated 4.5 km/h pace', () => {
    expect(walkMinutes(4.5)).toBe(60)
    expect(walkMinutes(1)).toBe(13) // 13.33 → 13
    expect(walkMinutes(0)).toBe(0)
  })

  it('honours a custom speed', () => {
    expect(walkMinutes(6, 6)).toBe(60)
    expect(WALK_KMH).toBe(4.5)
  })

  it('is null-safe for unusable input', () => {
    expect(walkMinutes(null)).toBeNull()
    expect(walkMinutes(undefined)).toBeNull()
    expect(walkMinutes(NaN)).toBeNull()
    expect(walkMinutes(-1)).toBeNull()
  })
})

describe('nearestBy', () => {
  it('sorts ascending by distance and annotates each item', () => {
    const out = nearestBy(LAHORE_CENTER, COOL_ASSETS)
    expect(out).toHaveLength(COOL_ASSETS.length)
    const distances = out.map(a => a.distanceKm)
    expect([...distances].sort((a, b) => a - b)).toEqual(distances)
    for (const a of out) expect(typeof a.distanceKm).toBe('number')
  })

  it('limits to the requested count', () => {
    expect(nearestBy(LAHORE_CENTER, COOL_ASSETS, 3)).toHaveLength(3)
  })

  it('returns new objects and never mutates the source', () => {
    const out = nearestBy(LAHORE_CENTER, COOL_ASSETS, 2)
    expect(out[0]).not.toBe(COOL_ASSETS[0])
    expect(COOL_ASSETS.every(a => a.distanceKm === undefined)).toBe(true)
  })

  it('puts the asset nearest the selected zone first', () => {
    // Shahdara's relief camp sits in Shahdara itself — it must win outright.
    const nearest = nearestBy(shahdara, COOL_ASSETS, 1)[0]
    expect(nearest.id).toBe('c3')
  })

  it('breaks a distance tie by capacity, larger first', () => {
    const origin = { lat: 31.5, lng: 74.3 }
    const items = [
      { id: 'small', lat: 31.5, lng: 74.4, capacity: 100 },
      { id: 'large', lat: 31.5, lng: 74.2, capacity: 900 },
    ]
    // Both are exactly the same distance east/west of the origin.
    expect(nearestBy(origin, items).map(i => i.id)).toEqual(['large', 'small'])
  })

  it('drops items with unusable coordinates', () => {
    const items = [
      { id: 'good', lat: 31.5, lng: 74.3, capacity: 10 },
      { id: 'no-coords', capacity: 999 },
      { id: 'null-lat', lat: null, lng: 74.3, capacity: 999 },
    ]
    expect(nearestBy(LAHORE_CENTER, items).map(i => i.id)).toEqual(['good'])
  })

  it('returns an empty list for an unusable origin or empty input', () => {
    expect(nearestBy(null, COOL_ASSETS)).toEqual([])
    expect(nearestBy({ lat: NaN, lng: 74 }, COOL_ASSETS)).toEqual([])
    expect(nearestBy(LAHORE_CENTER, [])).toEqual([])
    expect(nearestBy(LAHORE_CENTER, undefined)).toEqual([])
  })

  it('ranks drain nodes by distance too (shared by the crew suggestion)', () => {
    const out = nearestBy(shahdara, DRAIN_NODES)
    expect(out[0].zone).toBe('shahdara')
  })
})

describe('roundCoordinate — the privacy floor on a published pin', () => {
  it('snaps to three decimal places, which is what the UI promises', () => {
    expect(roundCoordinate(31.5204123)).toBe(31.52)
    expect(roundCoordinate(74.3581234)).toBe(74.358)
  })

  it('leaves a value that is already rounded exactly as it was', () => {
    // Idempotence matters: the server rounds again whatever the client sent,
    // and it must not be able to move a pin the client already snapped.
    expect(roundCoordinate(31.52)).toBe(31.52)
    expect(roundCoordinate(roundCoordinate(31.5204123))).toBe(31.52)
  })

  it('refuses anything that is not a usable finite number', () => {
    // `Number(null)` and `Number('')` are both 0, so a lenient version would
    // place a report at (0, 0) — in the Atlantic, off the coast of Africa.
    expect(roundCoordinate(null)).toBeNull()
    expect(roundCoordinate(undefined)).toBeNull()
    expect(roundCoordinate('')).toBeNull()
    expect(roundCoordinate('31.52')).toBeNull()
    expect(roundCoordinate(NaN)).toBeNull()
    expect(roundCoordinate(Infinity)).toBeNull()
  })

  it('handles zero, where a lenient check would have said "missing"', () => {
    expect(roundCoordinate(0)).toBe(0)
  })

  it('can be asked for a different precision', () => {
    expect(roundCoordinate(31.5204123, 1)).toBe(31.5)
    expect(roundCoordinate(31.5204123, 0)).toBe(32)
  })
})

describe('inLahore', () => {
  it('accepts a fix inside the city', () => {
    expect(inLahore({ lat: 31.52, lng: 74.358 })).toBe(true)
    expect(inLahore({ lat: 31.2, lng: 74.1 })).toBe(true)
    expect(inLahore({ lat: 31.8, lng: 74.6 })).toBe(true)
  })

  it('refuses a fix outside it, rather than pinning a report to the sea', () => {
    expect(inLahore({ lat: 0, lng: 0 })).toBe(false)
    expect(inLahore({ lat: 31.1, lng: 74.3 })).toBe(false)
    expect(inLahore({ lat: 31.5, lng: 74.7 })).toBe(false)
    expect(inLahore({ lat: -31.52, lng: 74.358 })).toBe(false)
  })

  it('refuses a half-set or missing pair', () => {
    expect(inLahore({ lat: 31.52, lng: null })).toBe(false)
    expect(inLahore({ lat: null, lng: 74.358 })).toBe(false)
    expect(inLahore({})).toBe(false)
  })

  it('quotes a precision in metres that matches three decimal places', () => {
    // One degree of latitude is ~111 km, so the third decimal is ~111 m.
    expect(LOCATION_PRECISION_M).toBe(111)
  })
})

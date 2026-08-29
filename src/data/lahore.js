/**
 * Lahore zones — seeds the map + per-zone risk scoring.
 * Coordinates are real Lahore localities; vulnerability/waterlogging attributes
 * are calibrated to published flood-risk literature for the Ravi corridor and
 * low-lying tankas (Research Papers/, esp. water-16-01464.pdf, journal.pone.0307608.pdf).
 */
export const ZONES = [
  {
    id: 'shadbagh',
    name: 'Shadbagh',
    lat: 31.6330, lng: 74.2980,
    population: 210000,
    elevationM: 212,            // low-lying, near Ravi floodplain
    floodHistory: 0.86,          // historical waterlogging frequency (0-1)
    drainageCapacity: 0.45,      // 0-1, fraction of design storm capacity
    vulnerability: 0.82,         // population density × informal settlement share
  },
  {
    id: 'chauburji',
    name: 'Chauburji',
    lat: 31.5690, lng: 74.3090,
    population: 180000,
    elevationM: 215,
    floodHistory: 0.78,
    drainageCapacity: 0.52,
    vulnerability: 0.74,
  },
  {
    id: 'gulberg',
    name: 'Gulberg III',
    lat: 31.5360, lng: 74.3430,
    population: 260000,
    elevationM: 219,
    floodHistory: 0.55,
    drainageCapacity: 0.68,
    vulnerability: 0.58,
  },
  {
    id: 'dha',
    name: 'DHA Phase 5',
    lat: 31.4670, lng: 74.3960,
    population: 150000,
    elevationM: 224,
    floodHistory: 0.32,
    drainageCapacity: 0.80,
    vulnerability: 0.35,
  },
  {
    id: 'shahdara',
    name: 'Shahdara',
    lat: 31.6390, lng: 74.2650,
    population: 190000,
    elevationM: 210,             // Ravi left bank — historically first to flood
    floodHistory: 0.92,
    drainageCapacity: 0.38,
    vulnerability: 0.88,
  },
  {
    id: 'misrishah',
    name: 'Misri Shah',
    lat: 31.6010, lng: 74.3230,
    population: 170000,
    elevationM: 213,
    floodHistory: 0.81,
    drainageCapacity: 0.44,
    vulnerability: 0.80,
  },
  {
    id: 'modeltown',
    name: 'Model Town',
    lat: 31.4850, lng: 74.3230,
    population: 140000,
    elevationM: 220,
    floodHistory: 0.40,
    drainageCapacity: 0.72,
    vulnerability: 0.45,
  },
  {
    id: 'township',
    name: 'Township',
    lat: 31.4690, lng: 74.2790,
    population: 160000,
    elevationM: 217,
    floodHistory: 0.62,
    drainageCapacity: 0.58,
    vulnerability: 0.66,
  },
]

/**
 * Cooling / relief assets (heat module). Types match Urban Unit Heatwave Plan
 * categories: filtration plants (free drinking water), shelter/relief camps,
 * hospitals with heat-stroke units.
 */
export const COOL_ASSETS = [
  { id: 'c1', type: 'water',  name: 'Filtration Plant — Chauburji Gate', lat: 31.5714, lng: 74.3077, capacity: 2000 },
  { id: 'c2', type: 'water',  name: 'Filtration Plant — Shalimar',        lat: 31.6204, lng: 74.3836, capacity: 1800 },
  { id: 'c3', type: 'camp',   name: 'Relief Camp — Shahdara Ground',      lat: 31.6412, lng: 74.2671, capacity: 400 },
  { id: 'c4', type: 'camp',   name: 'Relief Camp — Model Town Park',      lat: 31.4831, lng: 74.3244, capacity: 350 },
  { id: 'c5', type: 'hospital', name: 'Jinnah Hospital (Heat Unit)',      lat: 31.5276, lng: 74.3305, capacity: 120 },
  { id: 'c6', type: 'hospital', name: 'Services Hospital (Heat Unit)',    lat: 31.5373, lng: 74.3357, capacity: 100 },
  { id: 'c7', type: 'water',  name: 'Filtration Plant — Township C-Block', lat: 31.4675, lng: 74.2812, capacity: 1500 },
  { id: 'c8', type: 'water',  name: 'Filtration Plant — Gulberg Main Blvd', lat: 31.5349, lng: 74.3410, capacity: 1600 },
]

/**
 * Drain / waste telemetry nodes — SIMULATED, calibrated to published Lahore SWM
 * parameters (fill rates, capacities, service intervals from the Research Papers
 * folder). Each node maps to the nearest zone for risk coupling.
 */
export const DRAIN_NODES = [
  { id: 'd1', zone: 'shahdara',  name: 'Drain D-1 Shahdara Trunk',   lat: 31.6388, lng: 74.2665, fillPct: 87, lastServiceHrs: 52, capacityTons: 12 },
  { id: 'd2', zone: 'shadbagh',  name: 'Drain D-2 Shadbagh',         lat: 31.6321, lng: 74.2989, fillPct: 74, lastServiceHrs: 31, capacityTons: 10 },
  { id: 'd3', zone: 'misrishah', name: 'Drain D-3 Misri Shah',       lat: 31.6018, lng: 74.3238, fillPct: 81, lastServiceHrs: 44, capacityTons: 10 },
  { id: 'd4', zone: 'chauburji', name: 'Drain D-4 Chauburji',        lat: 31.5696, lng: 74.3098, fillPct: 63, lastServiceHrs: 20, capacityTons: 8 },
  { id: 'd5', zone: 'gulberg',   name: 'Drain D-5 Gulberg Main',     lat: 31.5364, lng: 74.3438, fillPct: 48, lastServiceHrs: 12, capacityTons: 14 },
  { id: 'd6', zone: 'dha',       name: 'Drain D-6 DHA Canal Rd',     lat: 31.4678, lng: 74.3955, fillPct: 35, lastServiceHrs: 8,  capacityTons: 14 },
  { id: 'd7', zone: 'modeltown', name: 'Drain D-7 Model Town',       lat: 31.4856, lng: 74.3237, fillPct: 42, lastServiceHrs: 16, capacityTons: 9 },
  { id: 'd8', zone: 'township',  name: 'Drain D-8 Township',         lat: 31.4694, lng: 74.2797, fillPct: 69, lastServiceHrs: 27, capacityTons: 9 },
]

/** City center for map defaults + API coordinates. */
export const LAHORE_CENTER = { lat: 31.5497, lng: 74.3436 }

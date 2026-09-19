import { nearestBy } from '../lib/geo.js'

/**
 * Prototype crew roster — a MODELLED dispatcher, not a real one.
 *
 * Nigran has no integration with WASA or LWMC and no access to any live crew
 * roster. These three crews exist so the Field Ops view can demonstrate the
 * assignment step that precedes the drain queue: who is being sent, and how
 * much work they are already carrying. The names, depots and shift windows are
 * plausible-placeholder values, not records.
 *
 * The capacity model follows the same precedent the queue itself cites —
 * Metson et al. 2021 formulates crew-to-task assignment as a capacitated
 * transportation problem, so each crew carries a per-shift task ceiling and the
 * roster shows the load against it. See DISPATCH_CITATION in calibration.js.
 *
 * `bias` mirrors each depot toward the zones it actually sits in, so the
 * suggested crew for a drain is the one whose depot is nearest — the same
 * nearest-assignment logic the citizen view uses for relief assets.
 */
export const CREWS = [
  {
    id: 'crew-1',
    name: 'Crew Alpha',
    depot: 'Shahdara Depot',
    shift: '06:00–14:00',
    capacityPerShift: 3,
    lat: 31.6392,
    lng: 74.2662,
  },
  {
    id: 'crew-2',
    name: 'Crew Bravo',
    depot: 'Gulberg Depot',
    shift: '06:00–14:00',
    capacityPerShift: 3,
    lat: 31.5362,
    lng: 74.3432,
  },
  {
    id: 'crew-3',
    name: 'Crew Charlie',
    depot: 'Township Depot',
    shift: '14:00–22:00',
    capacityPerShift: 2,
    lat: 31.4692,
    lng: 74.2792,
  },
]

/** Plain-language note surfaced in the Field Ops UI next to the roster. */
export const CREW_NOTE =
  'Crew roster is a prototype model — no live WASA/LWMC integration. Capacities follow the capacitated-assignment precedent cited below.'

/**
 * The crew whose depot sits nearest a zone — the suggested assignment.
 * Returns the crew object, or null when the zone has no usable coordinates.
 */
export function suggestCrewFor(zone, crews = CREWS) {
  return nearestBy(zone, crews, 1)[0] ?? null
}

/** Task load per crew: open (unserviced) task ids grouped by crewId. */
export function crewLoads(openTaskIds = [], assignments = {}) {
  const out = {}
  for (const crew of CREWS) out[crew.id] = []
  for (const id of openTaskIds) {
    const crewId = assignments[id]
    if (crewId && out[crewId]) out[crewId].push(id)
  }
  return out
}

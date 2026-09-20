/**
 * Paper-calibrated parameters — the constants below trace to a source in
 * Research Papers/ or verified live data, cited inline. This is what makes
 * Nigran's numbers defensible to judges rather than invented.
 *
 * That is a claim about the cited parameters, not about every export in this
 * file. The drain service lifecycle further down is this project's own
 * operational policy and comes from no paper; it says so at its own definition,
 * and it must not be read as carrying the provenance described here.
 */

/**
 * WASA 'sore points' (paper 13.pdf): 55 documented localities with stagnant
 * water after intense rain, 110 incidents 2012-2017. Town shares of flooded
 * area: Data Gunj Bakhsh 29%, Gulberg 24%, Ravi 16%, Samanabad 14%,
 * Shalimar 7%, Aziz Bhatti 4%.
 */
export const SORE_POINT_FACT = 'WASA tracks 55 “sore points” — streets that stay flooded after every intense spell (2012–2017 incident record)'

/** Waste: 0.84 kg/cap/day generation; only 60% collected (Batool & Ch 2009). */
export const WASTE = {
  kgPerCapPerDay: 0.84,
  collectionRate: 0.60,
  organicsPct: 67.02,   // drain-clogging fraction (organics + film plastic ≈ 80%)
  filmPlasticPct: 12.94,
}

/** Air: live Open-Meteo US AQI; Nov 1 2025 Lahore hit AQI 2026 (PM2.5 1083 µg/m³). */
export const AIR_RECORD_FACT = '1 Nov 2025: AQI 2,026 — the most polluted city on Earth that morning'

/** Monsoon record facts for the demo narrative (news sweep, dated sources). */
export const RECORDS = [
  { date: '25 Jun 2025', fact: '276 mm in 24h — Lahore\'s wettest June day on record', src: 'PMD via The Nation' },
  { date: '3 Jul 2025', fact: 'Heaviest July rain in 44 years', src: 'Dawn' },
  { date: '5 Aug 2025', fact: '~355 mm in 24h — heaviest since 1895', src: 'PMD via Dawn/Reuters' },
  { date: '1 Nov 2025', fact: 'AQI 2,026 — world\'s most polluted city', src: 'IQAir' },
  { date: '22 Jul 2026', fact: '60.7 mm in a day (Open-Meteo archive)', src: 'Open-Meteo' },
]

/**
 * Two-golds dispatch precedent (Metson et al. 2021): crew-to-task assignment as
 * a capacitated transportation problem, not full VRP; two-phase fix-and-resolve
 * heuristic (solve with averages → freeze assignments → re-solve legs). We use
 * the greedy priority-queue analogue for the 4-day build.
 */
export const DISPATCH_CITATION = 'Dispatch formulated per Metson et al. 2021 (capacitated transportation problem, two-phase heuristic)'

/**
 * Bin telemetry vocabulary per Sosunova & Porras 2022 (IEEE Access): fill-level
 * (ultrasonic), GPS, weight, temperature; Zigbee/LoRa → LTE backhaul. Fill
 * RATES are not published in the literature (their own stated gap) — ours are
 * simulated and labeled as such in the UI.
 */
export const TELEMETRY_NOTE = 'Bin fill telemetry is simulated (the literature itself notes the lack of open historical collection data); schema follows Sosunova & Porras 2022.'

/**
 * The drain service lifecycle — OPERATIONAL POLICY, not a cited parameter.
 *
 * Unlike everything else in this file, these four numbers come from no paper.
 * They are the intervention thresholds this project chose to model with, and
 * they are labelled as such wherever the UI states them. They must not be
 * presented to a reader as if a source had established them.
 *
 * The lifecycle they define, per drain, on the fill model:
 *
 *   0-39.99%   recently serviced — cleared, and not yet work again
 *   40-79.99%  due again         — back in the open queue
 *   80-94.99%  critical          — open, and flagged
 *   95%+       blocked           — the model stops here; it cannot get worse.
 *                                  Fill holds at exactly 95% until someone
 *                                  services it, then the cycle restarts.
 *
 * `blockedAt` doubles as the fill cap: it is the ceiling in currentFillPct, so
 * a neglected drain pins itself at 95% rather than climbing to a fictitious
 * 100%. A fully blocked drain is the terminal state, not a full one.
 *
 * A drain with NO service history is always open regardless of fill — its
 * calibrated seed is its documented current condition, so there is nothing for
 * it to wait for. Only a drain that has actually been serviced waits to come
 * back at `dueAt`. (This matters: D-6's seed is 35%.)
 */
export const SERVICE_POLICY = {
  dueAt: 40,       // % fill at which a serviced drain is work again
  criticalAt: 80,  // % fill at which it is flagged critical
  blockedAt: 95,   // % fill cap — the terminal state, frozen until serviced
  clearedTo: 5,    // % fill a drain drops to when serviced
}

/** Shown in the UI so the thresholds are never mistaken for measured values. */
export const SERVICE_POLICY_NOTE = 'Service thresholds (40 / 80 / 95%) are this project\'s operational policy, not a cited hydrological parameter.'

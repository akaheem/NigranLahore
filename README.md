# Nigran — Watch over Lahore

Hyperlocal flood, air, heat, and drainage decision intelligence for Lahore. Nigran (نگران — "the guardian") turns live weather data and paper-calibrated urban parameters into a street-level answer to one question: *what should I do in the next six hours?*

Three surfaces:

- **Citizen view** — live rain, air (US AQI), temperature, humidity; a flood-risk map of Lahore's zones; a "What to do now" action list; a locate-me zone finder; a 6-hour rain timeline; a nearest-relief finder that ranks filtration plants, relief camps and heat units by walking distance from your own zone; and source-traced explanation drawers for all four hazards — flood, air, heat, and waste/drainage.
- **Field Ops view** — a re-prioritizing dispatch queue for WASA/LWMC-style drain teams, driven by the same live rain forecast, with one-tap Google Maps navigation, persistent completion state, real blockage-tonnage/resident-impact estimates, and crew assignment: every drain can be assigned to a crew, each crew's open load is tracked against its per-shift capacity, and the nearest depot is suggested automatically.
- **City Overview** — the operator's all-hazard summary: flood/air/heat layer toggles on the zone map, city impact counters (zones at risk, critical drains, relief capacity), a 24-hour rain + AQI outlook, and a zone table that drills into the Citizen view.

## Why it matters

Lahore floods every monsoon at predictable "sore points" — streets WASA has documented as flooding after every intense spell (55 localities, 110 incidents, 2012–2017). The 2025 monsoon was record-breaking: ~355 mm in 24h on 5 Aug (heaviest since 1895), and 276 mm on 25 Jun (wettest June day on record). Drain-blocking waste (~0.84 kg/cap/day generated, only ~60% collected) makes the flooding worse. Nigran fuses the live forecast with these documented patterns so a citizen knows *before* the water arrives, and a field team knows *which drain to clear first*.

## Data & calibration

Every derived number in the app traces to a published source or a live feed — none are invented:

- **Live weather/air** — [Open-Meteo](https://open-meteo.com/) (6-hour precipitation, US AQI, temperature, humidity), fetched client-side every 10 minutes. A status pill in the header always shows whether data is **live**, **stale** (cached, older than 30 minutes), or **offline** (labeled "Snapshot mode") — with a retry action. There is no synthetic snapshot: with no live feed and no usable cache, values stay `null` and the UI says so, because a missing number is honest and a fabricated one is not. A network failure never reads as "no rain": the flood engine renormalizes to telemetry-only scoring and flags the missing input. The same rule governs the waste/drainage score — a zone with no mapped drain node drops its blockage and service-interval terms and renormalizes over what remains, rather than scoring as safe.
- **Rain risk bands** — design-storm intensities from Ahmad et al. 2024 (LPT-III design storms, calibrated SWMM, NSE 0.71–0.78), cross-checked against the 2025–2026 observed records above.
- **Sore points & waste** — WASA "sore point" incident record (paper 13) and Batool & Ch 2009 municipal solid-waste study (0.84 kg/cap/day, 60% collection, ~67% organics — the drain-clogging fraction). The waste/drainage card weights the zone's weakest drain (blockage 45%, drainage-capacity deficit 25%, service interval 15%, waste load 15%); drainage capacity per zone is a static calibrated parameter, drain fill levels are the simulated layer below.
- **Dispatch** — crew-to-task assignment formulated per Metson et al. 2021 (capacitated transportation problem, two-phase fix-and-resolve heuristic); we use the greedy priority-queue analogue, and the crew roster's per-shift capacity ceilings follow the same precedent. The crews themselves are a prototype model with no WASA/LWMC integration and are labelled as such in the UI.
- **Bin telemetry** — fill-level schema follows Sosunova & Porras 2022 (IEEE Access). Fill *rates* are not published in the literature (their own stated gap), so ours are simulated and labeled as such in the UI.

Full parameter inventory with inline citations lives in `src/data/calibration.js`.

## Stack

- React 19 + Vite 8 (Rolldown-powered)
- Tailwind CSS + a luxury editorial design system (light-only — white ground, slate ink, and a deep emerald `#009865` accent; no blue anywhere, and the fixed theme is itself E2E-tested)
- Leaflet + react-leaflet for the zone map
- No backend — pure client-side; deployable to any static host (Vercel config included)
- The three decorative WebGL/particle background layers (`three`, `ogl`) are code-split behind `React.lazy` + `Suspense` so they never delay first paint — the map, the risk engine and every data path work with all three disabled

## Run it

```bash
npm install
npm run dev      # local dev server
npm run build    # production build → dist/
npm run preview  # preview the production build
```

## Test it

```bash
npm test              # unit + component tests (Vitest, jsdom)
npm run test:watch    # watch mode
npm run test:e2e      # Playwright browser suite (builds + previews first)
npm run verify        # lint + test + build in one pass
```

Unit coverage includes the risk-engine weights and band boundaries, missing-data semantics (rain/air/heat/drain null contracts), the geospatial helpers behind nearest-asset ranking, the Asia/Karachi timestamp parsing, cache/fallback status transitions, and task-priority sorting. Component tests cover all four views with controlled props; E2E covers boot, theming, view round-trips, serviced-task persistence, Google Maps navigation, and offline snapshot mode (network aborted at the route level).

## Deploy

The repo includes `vercel.json` (SPA rewrite, immutable asset caching, security headers). Deploy with `vercel --prod` from this directory or connect the repo in the Vercel dashboard — no other configuration needed.

## Project structure

```
src/
  App.jsx                 # shell: header nav (Citizen / Field Ops / City Overview), shared risk state
  data/lahore.js          # zones, drain nodes, cool assets, center point
  data/calibration.js     # paper-calibrated parameters + citations
  data/crews.js           # prototype crew roster (modelled; no WASA/LWMC integration)
  data/telemetry.js       # time-driven drain fill model (simulated, calibrated; see disclaimer)
  hooks/useLahoreData.js  # live Open-Meteo fetch, TZ-safe parsing, live/stale/offline status machine
  hooks/useCityRisk.js    # derived risk state → scores, queue, air/heat/drain cards
  hooks/useLocalStorageState.js  # safe persisted UI state (view/zone/completions/assignments)
  lib/risk.js             # risk engine (flood/heat/air/drain/blockage/priority + why-explainers)
  lib/geo.js              # haversine, distance-ranked nearest-asset lookup, walk-time estimate
  components/CitizenView.jsx
  components/FieldOpsView.jsx
  components/CityOverviewView.jsx
  components/CityMap.jsx
  components/Timeline24h.jsx
  components/DataStatus.jsx
  components/RiskCard.jsx
  Galaxy.jsx              # WebGL starfield (decorative; WebGL-guarded)
  components/LiquidEther.jsx      # WebGL fluid background (decorative)
  components/CoutureSparkles.jsx  # mouse-parallax particle layer (decorative)
tests/
  unit/                   # engine + hooks (Vitest)
  component/              # views with controlled props (Testing Library)
  e2e/                    # browser flows incl. offline (Playwright)
```

Note: the workspace folder is named `raah` (an earlier working name); the product and package are **Nigran** (`nigran-lahore`).

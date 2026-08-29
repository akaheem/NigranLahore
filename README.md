# Raah — Know the safe Raah

Hyperlocal flood, air, heat, and drainage decision intelligence for Lahore. Raah turns live weather data and paper-calibrated urban parameters into a street-level answer to one question: *what should I do in the next six hours?*

Two surfaces:

- **Citizen view** — live rain, air (US AQI), temperature, humidity; a flood-risk map of Lahore's zones; a "What to do now" action list; a 6-hour rain timeline; and a source-traced explanation drawer.
- **Field Ops view** — a re-prioritizing dispatch queue for WASA/LWMC-style drain teams, driven by the same live rain forecast, plus the tonnage/residents protected by clearing the top three drains.

## Why it matters

Lahore floods every monsoon at predictable "sore points" — streets WASA has documented as flooding after every intense spell (55 localities, 110 incidents, 2012–2017). The 2025 monsoon was record-breaking: ~355 mm in 24h on 5 Aug (heaviest since 1895), and 276 mm on 25 Jun (wettest June day on record). Drain-blocking waste (~0.84 kg/cap/day generated, only ~60% collected) makes the flooding worse. Raah fuses the live forecast with these documented patterns so a citizen knows *before* the water arrives, and a field team knows *which drain to clear first*.

## Data & calibration

Every derived number in the app traces to a published source or a live feed — none are invented:

- **Live weather/air** — [Open-Meteo](https://open-meteo.com/) (6-hour precipitation, US AQI, temperature, humidity), fetched client-side with graceful offline fallback.
- **Rain risk bands** — design-storm intensities from Ahmad et al. 2024 (LPT-III design storms, calibrated SWMM, NSE 0.71–0.78), cross-checked against the 2025–2026 observed records above.
- **Sore points & waste** — WASA "sore point" incident record (paper 13) and Batool & Ch 2009 municipal solid-waste study (0.84 kg/cap/day, 60% collection, ~67% organics — the drain-clogging fraction).
- **Dispatch** — crew-to-task assignment formulated per Metson et al. 2021 (capacitated transportation problem, two-phase fix-and-resolve heuristic); we use the greedy priority-queue analogue.
- **Bin telemetry** — fill-level schema follows Sosunova & Porras 2022 (IEEE Access). Fill *rates* are not published in the literature (their own stated gap), so ours are simulated and labeled as such in the UI.

Full parameter inventory with inline citations lives in `src/data/calibration.js`.

## Stack

- React 19 + Vite 8 (Rolldown-powered)
- Tailwind CSS + a luxury editorial design system (dark/light themes)
- Leaflet + react-leaflet for the zone map
- No backend — pure client-side; deployable to any static host (Vercel, Netlify, GitHub Pages)

## Run it

```bash
npm install
npm run dev      # local dev server
npm run build    # production build → dist/
npm run preview  # preview the production build
```

## Project structure

```
src/
  App.jsx                # shell: header nav (Citizen / Field Ops), theme
  data/lahore.js         # zones, drain nodes, cool assets, center point
  data/calibration.js    # paper-calibrated parameters + citations
  hooks/useLahoreData.js # live Open-Meteo fetch with fallback
  hooks/useCityRisk.js   # derived risk state → scores, queue, actions
  lib/risk.js            # risk engine (flood/heat/air/blockage/priority)
  components/CitizenView.jsx
  components/FieldOpsView.jsx
  components/CityMap.jsx
  components/RiskCard.jsx
```

# Nigran — Watch over Lahore

Hyperlocal flood, air, heat, and drainage decision intelligence for Lahore. Nigran (نگران — "the guardian") turns live weather data and paper-calibrated urban parameters into a street-level answer to one question: *what should I do in the next six hours?*

Four surfaces:

- **Citizen view** — live rain, air (US AQI), temperature, humidity; a flood-risk map of Lahore's zones; a "What to do now" action list; a locate-me zone finder; a 6-hour rain timeline; a nearest-relief finder that ranks filtration plants, relief camps and heat units by walking distance from your own zone; and source-traced explanation drawers for all four hazards — flood, air, heat, and waste/drainage.
- **Field Ops view** — a re-prioritizing dispatch queue for WASA/LWMC-style drain teams, driven by the same live rain forecast, with one-tap Google Maps navigation, real blockage-tonnage/resident-impact estimates, and crew assignment: every drain can be assigned to a crew, each crew's open load is tracked against its per-shift capacity, and the nearest depot is suggested automatically. A **simulation clock** toggle switches the drain model between real time and a 1440× lapse (one real minute = one simulated day) so a calibrated refill — D-1 silting up at 11%/day — plays out while you watch, instead of over nine days. No rate is altered between the two modes: only the clock feeding them moves. Rain and air stay on the live feed and are explicitly *not* accelerated, and the header shows a time-lapse badge on every view while it is on, so accelerated numbers are never unexplained.
- **City Overview** — the operator's all-hazard summary: flood/air/heat layer toggles on the zone map, city impact counters (zones at risk, blocked drains, relief capacity), a 24-hour rain + AQI outlook, a zone table that drills into the Citizen view, and the complaint counts by zone.
- **Complaints** — the citizen board: report what is wrong on your street across nine everyday categories, attach up to three photographs, attach a short clip or link a longer one, and optionally pin it on the map to about 110 m. Reports carry a **lifecycle** — filed → acknowledged → in progress → resolved — where a resident says what they can see ("it's fixed", "still happening") and a crew claims the work, recorded as an event log rather than a flag. Anyone can back a neighbour's report with a one-tap "me too", and a device can remove what it filed. **Nothing on this board is verified and nothing on it touches a risk score** — it is the only user-generated content in the app, and it says so on its face.

### The drain service lifecycle

Servicing a drain is not a one-way checkbox. A cleared drain refills, becomes work again on its own, escalates, and eventually seizes up — and the count of how many times it has been cleared is kept as a record, not a flag:

| Fill | State | In the queue? |
|---|---|---|
| under 40% | Recently serviced | No — refilling, counting down |
| 40–79.99% | Due again | Yes |
| 80–94.99% | Critical | Yes, flagged critical |
| 95% | **Blocked — must service** | Yes, and the fill is **frozen at 95.00%** until someone clears it |

Servicing drops a drain to ~5% and the whole cycle runs again. Because fill is a pure function of elapsed time, the 95% freeze needs no latch: a neglected drain simply arrives at 95.00 and stops there, while every other drain keeps climbing on the same clock. A drain that has *never* been cleared is always an open task whatever its fill — its calibrated seed is its documented current condition, so there is nothing for it to wait for.

Service events are kept in the browser first and, when a shared log is configured, written to a small Postgres-backed service. Each event records when, which crew, the fill level at the time, and — if the clock was on the time-lapse — a `simulated` flag. **Simulated services are shown but never counted**: one afternoon of 1440× clicking must not be able to read as years of real maintenance. The counts shown are real services only, and the Field Ops header states plainly whether the history is shared or lives in this browser alone.

### The complaints board

Every other screen here is derived — a number computed from a published parameter or a live feed. The Complaints view is the one place where the *user* supplies the observation, and the whole design follows from that single difference.

- **Unverified, and kept out of the engine.** A complaint is one person's account of their own street. It is never an input to the flood, heat, air or drainage scores — it puts a count on the map and stops there, and the board, the map and the form all say so. The separation is structural, not just editorial: `src/data/complaints.js` is deliberately its own file, because nothing in `calibration.js` may be confused with something nobody checked.
- **Local first, shared when one exists.** Reports persist to IndexedDB (`src/lib/idb.js`), not localStorage: a complaint carries photo Blobs and can carry a clip, and localStorage holds strings in a ~5 MB origin-wide quota that one photograph would fill. A write that cannot reach the board is **kept and retried**, never dropped — the report genuinely exists, it is just not shared yet. With no backend configured the board is fully functional and says the reports live on this device only; with one, a freshly filed report is pushed immediately rather than waiting for the next minute's pull, because someone who has just filed is the most likely person to look for it. The retry queue is ordered so the slowest thing goes last: words and status moves go first, a 25 MB clip goes after them, and a clip that is refused on its merits is dropped with a reason on the card rather than retried forever.
- **Photos are re-encoded in the browser before they are sent.** Downscaling to a 1400 px WebP at quality 0.82 keeps a phone photo under 600 KB — and because the pixels are redrawn from scratch, the re-encode also drops the EXIF block, which on a phone photo carries GPS coordinates. Someone photographing a flooded street outside their own home should not be publishing their address with it, and they will never think to check.
- **Video: a link for anything long, a short clip attached directly.** The link is still the primary field and still the right answer for a 3-minute recording — 300 MB is not going onto a shared board from a phone on mobile data, and the copy says so before anyone discovers it at the upload bar. Beside it, a clip up to **25 MB** (roughly twenty seconds) can be attached and is sent after the report itself, so a slow or failed upload never costs someone the words they wrote. The host allowlist is matched on a dot boundary (so `notyoutube.com` fails while `m.youtube.com` passes), the protocol is checked (which is what refuses `javascript:` and `data:`, both of which `new URL()` parses happily), and the same check runs again on the server. An attached clip is validated by magic bytes on the server rather than by what the browser claimed it was — an iPhone calls its own `.mov` `video/quicktime` while the bytes are ISO-BMFF, so the client declines to label it and lets the sniffer decide.
- **The lifecycle is an event log, not a column.** `complaint_events` records from-status, to-status, who moved it, and when — the same discipline as `service_events`, and for the same reason: a mutable `status` column would keep the current state and lose the record of how it got there. The split between who may move what is the honesty core of the feature. A **crew** claims work (`filed → acknowledged → in-progress → resolved`); a **resident** claims observation (any state → resolved, "it's fixed"; `resolved → filed`, "still happening"). A citizen deliberately *cannot* acknowledge their own report, because that would put a resident's word in the shape of a municipal response. Every card names the actor and the time, a crew claim is labelled *(prototype model)* wherever it appears, and with no backend configured the whole lifecycle still works locally and says so.
- **A pin is opt-in, and rounded to about 110 m.** "Use my location" is a button, never automatic: someone reporting a blocked drain has not agreed to broadcast where they are standing. The fix is snapped to three decimal places (≈111 m north–south at Lahore's latitude, ≈95 m east–west) before it is shown to them, so the number they see is the number stored, and the server re-rounds whatever it is sent because it cannot know the client did. A report with a pin gets a pin plus a dashed accuracy ring and the word *approximate*; a report without one keeps its zone badge. The two are visually distinct on purpose — a precise-looking marker on a report whose location is "somewhere in Shahdara" would be a lie about precision.
- **"Me too" cannot be counted twice.** A composite primary key on `(complaint_id, device_id)` makes a duplicate impossible in the database rather than merely discouraged in the browser — a double-tap is a no-op and a script cannot inflate a count by clicking harder. The local bump is rolled back if the write fails, because a number that goes down on its own is worse than one that never moved.
- **Removing a report asks the server first.** On a shared board the delete is attempted *before* the local copy is swept. Removing it locally and having it return on the next pull would be the worst of both: the person believes it is gone and it comes back. Removal takes everything with it — the photos and the clip are swept from IndexedDB in the same operation, and `ON DELETE CASCADE` does the same for the server's copies.
- **No accounts, and the UI never implies otherwise.** A per-device id in localStorage is what lets a device remove what it filed. It is forgeable, it is not access control, and it is documented as such rather than dressed up as a login.

## Why it matters

Lahore floods every monsoon at predictable "sore points" — streets WASA has documented as flooding after every intense spell (55 localities, 110 incidents, 2012–2017). The 2025 monsoon was record-breaking: ~355 mm in 24h on 5 Aug (heaviest since 1895), and 276 mm on 25 Jun (wettest June day on record). Drain-blocking waste (~0.84 kg/cap/day generated, only ~60% collected) makes the flooding worse. Nigran fuses the live forecast with these documented patterns so a citizen knows *before* the water arrives, and a field team knows *which drain to clear first*.

## Data & calibration

Every derived number in the app traces to a published source, a live feed, or an explicit project choice — none are invented, and which is which is labelled where it appears. Four things fall outside a published source, each disclosed below and in the UI itself: the complaints board (a person's account of their own street — uncalibrated, and it feeds no score, which is why it is kept apart), the drain fill *rates* (the literature states this as a gap), the 40/80/95% service policy, and the crew roster.

- **Live weather/air** — [Open-Meteo](https://open-meteo.com/) (6-hour precipitation, US AQI, temperature, humidity), fetched client-side every 10 minutes. A status pill in the header always shows whether data is **live**, **stale** (cached, older than 30 minutes), or **offline** (labeled "Snapshot mode") — with a retry action. There is no synthetic snapshot: with no live feed and no usable cache, values stay `null` and the UI says so, because a missing number is honest and a fabricated one is not. A network failure never reads as "no rain": the flood engine renormalizes to telemetry-only scoring and flags the missing input. The same rule governs the waste/drainage score — a zone with no mapped drain node drops its blockage and service-interval terms and renormalizes over what remains, rather than scoring as safe.
- **Rain risk bands** — design-storm intensities from Ahmad et al. 2024 (LPT-III design storms, calibrated SWMM, NSE 0.71–0.78), cross-checked against the 2025–2026 observed records above.
- **Sore points & waste** — WASA "sore point" incident record (paper 13) and Batool & Ch 2009 municipal solid-waste study (0.84 kg/cap/day, 60% collection, ~67% organics — the drain-clogging fraction). The waste/drainage card weights the zone's weakest drain (blockage 45%, drainage-capacity deficit 25%, service interval 15%, waste load 15%); drainage capacity per zone is a static calibrated parameter, drain fill levels are the simulated layer below.
- **Dispatch** — crew-to-task assignment formulated per Metson et al. 2021 (capacitated transportation problem, two-phase fix-and-resolve heuristic); we use the greedy priority-queue analogue, and the crew roster's per-shift capacity ceilings follow the same precedent. The crews themselves are a prototype model with no WASA/LWMC integration and are labelled as such in the UI.
- **Bin telemetry** — fill-level schema follows Sosunova & Porras 2022 (IEEE Access). Fill *rates* are not published in the literature (their own stated gap), so ours are simulated and labeled as such in the UI.
- **Service policy (40 / 80 / 95%)** — **this project's operational policy, not a cited hydrological parameter.** No paper sets these thresholds; they are chosen so the lifecycle is legible and are labelled as project policy in the UI itself. The 40% re-open line sits deliberately below D-1's calibrated seed so the model has headroom to demonstrate a full cycle.

Full parameter inventory with inline citations lives in `src/data/calibration.js`.

## Stack

- React 19 + Vite 8 (Rolldown-powered)
- Tailwind CSS + a luxury editorial design system (light-only — white ground, slate ink, and a deep emerald `#009865` accent; no blue anywhere, and the fixed theme is itself E2E-tested)
- Leaflet + react-leaflet for the zone map
- **Client-first, with an optional backend.** The app, the risk engine, the drain model and the whole complaints board are client-side and deployable to any static host (Vercel config included). A small Express + Postgres service in `server/` exists for exactly two things — keeping the drain service record and the complaints board *shared* rather than per-browser. No feature depends on it: with `VITE_API_BASE_URL` unset the frontend never calls it and behaves exactly as it did before it existed, which is what makes that one variable the rollback switch. Local persistence is split by payload — localStorage for the service log (200-byte records), IndexedDB for complaints (photo Blobs and clips, which localStorage could not hold at all).
- The two heavy decorative layers — the WebGL starfield (`ogl`) and the WebGL fluid (`three`) — are code-split behind `React.lazy` + `Suspense` so they never delay first paint. (`CoutureSparkles` is a 2-D canvas layer with no heavy dependency, and stays in the main bundle.) The map, the risk engine and every data path work with all three disabled

## Run it

```bash
npm install
npm run dev      # local dev server
npm run build    # production build → dist/
npm run preview  # preview the production build
```

With no environment variables set the app runs local-only: service history and filed complaints are kept in the browser and nothing is sent anywhere. To point it at the shared service, set `VITE_API_BASE_URL` (and `VITE_DEMO_WRITE_TOKEN`) at build time. See `server/README.md`.

## Test it

```bash
npm test              # unit + component tests (Vitest, jsdom)
npm run test:watch    # watch mode
npm run test:e2e      # Playwright browser suite (builds + previews first)
npm run verify        # lint + test + build in one pass

cd server && npm test # backend write-path tests (node --test; no DB needed)
```

Unit coverage includes the risk-engine weights and band boundaries, missing-data semantics (rain/air/heat/drain null contracts), the geospatial helpers behind nearest-asset ranking, the Asia/Karachi timestamp parsing, cache/fallback status transitions, task-priority sorting, the four-band service lifecycle (every threshold from both sides, the 95% cap and freeze, the never-serviced-drain rule, and that simulated services stay out of the count), and the simulation clock — that time-lapse folds elapsed time at the old rate before the rate changes, that serviced timestamps never cross between the simulated and wall clocks, and that drain fill levels are numbers rounded to two decimals rather than formatted strings.

The complaints layer is covered on its own terms: the browser-side photo pipeline (`fitWithin` never scaling a photo *up*, an oversize result refused rather than truncated, the decoded bitmap released on every path), the video-link allowlist (that `javascript:` and `data:` are refused, and that a host merely *containing* an allowed name does not pass), the clip validator (an oversize file refused with the alternative in the message, and an iPhone `.mov` accepted without claiming a mime the server would disagree with), the coordinate rounding (three decimals, an already-rounded value left alone, `NaN` and `null` refused rather than snapped to `0,0`, and a pair outside Lahore dropped), the IndexedDB store against its in-memory fallback (photos kept in order, one complaint's range-sweep not touching another's, removal taking every photo *and the clip* with it), and the merge — that a complaint this device filed and the server also returned is **one** row, that the server's confirmation count wins while the device keeps the photo bytes, that a merge can never lower a count, that a complaint the server did not return is kept rather than dropped, and that a **status is merged on its timestamp** (the later `statusAt` wins, ties go to the server) rather than by the local-wins rule every other field uses. Component tests cover all four views with controlled props; Complaints view tests additionally pin the honesty line, the ownership rules, the status chip and the "who moved it" line, the location button, and the accessibility of the sort and lightbox controls; E2E covers boot, theming, view round-trips, recording a service, Google Maps navigation, the simulation clock (including that the queue row's fill level actually advances under time-lapse), a drain running to the 95% block and being cleared back into the cycle, filing a complaint and backing it, filing and then resolving one and seeing the reporter named with a time, pinning a report at a granted geolocation and seeing the card call it approximate and the stored latitude carry no more than three decimals, that a filed report survives a reload, and offline snapshot mode (network aborted at the route level). A second E2E spec runs at a phone viewport, below the `lg` breakpoint that every other browser test sits above: it pins the tagline out of the phone header, that all four views are reachable at 390px by an ordinary (non-forced) click, that each stays scrollable-into-view and uncovered at eight sampled widths from 320 to 1440, and that `main` reserves the navbar's measured height at each of them — plus the far side of the breakpoint, where the tagline comes back and the nav holds to a single row at 1024 and 1440, which is what caught the header doubling when the web font had not yet swapped in.

The backend suite covers the write-path decision logic for both features — that the token gate **fails closed** when unconfigured, that a wrong token is refused, that field validation and coercion keep a malformed caller out of SQL, that a video link is re-checked server-side, that only the device that filed a complaint may delete it, that the lifecycle table admits exactly the moves above and refuses a resident acknowledging their own report, that a clip's magic bytes decide its type (a PNG offered as a video is refused, and an `.mov` is stored as `video/mp4` because that is what its bytes are), that the base64 length pre-check rejects an oversize clip *before* decoding it, and that a Range header is parsed into the right 206/416 decision — a satisfiable range, a suffix range, one running past the end, and a start beyond it. The `Content-Length` the route then sets for a partial response, the range's own length rather than the file's, is response wiring rather than pure logic, and is exercised by the live-database script below rather than here. It also asserts the wiring that is easiest to regress: that the service route keeps the small body parser, that the 36 MB parser is mounted **only** on the video route, and that no JSON parser is mounted globally. The HTTP wiring and the SQL behind each route are what `npm run smoke`, below, drives against a live Postgres. That script has not been run against one in this repository: those paths are written and covered by the unit tests above, but they are **not** verified end-to-end against a database here.

```bash
cd server
docker compose up -d      # Postgres 16 on 5432
npm run start:local       # reads server/.env (copy .env.example)
npm run smoke             # asserts every route and the SQL behind it
```

## Deploy

Two targets, both optional-to-each-other.

**Frontend** — the repo includes `vercel.json` (SPA rewrite, immutable asset caching, security headers). Deploy with `vercel --prod` from this directory or connect the repo in the Vercel dashboard. Set `VITE_API_BASE_URL` and `VITE_DEMO_WRITE_TOKEN` to use the shared log; leave them unset and the deploy is local-only.

**Backend** (only if you want the shared service log and complaints board) — Render, root directory `server`, with a Render Postgres instance behind it. Full steps, environment variables, and verification commands are in `server/README.md`.

> **On the write token.** `VITE_DEMO_WRITE_TOKEN` ships inside the browser bundle. It is a **spam gate, not authentication** — it keeps a crawler from filling the table with junk; it does not and cannot stop anyone who opens devtools. Rate limiting, field validation and idempotent client ids are what actually bound the damage. The limits are set per payload rather than per route family: complaint writes are 6/minute rather than 30, because each one can carry megabytes of image data where a service event is a few hundred bytes; status moves ride the service ceiling, since they cannot carry image data at all; and clip uploads get their own **2/minute**, because a single one of those holds a 33 MB base64 string and a 25 MB buffer in memory at once. Confirming someone else's report deliberately needs no token at all — the composite primary key already caps a device at one confirmation per complaint, so the worst a spammer achieves is one row per device id. Writes of any kind fail **closed**: with `DEMO_WRITE_TOKEN` unset on the server, every write is refused rather than every write allowed.

Roll order for a live site: provision and verify the backend first, then run the frontend against a **deliberately stopped** backend to confirm it degrades to local-only without a crash, and only then point Vercel at it.

## Project structure

```
src/
  App.jsx                 # shell: header nav (Citizen / Field Ops / City Overview / Complaints)
  data/lahore.js          # zones, drain nodes, cool assets, center point
  data/calibration.js     # paper-calibrated parameters + citations
  data/crews.js           # prototype crew roster (modelled; no WASA/LWMC integration)
  data/telemetry.js       # time-driven drain fill model (simulated, calibrated; see disclaimer)
  data/complaints.js      # complaint categories, statuses, transitions, limits — deliberately NOT calibrated data
  hooks/useLahoreData.js  # live Open-Meteo fetch, TZ-safe parsing, live/stale/offline status machine
  hooks/useCityRisk.js    # derived risk state → scores, queue, air/heat/drain cards
  hooks/useServiceLog.js  # drain service log: local-first, optional shared sync, idempotent events
  hooks/useComplaints.js  # complaints board: IndexedDB-first, status events, clips, merge/sort/filter/count, me-too, delete
  hooks/useLocalStorageState.js  # safe persisted UI state (view/zone/assignments)
  lib/risk.js             # risk engine (flood/heat/air/drain/blockage/priority + why-explainers)
  lib/geo.js              # haversine, distance-ranked nearest-asset lookup, walk-time estimate, coordinate rounding
  lib/idb.js              # IndexedDB store for complaints + photo blobs + clips; in-memory fallback
  lib/complaintMedia.js   # photo downscale/re-encode (drops EXIF), video-host allowlist, clip validation, base64
  lib/relativeTime.js     # "3 hours ago" / exact date past a month
  components/CitizenView.jsx
  components/FieldOpsView.jsx
  components/FieldReportsPanel.jsx  # advisory: citizen reports in a crew's zones (reads the queue, never writes it)
  components/CityOverviewView.jsx
  components/ComplaintsView.jsx
  components/ComplaintCard.jsx
  components/MediaLightbox.jsx
  components/CityMap.jsx
  components/Timeline24h.jsx
  components/DataStatus.jsx
  components/RiskCard.jsx
  Galaxy.jsx              # WebGL starfield (decorative; WebGL-guarded)
  components/LiquidEther.jsx      # WebGL fluid background (decorative)
  components/CoutureSparkles.jsx  # mouse-parallax particle layer (decorative)
server/                   # optional shared backend (Express + Postgres); see server/README.md
  docker-compose.yml      # Postgres 16 for local work; `docker compose down -v` is the reset
  .env.example            # DATABASE_URL, DEMO_WRITE_TOKEN, ALLOWED_ORIGINS, PORT
  scripts/smoke.mjs       # asserts every route and the SQL behind it against a live database
  src/index.js            # routes, CORS, rate limiting, token gate, per-route body parsers
  src/validate.js         # pure write-path decision logic (tested without a DB)
  src/db.js               # pg pool + queries; simulated rows excluded from the count
  src/schema.sql          # service_events, complaints, complaint_photos, complaint_confirmations,
                          # complaint_events, video_uploads (+ the alter-table lines that migrate them)
tests/
  unit/                   # engine + hooks (Vitest)
  component/              # views with controlled props (Testing Library)
  e2e/                    # browser flows incl. offline (Playwright)
scripts/
  capture-ui.mjs          # screenshots the four views at 1440, and two of them at 390,
                          # into screenshots/ (generated output, not committed)
```

Note: the workspace folder is named `raah` (an earlier working name); the product and package are **Nigran** (`nigran-lahore`).

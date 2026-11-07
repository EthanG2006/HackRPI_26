# Rx Radar team contracts

Read `docs/SPEC.md` (the full product spec) first. This file says who owns what, the shapes we exchange,
and the conventions that keep seven parallel workstreams from colliding.

## Repo layout

```
package.json            root scripts: npm run setup | dev | demo | pipeline
scripts/run.mjs         cross-platform launcher (Windows first)
web/                    Vite + React 19 + TS 7 + Tailwind 4 + deck.gl 9.4 + MapLibre 5
  public/data/          ALL JSON the app reads (written by the Python pipeline). Shapes: web/src/types.ts
  src/types.ts          THE data contracts (TypeScript). Python must emit these exact shapes (camelCase).
  src/store.ts          zustand store (shared). Add fields additively; never rename.
  src/App.tsx           layout shell, one region per owner
  src/data/load.ts      loads public/data into the store; tolerant of missing files
  src/lib/              colors.ts (risk ramp), format.ts, clock.ts (replay clock + alert trigger)
  src/ui/Prov.tsx       provenance badge — use it next to every number and layer
server/                 FastAPI (python -m uvicorn server.main:app --port 8000). Routers are optional imports.
pipeline/               offline data + ML pipeline (python -m pipeline.run_all)
data/raw/               downloads (gitignored)   data/processed/ parquet + intermediate json   data/curated/ hand-verified json
docs/                   SPEC.md, CONTRACTS.md, architecture.svg
```

Python: `.venv` at repo root (Python 3.12). Run Python as `.venv\Scripts\python.exe` (Windows). Installed: fastapi, uvicorn,
numpy, scipy, pandas, pyarrow, scikit-learn, lightgbm, shap, networkx, rapidfuzz, shapely, pyshp, geopandas, pyogrio,
openpyxl, requests, httpx, pillow, tqdm, anthropic, python-dotenv. Run pipeline scripts from the repo root as modules,
e.g. `.venv\Scripts\python.exe -m pipeline.fetch.hospitals`, so `pipeline/` and `server/` imports work.

Web deps installed: deck.gl 9.4 (@deck.gl/core, layers, geo-layers, aggregation-layers, extensions, react, mapbox),
maplibre-gl 5, react-map-gl 8, pmtiles 4, three 0.187, zustand 5, framer-motion, cmdk, lucide-react, d3-scale/shape/array/geo,
topojson-client + us-atlas (county/state TopoJSON), jspdf, html-to-image, @fontsource-variable/inter + jetbrains-mono.

## Ownership (one owner per file; others only make small additive edits and re-read before editing)

| Workstream | Owns |
|---|---|
| **facts** (research + verification) | `data/curated/*.json`, `web/public/data/sources.json`, `facts.json`, `trends.json`, `web/public/data/events/*.json` |
| **geo** (geo + weather data) | `pipeline/fetch/*` (except openFDA/NADAC), `web/public/data/hospitals.json`, `counties.json`, `storms/*.json`, `radar/**`, `satellite/**`, `live_cache.json`, `server/live.py` |
| **risk** (supply network + shortage model) | `pipeline/fda/*`, `pipeline/ml/network*.py`, `pipeline/ml/risk_model.py`, `web/public/data/plants.json`, `drugs.json`, `distributors.json`, `network.json`, `model/risk_model.json` |
| **sim** (hazard, ensemble, cascade, scenarios, what-if) | `server/sim/*`, `pipeline/ml/hazard*.py`, `pipeline/sim/*`, `web/public/data/scenarios/*.json`, `model/hazard_model.json`, `web/src/sim/*` (browser fallback engine) |
| **equity** (hoarding ABM, allocation LP, frontier, equity UI) | `server/equity/*`, `pipeline/equity/*`, `web/public/data/equity/*.json`, `web/src/equity/*` |
| **map** (visuals) | `web/src/map/*`, `web/src/intro/*`, `web/public/basemap/**`, `web/public/textures/**` |
| **panels** (right panel: drug list, drug detail, hospital drill-down, actions, money, briefing PDF, gauge chart card) | `web/src/panels/RightPanel.tsx`, `web/src/panels/drug/*`, `web/src/panels/hospital/*`, `web/src/panels/GaugeCard.tsx`, `web/src/briefing/*`, `web/src/ui/charts/*` |
| **chrome** (top bar, timeline, alert toast + sound, impact counters, pages, presenter mode, command palette) | `web/src/panels/TopBar.tsx`, `AlertToast.tsx`, `ImpactCounters.tsx`, `web/src/timeline/*`, `web/src/pages/*`, `web/src/presenter/*`, `web/src/lib/clock.ts`, `web/src/lib/sound.ts`, `web/src/ui/*` (shared primitives other than Prov.tsx and charts/) |
| **copilot** | `server/copilot/*`, `web/src/copilot/*` |
| **lead** (integration) | `web/src/App.tsx`, `store.ts`, `types.ts`, `data/load.ts`, `server/main.py`, `scripts/*`, root docs |

Shared files (`store.ts`, `types.ts`, `App.tsx`, `server/main.py`): small additive edits only, re-read right before editing,
and mention every edit in your final report.

## Hard rules

1. **Never break the build for others.** Before you finish (and after big edits) run `npm --prefix web run typecheck`.
   A half-built component must still compile and render something sensible (or `null`).
2. **Never block on data.** If a source fails, write a realistic stand-in with the same shape, tag it `SIMULATED`,
   add a `sources.json`-style note (status `stand-in`) in your report, and move on.
3. **Every number shown carries provenance** (`REAL | REPLAY | MODEL | SIMULATED`). In JSON via `provenance`/`sourceIds`;
   in UI via `<Prov kind=… sourceIds=… />` from `web/src/ui/Prov.tsx`.
4. **No wrong facts.** Real-world claims and dates must be verified with a web source and cited by `sources.json` id.
5. **Offline-first.** The finished demo runs with no internet. Anything fetched at runtime has a cached file fallback in `web/public/data/`.
6. **Don't run `npm install` or `pip install`** unless you truly need a missing package; if you do, install a pinned version and
   say so in your report. Don't change versions of existing packages.
7. **Don't commit or push.** The lead commits at milestones.
8. **Don't start or stop the shared dev servers.** Web: http://localhost:5173 (Vite, hot reload). API: http://127.0.0.1:8000
   (uvicorn --reload, watches `server/`). If you need a browser, open your own tab in the built-in browser and close it when done.
9. Keep files focused (< ~400 lines); comments explain *why*, not *what*.

## Data conventions

- Times: ISO-8601 UTC strings (`2024-09-27T12:00:00Z`). The replay clock is `store.time` (ms epoch).
- Per-hospital arrays (`hospitalStockouts`, `inventoryDoh`, equity `coverage`/`stockoutDay`) are **aligned with the order of
  `hospitals.json`**. Use `store.hospitalIndex` (id → index). `999` = no stockout within the 90-day horizon.
- Day indexes count from the scenario's `day0`. Supply curves have 90 entries (days 0–89), as fractions of normal US supply.
- Coordinates: `[lon, lat]`. Polygons are GeoJSON coordinate arrays.
- Probabilities are 0..1; intervals are 80% unless the field says otherwise.
- JSON keys camelCase; ids kebab-case.

## Canonical ids (use these exact ids everywhere; the facts workstream may ADD ids, never rename)

### Drugs
| id | display name |
|---|---|
| `sodium-chloride-0-9-iv` | 0.9% Sodium Chloride Injection (IV bags) |
| `sodium-chloride-minibag` | 0.9% Sodium Chloride small-volume bags (50–100 mL) |
| `lactated-ringers-iv` | Lactated Ringer's Injection |
| `dextrose-5-iv` | 5% Dextrose Injection |
| `dextrose-50-inj` | 50% Dextrose Injection |
| `sterile-water-inj` | Sterile Water for Injection |
| `peritoneal-dialysis-solution` | Peritoneal Dialysis Solution |
| `sodium-bicarbonate-inj` | Sodium Bicarbonate Injection |
| `potassium-chloride-inj` | Potassium Chloride Injection |
| `magnesium-sulfate-inj` | Magnesium Sulfate Injection |
| `calcium-gluconate-inj` | Calcium Gluconate Injection |
| `cisplatin-inj` | Cisplatin Injection |
| `carboplatin-inj` | Carboplatin Injection |
| `methotrexate-inj` | Methotrexate Injection |
| `fluorouracil-inj` | Fluorouracil Injection |
| `vincristine-inj` | Vincristine Sulfate Injection |
| `cytarabine-inj` | Cytarabine Injection |
| `heparin-inj` | Heparin Sodium Injection |
| `epinephrine-inj` | Epinephrine Injection |
| `norepinephrine-inj` | Norepinephrine Injection |
| `vasopressin-inj` | Vasopressin Injection |
| `atropine-inj` | Atropine Sulfate Injection |
| `amiodarone-inj` | Amiodarone Injection |
| `lidocaine-inj` | Lidocaine HCl Injection |
| `bupivacaine-inj` | Bupivacaine HCl Injection |
| `ondansetron-inj` | Ondansetron Injection |
| `morphine-inj` | Morphine Sulfate Injection |
| `hydromorphone-inj` | Hydromorphone Injection |
| `fentanyl-inj` | Fentanyl Citrate Injection |
| `midazolam-inj` | Midazolam Injection |
| `ketamine-inj` | Ketamine Injection |
| `dexamethasone-inj` | Dexamethasone Sodium Phosphate Injection |
| `furosemide-inj` | Furosemide Injection |
| `naloxone-inj` | Naloxone Injection |
| `cefazolin-inj` | Cefazolin Injection |
| `vancomycin-inj` | Vancomycin Injection |
| `penicillin-g-benzathine-inj` | Penicillin G Benzathine Injectable Suspension |
| `albuterol-inhalation` | Albuterol Sulfate Inhalation Solution |
| `amoxicillin-oral-susp` | Amoxicillin Oral Suspension |

### Key plants (more may be added by facts/risk with the pattern `<company>-<city>[-pr]`)
| id | plant |
|---|---|
| `baxter-north-cove` | Baxter North Cove, Marion NC (IV solutions, PD solutions) — Helene |
| `pfizer-rocky-mount` | Pfizer (Hospira) Rocky Mount NC (sterile injectables) — 2023 tornado |
| `baxter-*-pr` | Baxter Puerto Rico plants (small-volume parenterals) — Maria; ids per city, e.g. `baxter-jayuya-pr` |
| `b-braun-irvine` / `b-braun-daytona-beach` | B. Braun IV solutions plants |
| `icu-medical-austin` | ICU Medical Austin TX (IV solutions) |

### Scenarios
`helene` (hero), `rocky-mount`, `maria`, `live`, `whatif`. Replay windows (UTC) — facts may refine:
- helene: start `2024-09-23T21:00:00Z` (first advisory, PTC Nine) → end `2024-10-12T00:00:00Z`; day0 = plant failure day.
- rocky-mount: start `2023-07-19T12:00:00Z` → end `2023-08-31T00:00:00Z`.
- maria: start `2017-09-16T21:00:00Z` → end `2017-10-31T00:00:00Z`.

## UI conventions

- Layout at 1920×1080: top bar 56 px; left legend 264 px; right panel 440 px; bottom timeline 132 px. Map is full-bleed underneath.
- Colors: tokens in `web/src/index.css` (`bg-ink-*`, `text-fg`, `text-fg-2`, `text-fg-3`, `text-storm`). Weather = storm cyan.
  Risk = `riskColor()/riskCss()` from `web/src/lib/colors.ts` (cool → amber → red), with `daysToRisk(days)` for stockout days.
  No purple, no gradients-as-decoration, no glassmorphism. Panels use the `.panel` class (solid).
- Type: Inter for UI; every figure uses `className="num"` (JetBrains Mono, tabular). Minimum 13 px text; body 15–16 px;
  hero numbers ≥ 28 px. High contrast for a projector.
- Motion with a purpose only (fly-tos, flow along arcs, shockwave, counters). Target 60 fps on Intel integrated graphics:
  keep particle counts modest and avoid re-creating deck.gl layers' data arrays every frame (use `updateTriggers`).
- Read state with selectors (`useApp(s => s.x)`), not the whole store. For per-frame animation use refs + rAF, not React state.
- The active scenario (replay or what-if) comes from `useActiveScenario()` in `store.ts`.
- Camera moves: `useApp.getState().flyTo({ longitude, latitude, zoom, pitch, bearing, duration })`.
- Alert: `fireAlert()` sets `alertFiredAt` + `shockwaveAt` (performance.now() ms). The clock fires it when the replay crosses `scenario.alert.t`.

## Cross-team hooks (already in store.ts / lib/selectors.ts)

- Hospital colors everywhere come from `hospitalDays(state)` in `web/src/lib/selectors.ts` (P50 stockout day per hospital,
  aligned with `hospitals`). In the equity lab (`equityOpen`) it returns the selected policy's outcome via `equityResult()`.
  Map, panels and equity must use these so the map and the numbers always agree.
- Command fields (set them to trigger another team's component; the owner watches and acts):
  - `copilotAsk: { text, at }` → copilot drawer opens and asks (presenter beat 7).
  - `whatifRunAt` → map's WhatIfPanel runs the ensemble with `whatif` state (presenter beat 6, copilot `run_storm`).
  - `briefingFor: { hospitalId, at }` → panels generate the CMO briefing PDF (copilot `generate_briefing`).
  - `equityAutoplayAt` → equity lab starts the hoarding animation (presenter beat 5).
- Browser what-if fallback contract (sim owns): `web/src/sim/whatif.ts` exports
  `runWhatIfInBrowser(req: WhatIfRequest): Promise<WhatIfResult>` (reads plants/drugs/hospitals from `useApp.getState()`).
- Camera presets (map owns): `web/src/map/cameras.ts` exports named `Camera` constants (e.g. `US_EAST`, `NORTH_COVE`,
  `CAPITAL_REGION`, `GULF`, `PUERTO_RICO`, `ROCKY_MOUNT`, `SOUTHEAST`). Presenter beats import them.
- Presenter beats (chrome owns): `web/src/presenter/beats.ts`. Beat 1 title/intro · 2 Helene replay · 3 alert ·
  4 local hospital (Samaritan Hospital, Troy NY / Albany Medical Center) · 5 equity lab · 6 what-if storm · 7 copilot · 8 impact close.

## API (FastAPI, all under /api; every call has a frontend fallback)

| Method | Path | Owner | Body → Response |
|---|---|---|---|
| GET | `/api/health` | lead | `{ ok, anthropic, routers }` |
| POST | `/api/whatif` | sim | `WhatIfRequest` → `WhatIfResult` (< 1 s) |
| POST | `/api/allocate` | equity | `{ scenarioId, drugId, policy, lambda }` → `PolicyResult` (< 300 ms) |
| POST | `/api/copilot` | copilot | `{ messages }` → `text/event-stream` |
| GET | `/api/live` | geo | → `LiveSnapshot` (falls back to cached snapshot) |

Router modules: `server/sim/api.py`, `server/equity/api.py`, `server/copilot/api.py`, `server/live.py`, each exposing
`router = APIRouter()`. `server/main.py` mounts them with prefix `/api` and survives import failures.
Python reads the same JSON the frontend reads from `web/public/data/` (`server.main.DATA`).

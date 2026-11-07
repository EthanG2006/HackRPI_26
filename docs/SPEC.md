# Rx Radar: Build Prompt (original spec, verbatim)

You are building Rx Radar for HackRPI 2026. The hackathon theme is the sky and the clouds. We are competing for Best Healthcare, Best Sustainability, Ethical AI, and ML/Data Science. Build the most impressive version you can, not a minimal one. Optimize for one outcome: a judge watching a 3-minute demo thinks "a hospital would buy this tomorrow, and it's technically deep."

Work fast. Use subagents in parallel (data pipeline, ML, map/visuals, UI panels). Keep the app demoable at every milestone.

## 1. One-line pitch
Rx Radar watches the sky for storms that will knock out drug factories. It predicts which medicines will run short and which hospitals will run out first, then allocates the remaining supply fairly, days before the shortage hits.

Tagline for the title screen: "The sky already caused some of the worst drug shortages of the decade. Nobody is watching it."

## 2. Why it matters (verify every fact with web search, then cite it in the in-app Sources panel)
- Hurricane Helene (Sept 2024) flooded Baxter's North Cove plant in Marion, NC. The plant made roughly 60% of US IV fluids, and hospitals rationed IV bags nationwide for months.
- Tornado (July 19, 2023) hit Pfizer's Rocky Mount, NC plant, a major source of US hospital sterile injectables.
- Hurricane Maria (Sept 2017) hit drug plants in Puerto Rico and caused a national IV bag shortage.
- ASHP counted a record of about 323 active US drug shortages in 2024.
- Vizient (2019) estimated that managing shortages costs US hospitals about $359M a year in staff time.
- Hospitals usually learn about a shortage when an order fails.

If a fact doesn't hold up, fix or drop it. Don't ship a wrong number.

## 3. The 3-minute demo (build the app around this script)
| Time | Beat | What's on screen |
|---|---|---|
| 0:00 | Cinematic open | A dark globe seen from space, with slowly swirling cloud cover. The title fades in. The camera dives toward the Atlantic as Helene forms. |
| 0:20 | Helene replay | The timeline auto-plays from Sept 23, 2024. The forecast cone grows advisory by advisory. Historical radar sweeps in and wind particles spiral around the eye. Drug plants pulse on the map. The Weather Prediction Center's "High Risk" excessive-rainfall area appears over western NC. A live chart from the USGS river gauge nearest the North Cove plant starts rising. |
| 0:50 | The alert | Rx Radar fires an alert hours before the plant floods, using only forecasts issued before that moment (show an "information cutoff" timestamp). A phone-style push notification slides in: "Pharmacy Director alert." A shockwave ripples out from the plant through the supply network. Arcs to thousands of hospitals turn amber, then red. IV fluids and peritoneal dialysis solution jump to the top of the at-risk list. |
| 1:20 | Local hospital | Click Samaritan Hospital (Troy, NY) or Albany Medical Center to bring it home for RPI judges. Show days-of-supply gauges, a predicted stockout date with an uncertainty band, recommended actions, and dollars saved by acting now. |
| 1:50 | Equity lab | Run the hoarding simulation. Under "Market" allocation, big systems over-order and rural, high-vulnerability hospitals stock out; Appalachia and the Mississippi Delta go red. Switch to "Rx Radar fair allocation" and the map evens out. Drag along a curve that trades delivery efficiency against equity. |
| 2:20 | What-if storm | A judge draws any storm track on the map (for example, a Category 4 into Puerto Rico or the Gulf Coast). A 1,000-track Monte Carlo simulation runs live and results appear in under 1 second. |
| 2:40 | Copilot | A judge asks out loud: "Which children's hospitals in the Southeast run out of IV fluids first?" The map flies there and highlights them while the answer streams in with citations. |
| 2:55 | Impact close | Counters animate: patients protected, dollars saved, tons of CO₂ avoided, and the share of stockouts prevented in high-vulnerability counties. |

## 4. Feature spec

### 4.1 Cinematic intro
- Start on a globe with a slow auto-rotation, a subtle atmosphere glow, and an animated cloud layer (shader noise or tiled cloud imagery).
- Press Space or click "Begin" to fly the camera smoothly down to the US East Coast.
- Skip it instantly on any keypress after the first view.

### 4.2 Main map and layers (toggle each layer from a legend)
- Storms: forecast cones for each advisory, extruded slightly in 3D and lit from within. Draw the best track as a glowing path. Animate the eye with a rotating cloud spiral.
- Wind: a GPU particle field around the storm. Generate it from a Holland (1980) parametric wind model driven by the storm's real best-track data (HURDAT2: position, max wind, pressure, radius of max wind). This is real meteorology at low cost.
- Radar: historical NEXRAD composite radar tiles from the Iowa Environmental Mesonet, matched to the replay timestamp. Use RainViewer or an equivalent free source for live mode.
- Rainfall and flooding: WPC excessive-rainfall outlooks, FEMA flood zones near each plant, and USGS river gauge readings near each plant.
- Tornadoes: SPC outlooks and the tornado's damage-survey track (needed for the Rocky Mount replay).
- Drug plants: pulsing markers sized by share of national supply and colored by disruption probability.
- Supply network: animated arcs from plants to distributor warehouses to hospitals, with particles flowing along them. When a plant goes down, the flow drains along the arcs with realistic delays (inventory buffers). Bundle or cluster edges by zoom level so it never turns into spaghetti.
- Hospitals: about 6,000 US hospitals, colored by days until stockout. Use a heatmap or hex bins at national zoom and individual points when zoomed in.
- Vulnerability: CDC Social Vulnerability Index by county as an optional choropleth.
- Climate exposure: FEMA National Risk Index by county (hurricane, riverine flooding, tornado scores).

### 4.3 Timeline and scenarios
A bottom timeline styled like a video editor. Include play/pause, 1×–64× speed, scrubbing, and event pins: forecast advisories, landfall, the plant flooding, FDA shortage listing, and allocation announcements. Verify every date.

Scenario switcher:
- Helene 2024, the hero replay. North Cove plant, IV fluids and peritoneal dialysis solution.
- Rocky Mount tornado 2023, showing how a single tornado track cut supply of many injectables.
- Maria 2017, Puerto Rico plants and the IV bag shortage.
- LIVE: current National Hurricane Center storms, NWS alerts and SPC outlooks pulled right now. If no storm is active, show the highest-risk weather in the US today and say so.
- What-if storm builder: draw a track, set category and forward speed, and run.
- Every scenario recomputes risk, the cascade through the supply network, allocation and impact.

### 4.4 Drug risk panel (right side)
A ranked list of drugs at risk. Each row has: drug name, risk score with a confidence interval, a 90-day projected supply sparkline with an uncertainty band, a criticality badge (WHO Essential Medicine, no therapeutic alternative, pediatric), and the number of hospitals projected to stock out.

Click a drug to open:
- Explainability: a SHAP waterfall chart of what drives this drug's risk score, e.g. "+0.31 one plant makes ~60% of supply; +0.22 plant is inside the WPC High Risk rainfall zone; +0.12 sterile injectable; −0.05 three alternative manufacturers."
- Supply graph: a mini network diagram of its plants, labelers and distributors, with a confidence score on each link.
- Alternatives: therapeutic substitutes and conservation strategies from ASHP guidance, such as switching to oral hydration where safe, giving drugs by IV push instead of IV piggyback, or using smaller bag sizes.

### 4.5 Hospital drill-down
- Header: name, bed count, type (rural, safety-net, children's), and the county's social vulnerability.
- Days-of-supply gauges for each at-risk drug, with a projected stockout date and 80% uncertainty band.
- Recommended actions, each with a one-line reason: order quantity (capped by fair share), substitutions to prepare, procedures to reschedule, and a nearby hospital with surplus.
- Money panel: cost of buying now at contract price vs. paying gray-market markups during the shortage, plus staff hours saved.
- "Generate CMO briefing": one click produces a polished one-page PDF memo with a map snapshot, the risks, the actions and the sources.

### 4.6 Equity and allocation lab (the Ethical AI centerpiece)
- Hoarding simulation (agent-based): each hospital is an agent with an ordering policy. Larger systems react to early warnings by over-ordering, and the "bullwhip effect" amplifies the shortage downstream. Animate it on the map over simulated days.
- Allocation policies, compared side by side:
  - Market: first-come, first-served, weighted by purchasing power (status quo).
  - Proportional: allocated by patient volume.
  - Rx Radar: a linear program that maximizes need-weighted coverage, with equity constraints using social vulnerability, rural status, safety-net status and pediatric patients.
- Metrics for each policy: % of hospitals stocked out, stockouts in high-vulnerability counties, patients with delayed care, a Gini coefficient of supply, and total cost.
- Efficiency vs. equity curve: a slider moves along the optimal trade-off curve between efficiency and equity, and the map updates live.
- Simultaneous disclosure: every hospital gets the alert at the same moment, with an order cap at its fair share. Explain on screen why: early warnings delivered unequally cause hoarding.

### 4.7 Model card and Sources
- Model card page: intended use, out-of-scope uses (never makes patient-level rationing decisions), training data, validation, backtests, calibration plot, known limitations, and a breakdown of performance by hospital type and region.
- Sources page: every dataset with link, retrieval date and license.
- Provenance badges on every number and layer: REAL, REPLAY, MODEL ESTIMATE or SIMULATED. This is a feature, not a disclaimer. Make it look designed.
- Human in the loop: recommended actions need a pharmacist's "Approve" click. The approval and its reason go into an audit log.

### 4.8 AI copilot ("Ask Rx Radar")
- A slide-out panel. Accept typed questions and push-to-talk voice (Web Speech API).
- Call the Anthropic API with streaming and tool use (use claude-sonnet-5-5 for speed; confirm the current model IDs with the claude-api skill). Read the key from the ANTHROPIC_API_KEY environment variable.
- Tools the copilot can call, and the UI reacts to each one: fly_to(place), highlight_hospitals(filter), query_drug_risk(drug, region), run_storm(track, category), set_allocation_policy(policy), open_hospital(id), generate_briefing(hospital_id)
- Answers cite the data they used. The copilot refuses to make patient-level rationing calls and points to the allocation framework instead.
- Demo-proof fallback: if there's no API key or no internet, scripted demo questions return cached streaming answers that run the same tool calls.

### 4.9 Impact counters (always visible, animated)
- Patients protected from delayed care
- Dollars saved (contract vs. gray-market prices, staff hours, cancelled procedures avoided)
- Tons of CO₂ avoided: planned ground shipments vs. emergency air freight, plus stockpiled drugs that would otherwise expire and be thrown away
- Share of stockouts prevented in high-vulnerability counties
- Each counter opens a breakdown that shows its assumptions.

### 4.10 Presenter mode
- Number keys 1–8 jump to each demo beat with the camera, layers and panels preset.
- → advances to the next beat. R resets to the title screen.
- ⌘K / Ctrl+K opens a command palette for any action.
- A hidden presenter-notes overlay shows the talking points for the current beat.

## 5. Data sources (real data wherever it exists)
| Need | Source |
|---|---|
| Drug shortages (history and current) | FDA Drug Shortages database (check for an openFDA shortages endpoint), ASHP shortage list |
| Drug products and labelers | openFDA NDC directory |
| Label text ("Manufactured by…", "Made in…") | openFDA drug label API |
| Manufacturing sites | FDA Drug Establishments Current Registration list (addresses, FEI numbers) |
| Plant compliance history | FDA inspection and compliance data, openFDA enforcement (recalls) |
| Prices | Medicaid NADAC (data.medicaid.gov) |
| Hospitals | CMS Hospital General Information, HIFLD Hospitals dataset (locations, beds, type) |
| Vulnerability | CDC/ATSDR Social Vulnerability Index |
| Climate risk | FEMA National Risk Index, NOAA Billion-Dollar Disasters dataset |
| Storms | NHC GIS archive (forecast cones, wind speed probabilities for Helene AL092024 and Maria AL152017; verify the IDs), HURDAT2 best tracks |
| Rain and flooding | WPC excessive-rainfall outlook archive, FEMA National Flood Hazard Layer, USGS water data (river gauges) |
| Tornadoes | SPC storm reports and outlooks, NWS Damage Assessment Toolkit tracks |
| Radar | Iowa Environmental Mesonet historical NEXRAD tiles; RainViewer for live mode |
| Live alerts | api.weather.gov alerts, NHC active-storms feed |
| Essential medicines | WHO Model List of Essential Medicines |

Drug set: about 40 drugs that are critical and often short, e.g. 0.9% sodium chloride, lactated Ringer's, dextrose, peritoneal dialysis solutions, cisplatin, carboplatin, methotrexate, heparin, epinephrine, lidocaine, bupivacaine, ondansetron injection, morphine injection, vasopressin, albuterol, amoxicillin oral suspension, plus the products affected at Rocky Mount (look these up).

Rule: never block on a data source. If one fails, generate a realistic stand-in with the same shape, tag it SIMULATED, and move on.

## 6. ML and data science pipeline
- Supply-network extraction (NLP + entity resolution). Use Claude with structured output to pull manufacturer, site and country out of label text. Match the results to FDA registration records with fuzzy matching (rapidfuzz) on name and address. Each drug → plant link gets a confidence score. Output a NetworkX graph of drug → labeler → plant → distributor → hospital.
- Baseline shortage-risk model. A LightGBM model on drug-level features: number of manufacturers, market concentration (HHI), sterile injectable or not, dosage form, NADAC price and price trend, share of supply from foreign sources, past shortage count, recent recalls or warning letters at its plants. Labels come from the FDA's historical shortages. Validate on a time-based split. Report ROC and precision-recall AUC and a calibration plot, explain predictions with SHAP, and report the real metrics you get.
- Weather hazard model. Estimate each plant's probability of disruption from NHC wind speed probabilities, WPC rainfall outlook category, flood zone, distance to the nearest river and elevation, and SPC tornado probability. Use a Bayesian logistic model with expert-informed priors, because historical events are rare. Show the posterior uncertainty.
- Storm ensemble. Sample 1,000 plausible tracks inside each forecast cone (perturbing along-track and cross-track error with NHC's published typical forecast errors). The result is a distribution of plant outages, not a single guess. Vectorize with NumPy so a what-if run finishes in under 1 second.
- Cascade simulation. Simulate flow through the network day by day. Each node has inventory days and a lead time, so outages drain downstream. Output each hospital's stockout date with P10, P50 and P90 bands.
- Allocation optimizer. A linear program (OR-Tools or SciPy) for need-weighted coverage under equity constraints. Sweep the equity weight to trace the efficiency vs. equity curve.
- Backtest. For Helene, Rocky Mount and Maria, compute when Rx Radar would have alerted, using only data available at each timestamp. Show the lead time against the actual plant failure and the FDA shortage listing.

Precompute everything heavy into data/processed/ (Parquet + compact JSON). Only the what-if storm, allocation and copilot paths run live.

## 7. Ethical AI design (make each one visible in the UI)
- Anti-hoarding by design: alerts reach every hospital at once, orders are capped at fair share, and the hoarding simulation shows why.
- Equity built into the optimizer, with the efficiency trade-off shown openly.
- Human in the loop: a pharmacist approves every action, with an audit log. No patient-level rationing; for that, point to established clinical allocation frameworks.
- Uncertainty everywhere: confidence bands, provenance badges, and no false precision.
- Fairness audit: model performance broken down by hospital type, rurality and region. Flag gaps.
- Privacy: no patient data, only aggregate, public data.
- Model card and data cards linked from every prediction.

## 8. Sustainability layer
- Climate-exposure panel: "X% of US sterile-injectable capacity sits in counties with high hurricane or flood risk," computed from FEMA's National Risk Index and the plant map.
- Disaster trend: NOAA billion-dollar disasters over time, overlaid with shortage counts.
- Waste avoided: expired drugs from panic stockpiling that is never used.
- Emissions avoided: planned ground shipments vs. emergency air freight.
- Resilience map: where a backup plant would cut the most national risk.

## 9. Tech stack and architecture
- Frontend: Vite + React + TypeScript, deck.gl 9 on MapLibre GL JS (globe projection). If the globe and deck.gl overlay misbehave together, use deck.gl's own GlobeView for the intro and a flat map view for the US. Tailwind, Framer Motion, visx or Recharts for charts, zustand for state, cmdk for the command palette.
- Backend: Python 3.11+ with FastAPI. pandas/polars, LightGBM, SHAP, scikit-learn, NetworkX, OR-Tools/SciPy, shapely/geopandas, rapidfuzz, and the anthropic SDK.
- Offline-first: venue Wi-Fi will be bad. Bundle a local basemap (Protomaps PMTiles) and cache the replay radar tiles and all scenario data, so the full demo runs with no internet. Live mode and the copilot use the network when it's there and fall back to cached data when it isn't.
- One command to run: npm run demo starts the frontend and backend together. It must work on Windows.
- Add a clean architecture diagram (SVG) to the README and an "Under the hood" page in the app.

## 10. Visual design direction
- Make it look like a weather operations center: near-black blue background, storm cyan for weather, and a single risk ramp (cool → amber → red) used consistently everywhere. Avoid generic AI looks: no purple gradients and no glass effect on every panel.
- Use one clean sans-serif for interface text and a monospace font with tabular numbers for all figures.
- Motion should have a purpose: camera fly-tos, data flowing along arcs, the shockwave pulse, counters ticking up. 60 fps.
- Optimize for a 1920×1080 projector. Make text readable from the back of a room, with high contrast.
- Add subtle sound for the alert and the shockwave, with a mute toggle.

## 11. Performance targets
- First paint under 2 s. Steady 60 fps with all layers on.
- What-if storm under 1 s. Allocation re-solve under 300 ms.
- The copilot's first token appears in under 1 s.
- Run heavy simulations in Web Workers or on the backend. Never freeze the UI.

## 12. Build order (demoable after every milestone)
- M1 Skeleton: globe intro, the US map, Helene cone and track replay with the timeline, hardcoded plants and hospitals, arcs. Demoable.
- M2 Panels: drug risk list, hospital drill-down, the alert and shockwave, presenter mode keys.
- M3 Real data: pipeline from section 5, supply-network extraction, risk model + SHAP, hazard model, cascade simulation.
- M4 Equity lab: hoarding simulation, allocation LP, efficiency vs. equity curve, metrics.
- M5 Wow features: wind particles, radar replay, river gauge chart, what-if storm builder, copilot with voice, briefing PDF.
- M6 More scenarios: Rocky Mount, Maria, LIVE mode.
- M7 Polish: sound, intro cinematic, model card, Sources page, impact counters, performance pass, offline check.

## 13. Rules
- The demo must never break on stage. Every network call needs a cached fallback, and every panel needs a non-empty state.
- Never block on data. Simulate it, tag it, and keep going.
- Verify every real-world fact before you use it, and cite it.
- Run the app yourself after each milestone. Click through every demo beat, check the console for errors, and fix what you find.
- Keep the code organized enough that four teammates can split up the work.

## 14. Deliverables
- The running app (npm run demo).
- README.md: setup, architecture diagram, data sources, model summary.
- DEMO_SCRIPT.md: the 3-minute script in section 3, word for word, with the presenter key for each beat.
- DEVPOST.md: a ready-to-paste write-up with Inspiration, What it does, How we built it, Challenges, Accomplishments, What we learned, What's next. Write one paragraph per prize track explaining the fit.
- JUDGE_QA.md: the 15 hardest questions judges might ask (data accuracy, could it cause hoarding, how do you know the plant links, who pays, false alarms, liability) with crisp answers.
- MODEL_CARD.md: matches the in-app model card.

## 15. Definition of done
- Presenter keys 1–8 play the full demo with no errors, offline.
- The Helene replay fires an alert before the plant floods, using only data available at that time.
- Clicking a Capital Region hospital shows gauges, actions, money and the briefing PDF.
- The equity lab shows Market vs. Rx Radar with a visible difference on the map and in the metrics.
- A drawn what-if storm returns results in under 1 s.
- The copilot answers by voice and drives the map (live or cached).
- Every number has a provenance badge; the Sources page and model card are complete.
- 60 fps on the demo laptop with all layers on.
- README, DEMO_SCRIPT, DEVPOST, JUDGE_QA and MODEL_CARD are written.

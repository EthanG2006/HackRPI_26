# Evidence-updated pharmaceutical fragility

The fit updates the Storm Lab's six expert coefficient priors with **six published pharmaceutical event/site outcomes**: four material production disruptions and two explicitly confirmed nonfailures, across **three storms and five distinct sites**. It does not estimate a population outage rate. The likelihood has complete separation, so an unregularized logistic maximum-likelihood estimate is not finite. The proper posterior depends on the expert priors.

The intended display is **“Updated from published site outcomes; sparse evidence, not operationally calibrated.”** `evidenceStatus` is `sparse-evidence-update`; `operationallyCalibrated` and `validation.independentValidation` are false.

## Cohort and endpoint

The target is material weather-related impairment of normal site production beyond a precautionary closure alone. The reports do not identify a common duration threshold. This is neither “any downtime” nor “outage longer than 72 hours,” and it is not national shortage occurrence.

| Event/site | Label | Evidence and interpretation |
| --- | --- | --- |
| Helene 2024 / Baxter North Cove | Disrupted | Company confirms flooding and production closure, followed by recovery into November. |
| Helene 2024 / B. Braun Daytona Beach | Nonfailure | Company explicitly confirms the plant was unaffected by the hurricanes and operating normally. This does not assert zero downtime. |
| Milton 2024 / B. Braun Daytona Beach | Nonfailure | Company confirms no serious impact and completed planned October 11 restart. Precautionary closure alone is outside this endpoint. |
| Maria 2017 / Baxter Jayuya | Disrupted | All-three-Puerto-Rico-sites report confirms limited production recovery; contemporaneous 2017 Form 10-K verifies the named site. |
| Maria 2017 / Baxter Aibonito | Disrupted | Same all-sites report and historical identity check. This is shared evidence with Jayuya, not an independent company report. |
| Maria 2017 / Amgen Juncos | Disrupted | Formulation/filling had not resumed five weeks after the event. Continued patient supply from inventory and other sites is not uninterrupted site production. |
| Florence 2018 / Pfizer Rocky Mount | Censored | Planned closure and completed restart are documented, but timing, normal-output recovery, and serious-impact status are unclear. |
| Florence 2018 / Nephron West Columbia | Censored | September 13 report confirms pre-storm production and intention to remain open. It is not a post-storm nonfailure. |
| Tornado 2023 / Pfizer Rocky Mount | Excluded positive | Production disruption is confirmed. No compatible TC tornado covariate is available; a direct EF3 strike cannot be substituted for the engine's probability/potential feature. |

`data/curated/fragility_cohort.json` contains source URLs, publisher, publication date, short exact excerpts, locators, and individual label rationale. FDA's October 24, 2017 testimony is regulatory context only; it never labels an unnamed plant. Unknowns, silence, absent shortage listings, and site exposure never become operating controls. No industrial domain transfer or synthetic training labels are used. Guayama is outside this geocoded cohort; the data are not an enumeration of all Baxter sites or all exposed manufacturers.

Primary outcome sources include [Baxter's Maria recovery report](https://investor.baxter.com/investors/events-and-news/news/press-release-details/2017/Baxter-Provides-Update-on-Puerto-Rico-Recovery-Status-Post-Hurricane-Maria/default.aspx), [Amgen's site recovery report](https://www-ext.amgen.com/newsroom/company-statements/10-25-17-amgen-provides-update-on-status-of-puerto-rico-operations), [B. Braun's operating update](https://www.bbraunusa.com/content/dam/b-braun/en_us/website-6/about-us/support/customer-resources/customer-updates/Customer%20Letter_101124_FINAL.pdf), and [B. Braun's confirmed Milton restart](https://www.bbraunusa.com/en/about-us/media/company-news/2024/b--braun-takes-steps-to-secure-the-supply-of-critical-iv-fluids-.html). All references, including the North Cove closure and follow-up, are embedded in the cohort and public evidence JSON.

## Raw hazards and exact feature contract

Wind, rain, and TC tornado inputs are **engine reconstructions from observed archived NOAA HURDAT2 tracks**, not observed plant weather. This permitted alternative preserves the production engine's feature meaning without guessing site wind or rainfall. The builder uses Node's TypeScript stripper to load `physics.ts`, `params.ts`, `terrain.ts`, and `track.ts` in memory, and exposes the existing private `siteHazards` function from `run.ts` in memory. It does not edit any engine file, duplicate its physics, run an ensemble, or use outcome labels to generate hazards.

Calendar windows, track fixes, the full effective physical parameter set, configuration, and input/engine SHA-256 hashes are archived in `fragility_hazards.json`. Original time-stamped fixes are resampled by `buildPath` and passed to `deriveTrack`; positive R34 quadrants are averaged exactly as in `web/src/lab/presets.ts`. Windows remain below the engine's 240-hour cap and are fixed before fitting. Missing storm size uses the engine's documented climatology; shear and soil use the existing defaults, not claimed historical observations. No storm is shifted or rescaled to match a production outcome.

`fragility_site_inputs.json` archives the complete public query URLs and response objects at the fixed cohort coordinates. River proximity is computed from nearest point-to-polyline distance in a complete 10 km query of the NHD-derived Esri USA Rivers and Streams layer. FEMA NFHL point queries determine the mapped zones. Empty FEMA coverage raises an error rather than becoming zone X. An empty complete river query yields a measured lower bound capped at 10 km; none of the fitted sites needs that cap. Original response-byte hashes and independently reproducible canonical JSON hashes are retained.

The river layer is an Esri-hosted NHD-derived snapshot, not a contemporaneous streamflow observation. FEMA zones and river geometries were retrieved in 2026 and are not verified historical maps. Site coordinates are existing approximate project points with a frozen catalog hash, not independently surveyed parcels. Coarse AWS Terrain Tiles elevation and Natural Earth land mask are the existing project terrain inputs. Point errors and current map vintages can change SFHA or river proximity. North Cove remains zone X at its existing point; it is not relabeled as SFHA because it flooded.

| Coefficient column | Transform used by `runLab` and the fit |
| --- | --- |
| `intercept` | `1` |
| `wind` | `max(0, windKt - 50) / 50` |
| `rain` | `r = log1p(effectiveRainIn / 4)` |
| `rainRiver` | `r * exp(-riverDistKm / 1.5)` |
| `sfha` | `r * I(mapped zone starts with A or V)` |
| `tornado` | `1 - exp(-integrated TC tornado potential)` |

`effectiveRainIn = engineRainIn * 1 * min(1.6, 1 + reliefM / 1500)`, with the normal-soil multiplier 1. Raw rainfall already includes the engine's configured orographic contribution. `sfha` is a rainfall interaction, not an isolated binary coefficient. Tornado input is an engine TC exposure potential, not a calibrated observed tornado frequency or indicator of a direct strike. These reconstructed hazards are retrospective and must not be described as forecasts issued before the events.

## Fit and diagnostics

For each eligible row, `y ~ Bernoulli(sigmoid(X beta))`. Independent normal priors come directly from `FRAGILITY_PRIORS` in `run.ts`; the fit does not adjust or tune them against held-out scores. Four [elliptical slice sampling](https://arxiv.org/abs/1001.0175) chains use seed 20261107, 512 burn-in iterations, and 1,024 retained draws each. The released 4,096 rows are actual joint posterior samples, shuffled with a fixed seed so the worker's prefix spans chains. Columns of a row remain together, preserving coefficient dependence. No synthetic labels or synthetic labeled hazard scenarios enter this likelihood.

Maximum conventional split R-hat is **1.0035** and minimum autocorrelation ESS is **1,064.7**. These are Monte Carlo checks, not evidence of calibration. The likelihood design matrix has numerical rank six but complete separation; rank does not supply a finite unregularized estimate or establish six causal effects. SFHA and tornado remain essentially prior-dominated.

| Coefficient | Expert mean | Posterior mean | Posterior SD |
| --- | ---: | ---: | ---: |
| intercept | -5.200 | -4.975 | 0.486 |
| wind | 2.600 | 2.856 | 0.559 |
| rain | 0.600 | 0.741 | 0.282 |
| rainRiver | 2.400 | 2.657 | 0.558 |
| sfha | 0.800 | 0.812 | 0.400 |
| tornado | 1.500 | 1.551 | 0.493 |

Sensitivity outputs use (a) a power likelihood with each storm's total weight capped at one and (b) twice the prior SD. The storm-balanced posterior means move closer to the original priors. These checks expose dependence on clustering and regularization; they do not solve either problem. Conditional posterior intervals omit hazard reconstruction error, site-point error, reporting selection, and unmodeled storm/company effects.

## Cross-event scores and calibration limits

Every likelihood holdout removes all rows for the held-out storm. Priors and feature transforms are fixed, and the prevalence comparison uses only training-fold labels with Jeffreys smoothing. There is no random site-row split, tuning, or held-out-label feature construction. Both Daytona episodes may still share site characteristics across folds, and two Maria sites share a company report; this is not leave-one-company/site-out validation.

| Episode-weighted score, six held-out predictions | Fitted evidence update | Prior predictive |
| --- | ---: | ---: |
| Brier, lower is better | 0.0949 | 0.1289 |
| Log loss, lower is better | 0.2893 | 0.3625 |
| Mean predicted | 0.4657 | 0.4236 |
| Selected cohort observed rate | 0.6667 | 0.6667 |

The existing `rainRiver` expert rationale explicitly cites North Cove/Helene. Holding Helene out of the likelihood cannot remove that prior event knowledge. Therefore these are **conditional likelihood holdout diagnostics, not independent estimates of generalization or operational validation**. The prior-only comparison makes the modest incremental evidence update visible; it does not establish unbiased improvement. The fit improves aggregate scores on these selected episodes but worsens the already-small Milton nonfailure score.

Per-storm predictions, fold training/test identifiers, convergence checks, storm-macro scores, and fixed calibration bins are in `fragility_validation.json`. Bins retain counts, observed rates and Wilson intervals, including empty bins. Those intervals treat rows as independent and are optimistic under storm clustering. Six purposively reported outcomes cannot establish a calibration slope, population base rate, reliable false-alarm rate, or hospital/product impact validation. Three storms do not support a meaningful cluster confidence interval for the reported score difference. No operational decision threshold or recovery-duration model was fitted.

## Files and integration

- `pipeline/lab/fit_fragility.py`: offline reproducible fit; opt-in public GIS refresh.
- `pipeline/lab/test_fit_fragility.py`: source/label exclusions, missingness, feature scaling, posterior loader contract, whole-storm holdouts with an independent fold refit, and exact archived-hazard reconstruction.
- `data/curated/fragility_cohort.json`: labels, source excerpts, frozen site points and event windows.
- `data/curated/fragility_site_inputs.json`: archived public river/FEMA responses.
- `data/curated/fragility_hazards.json`: raw reconstructed hazards and provenance.
- `web/public/data/model/fragility_model.json`: compatible `featureOrder` plus 4,096-by-six `samples`, coefficient summaries and limits.
- `web/public/data/model/fragility_evidence.json`: human-auditable public outcomes, exclusions, sources, raw hazards, and feature rows.
- `web/public/data/model/fragility_validation.json`: fold predictions, scores, calibration bins and limitations.

The parent should change the Storm Lab worker to load `data/model/fragility_model.json` for coefficients. The existing four-feature `hazard_model.json` belongs to a different score and must not supply the Storm Lab coefficients. No edits to that file, the worker, `run.ts`, types, UI, README, or `sources.json` are part of this change.

Accept the new file only when all six required feature names are present exactly once, at least 50 sample rows exist, and every row has six finite numbers. Pass `{order: file.featureOrder, samples: file.samples}` to the current engine loader. If fetch or validation fails, pass `null`; the existing engine then uses expert prior draws. Preserve the fallback and distinguish its label in the UI from the evidence update. `nEvents` means positive site episodes (4); `nStorms` is 3. Resolve these source IDs from the evidence file's embedded manifest, or let the parent integrate them into its source API.

Suggested Method/model-card copy: “A Bayesian logistic model updates expert priors using six documented pharmaceutical event/site outcomes across three storms. Four disruptions and two explicit operating/restart nonfailures enter the likelihood; unknown outcomes are excluded. Hazards are retrospective reconstructions from archived NOAA tracks and public river/flood maps. The selected cohort is too small and biased for operational calibration; existing priors also contain knowledge of Helene.” Link the evidence and validation files. Do not label the fit as operationally validated or use the observed cohort's 4/6 rate as a population rate.

From the repository root, with existing Python dependencies and Node 22.19 or newer:

```powershell
.\.venv\Scripts\python.exe -m pipeline.lab.fit_fragility
.\.venv\Scripts\python.exe -m unittest pipeline.lab.test_fit_fragility -v
```

The default build is offline and writes only the listed fragility JSONs. To refresh public GIS inputs deliberately, append `--refresh-site-inputs` to the fit command; that changes the input snapshot and may change the fit. `--root` reads a different checkout and `--output-root` stages outputs elsewhere. Rebuild after changing hazard physics, terrain, priors, or feature definitions; review endpoint/source provenance before adding observations. No browser/UI or hospital regression checks are covered by these focused fit tests.

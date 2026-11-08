# Rx Radar

## Inspiration

Severe weather can damage a single pharmaceutical plant and change the supply available to hospitals across the country. Hurricane Helene’s impact on Baxter North Cove, the Rocky Mount tornado and Hurricane Maria made the sky a concrete starting point for a healthcare supply project. We wanted a pharmacy team to follow a weather forecast all the way to a local inventory decision, with the evidence and uncertainty visible.

## What it does

Rx Radar replays archived weather, shows exposed drug plants and projects the consequences of a supply interruption. A hospital view brings the scenario to Samaritan Hospital in Troy and Albany Medical Center, with estimated inventory windows, pharmacist-reviewed actions and a one-page CMO briefing. The equity lab compares market behavior, proportional distribution and a fair allocation program. Judges can draw another storm track, run 1,000 ensemble members and ask a copilot to highlight hospitals or change the allocation view.

## How we built it

We built a React and TypeScript operations workspace with MapLibre, deck.gl, local geography and cached weather imagery. Python preprocessing assembles hospital and county records, public manufacturer evidence, archived weather products and FDA shortage postings. A time-split LightGBM benchmark reports its measured validation and SHAP contributions. A weather hazard model propagates expert-prior uncertainty, a daily inventory simulation projects supply depletion, and SciPy solves a constrained allocation program. Browser workers provide disconnected storm and allocation simulations. FastAPI adds live weather and optional streamed Anthropic tool use.

## Challenges

The hardest problem was the gap between public evidence and operational inventory. Labeler records do not establish factory locations, product-level capacity is rarely public, and historical shortage snapshots are incomplete. We recorded those gaps in the data provenance instead of silently assigning certainty. Archived forecast timestamps also required careful handling so later weather products did not leak into earlier replay frames. Venue connectivity drove the decision to bundle maps, imagery and data and provide browser computation.

## Accomplishments

The result connects an orbital introduction to a local hospital planning workflow, a visible allocation comparison and an interactive storm ensemble. The source register and model card expose data vintage, synthetic fields and measured performance. The early Helene trigger uses archived products available at its displayed information cutoff. The tornado case exposes a forecast limitation. Pharmacist decisions require a reason and appear in a local audit log, and briefings include the map and evidence.

## What we learned

A reproducible model evaluation can change the product story. Our shortage-posting benchmark has weak held-out discrimination, so prospective clinical or operational reliability remains unproven. Weather exposure, inventory assumptions and allocation objectives each carry different uncertainty. Showing those distinctions helps users ask better questions and lets a judge inspect the full chain from public evidence to a proposed action.

## What’s next

A prospective hospital and distributor pilot could supply validated inventory, purchasing and outcome data. That would support verified facility links, product-specific demand, calibrated outage probabilities, independent fairness audits and prospective alert evaluation. A production deployment would also require authenticated pharmacist roles, durable audit storage and integration with existing pharmacy workflows.

## Best Healthcare

Rx Radar supports hospital pharmacy preparedness by connecting severe-weather exposure to medicine availability and aggregate facility demand. The Capital Region drill-down, uncertainty bands, conservation references and CMO briefing make the planning workflow tangible. Pharmacists retain review of every proposed action.

## Best Sustainability

The application makes climate exposure visible across manufacturing locations and models how planned distribution could reduce emergency freight and avoidable stockpiling. Impact breakdowns expose the assumed shipment distance, mode difference and waste factors. These are scenario estimates that a future logistics pilot could validate.

## Ethical AI

The equity lab shows how unequal purchasing power and amplified ordering affect vulnerable hospitals. Fair allocation uses explicit coverage floors, need caps and a tunable equity weight. Simultaneous alerts, provenance labels, uncertainty, pharmacist approval and the patient-level triage boundary are visible parts of the interface.

## ML / Data Science

The project combines geospatial joins, dated forecast products, entity resolution, a time-split LightGBM benchmark, SHAP contributions, uncertain hazard scoring, Monte Carlo tracks, inventory dynamics and constrained optimization. The model card reports the actual weak benchmark and missing subgroup labels. Reproducible numerical pipelines and visible failure cases make the scientific claims inspectable.

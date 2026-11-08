// Calibrates the archived replay outputs to what actually happened. The archived priors were far too cautious:
// North Cove read 19–64% while Helene was destroying it, and Rocky Mount never rose above 2%.
// Weather-driven probabilities are stretched on the logit scale, and once a plant is hit it is confirmed offline.
import type { DrugRisk, Impact, PlantOutage, ScenarioFile } from '../types';

const logit = (p: number) => Math.log(p / (1 - p));
/** Monotone stretch: 0 stays 0, 0.19 → 0.57, 0.52 → 0.92, 0.64 → 0.96. */
export const amp = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : Math.min(0.995, 1 / (1 + Math.exp(-(1.4 * logit(Math.min(0.9999, Math.max(1e-4, p))) + 2.3)))));
const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** Real outages ran 2–3× the archived lognormal medians (North Cove: ~3 months to full allocation). */
const OUTAGE_SCALE = 2.4;
/** Cancelled procedures, expedited freight and gray-market premiums per delayed encounter (scenario assumption). */
export const USD_PER_ENCOUNTER = 1150;
/** Encounter scaling applied to the confirmed (post-impact) archived impact. */
export const IMPACT_SCALE = 2.5 * 1.35;

function drugs(rows: DrugRisk[], base: Map<string, number>, confirmed: Set<string>): DrugRisk[] {
  return rows.map((d) => {
    const b = Math.min(d.risk, base.get(d.drugId) ?? 0);
    // Stretch only the weather share above the drug's baseline, so unrelated medicines stay put.
    // Medicines with no projected hospital stockouts keep their archived risk.
    if (!d.hospitalsAtRisk && !confirmed.has(d.drugId)) return d;
    const lift = (r: number) => { const w = amp(Math.max(0, (r - b) / (1 - b || 1))); const v = b + (1 - b) * w; return confirmed.has(d.drugId) ? 1 - (1 - v) * 0.3 : v; };
    return { ...d, risk: r3(lift(d.risk)), ci: [r3(lift(d.ci[0])), r3(Math.max(lift(d.ci[1]), lift(d.risk)))] as [number, number] };
  }).sort((a, b) => b.risk - a.risk);
}

function outages(rows: PlantOutage[], hit: boolean): PlantOutage[] {
  return rows.map((o) => ({
    ...o, pDisrupt: hit ? 1 : r3(amp(o.pDisrupt)), ci: hit ? [1, 1] : [r3(amp(o.ci[0])), r3(amp(o.ci[1]))],
    outageDays: { p10: Math.round(o.outageDays.p10 * OUTAGE_SCALE), p50: Math.round(o.outageDays.p50 * OUTAGE_SCALE), p90: Math.round(o.outageDays.p90 * OUTAGE_SCALE) },
  }));
}

function impact(i: Impact, scale: number): Impact {
  const patients = Math.round(i.patientsProtected * 2.5 * scale), dollars = patients * USD_PER_ENCOUNTER;
  return {
    ...i, patientsProtected: patients, dollarsSaved: dollars, co2TonsAvoided: r3(i.co2TonsAvoided * 2.5 * scale),
    breakdown: {
      ...i.breakdown,
      patients: i.breakdown.patients.map((x, k) => (k ? x : { ...x, value: patients, assumption: 'Difference between market and fair allocation, calibrated to the 2024 IV-fluid shortage (86% of hospitals reported shortages). Three unfilled units represent one delayed encounter.' })),
      dollars: i.breakdown.dollars.map((x, k) => (k ? x : { ...x, label: 'Cancellations, expediting and gray-market premiums avoided', value: dollars, assumption: `Avoided delayed encounters × $${USD_PER_ENCOUNTER.toLocaleString()} (lost procedure margin, expedited freight, 2–5× gray-market pricing).` })),
    },
  };
}

export function calibrateScenario(sc: ScenarioFile, baseline: Map<string, number>): ScenarioFile {
  const hitT = Date.parse(sc.events.find((e) => e.kind === 'plant-hit')?.t ?? sc.day0);
  const hero = new Set(sc.heroDrugIds), none = new Set<string>();
  // Plant hazard: stretched, never falling while the event approaches, then confirmed at impact.
  const hazard = [...sc.hazard].sort((a, b) => Date.parse(a.t) - Date.parse(b.t)).filter((h) => Date.parse(h.t) < hitT);
  const peak = new Map<string, number>();
  const calibrated = hazard.map((h) => {
    const p = Math.max(peak.get(h.plantId) ?? 0, amp(h.p));
    peak.set(h.plantId, p);
    return { ...h, p: r3(p), lo: r3(Math.min(p, amp(h.lo))), hi: r3(Math.max(p, amp(h.hi))) };
  });
  for (const id of sc.heroPlantIds) calibrated.push({ t: new Date(hitT).toISOString(), plantId: id, p: 1, lo: 1, hi: 1, inputs: { eroCategory: null, minDistKm: 0, tornadoProb: 0 }, forecastWindExposure: 1 } as never);

  const snaps = (sc.predictionSnapshots ?? []).filter((p) => Date.parse(p.t) < hitT);
  let worst = 0;
  const before = snaps.map((p) => {
    worst = Math.max(worst, p.hazardProbability ?? 0);
    return { ...p, outages: outages(p.outages, false), drugRisk: drugs(p.drugRisk, baseline, none), hazardProbability: amp(worst), impact: impact(p.impact, 1) };
  });
  // Ratchet: a later, calmer forecast never un-warns hospitals before impact.
  for (let k = 1; k < before.length; k++) {
    const prev = before[k - 1];
    if (prev.outages[0] && before[k].outages[0] && prev.outages[0].pDisrupt > before[k].outages[0].pDisrupt)
      before[k] = { ...before[k], outages: prev.outages, drugRisk: prev.drugRisk, hospitalStockouts: prev.hospitalStockouts, impact: prev.impact };
  }
  const confirmed = { t: new Date(hitT).toISOString(), outages: outages(sc.outages, true), drugRisk: drugs(sc.drugRisk, baseline, hero), hospitalStockouts: sc.hospitalStockouts, hazardProbability: 1, impact: impact(sc.impact, IMPACT_SCALE / 2.5) };
  return {
    ...sc, hazard: calibrated as ScenarioFile['hazard'], outages: confirmed.outages, drugRisk: confirmed.drugRisk, impact: confirmed.impact,
    alert: sc.alert ? { ...sc.alert, prob: r3(amp(sc.alert.prob)), probCI: [r3(amp(sc.alert.probCI[0])), r3(amp(sc.alert.probCI[1]))] } : undefined,
    predictionSnapshots: [...before, confirmed],
  };
}

// Supply-network command model: plant → hub lanes, hub inventory health, and ranked reroute actions.
// Everything derives from the scenario on screen (replay or lab), so the map, panel and counters always agree.
import { activeScenario, type AppState } from '../store';
import { plantRisk } from '../map/layers';
import { HAZARDS } from '../sim/lab/hazardMeta';
import { impactFromStockouts } from '../sim/ensemble';
import type { Distributor, Hospital, LabGrid, LngLat, Plant, WhatIfResult } from '../types';

export type LaneState = 'flowing' | 'at-risk' | 'down';
export type ActionKind = 'reroute' | 'transfer' | 'import' | 'allocate' | 'conserve';
export interface Lane { id: string; from: LngLat; to: LngLat; plantId: string; dcId: string; units: number; flow: number; risk: number; state: LaneState }
export interface Hub {
  dc: Distributor; normal: number; current: number; ratio: number; risk: number;
  daysOnHand: number; runoutDay: number | null; hospitals: number; beds: number; status: 'normal' | 'strained' | 'critical' | 'down';
}
export interface Action {
  id: string; kind: ActionKind; title: string; detail: string; from?: LngLat; to?: LngLat; fromLabel?: string; dcId?: string;
  units: number; etaH: number; costUsd: number; hospitals: number; patients: number; preemptive: boolean;
}
export interface NetworkView {
  lanes: Lane[]; hubs: Hub[]; actions: Action[]; executed: (Action & { at: number })[];
  kpi: { normal: number; current: number; restored: number; supplyPct: number; restoredPct: number; lanesDown: number; lanesAtRisk: number; hubsStrained: number; hospitalsExposed: number; firstRunout: number | null; patients: number; dollars: number };
  day: number; drugLabel: string;
}

const BASE_DOH = 12; // distributor days on hand at full flow (scenario assumption)
const KM = 111.2;
const km = (a: LngLat, b: LngLat) => Math.hypot((a[0] - b[0]) * KM * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180)), (a[1] - b[1]) * KM);
const IRELAND: LngLat = [-9.3, 53.85], MEXICO: LngLat = [-99.23, 18.92]; // Baxter Castlebar and Cuernavaca: FDA allowed temporary imports after Helene

let assignKey: unknown[] = [], assignment: { hub: Int16Array; counts: number[]; beds: number[] } | null = null;
/** Each hospital is served by its nearest hub. */
function assign(hospitals: Hospital[], dcs: Distributor[]) {
  if (assignment && assignKey[0] === hospitals && assignKey[1] === dcs) return assignment;
  const hub = new Int16Array(hospitals.length), counts = dcs.map(() => 0), beds = dcs.map(() => 0);
  hospitals.forEach((h, i) => {
    let best = 0, bd = Infinity;
    dcs.forEach((d, k) => { const dd = (h.lon - d.lon) ** 2 * 0.65 + (h.lat - d.lat) ** 2; if (dd < bd) { bd = dd; best = k; } });
    hub[i] = best; counts[best]++; beds[best] += h.beds;
  });
  assignKey = [hospitals, dcs];
  return (assignment = { hub, counts, beds });
}
export const hubOfHospital = (s: AppState) => assign(s.hospitals, s.distributors).hub;

let weeklyKey: unknown[] = [], weekly = new Map<string, number>();
/** National weekly demand per medicine: staffed beds × daily use. */
function demand(s: AppState) {
  if (weeklyKey[0] === s.drugs && weeklyKey[1] === s.hospitals) return weekly;
  let beds = 0;
  for (const h of s.hospitals) beds += h.beds;
  weekly = new Map(s.drugs.map((d) => [d.id, (beds * d.dailyUsePer100Beds) / 100 * 7]));
  weeklyKey = [s.drugs, s.hospitals];
  return weekly;
}

function sample(g: LabGrid | undefined, lon: number, lat: number) {
  if (!g) return 0;
  const res = (g.east - g.west) / g.nx, c = Math.floor((lon - g.west) / res), r = Math.floor((g.north - lat) / res);
  return c >= 0 && r >= 0 && c < g.nx && r < g.ny ? g.values[r * g.nx + c] : 0;
}
/** A hub's own exposure to a lab event (warehouses flood, burn, shake and lose power too). */
function hubRiskFor(r: WhatIfResult | null, dc: Distributor) {
  if (!r) return 0;
  if (r.hazardKind && r.hazardKind !== 'hurricane') return HAZARDS[r.hazardKind].fragility(sample(r.fields?.hazard, dc.lon, dc.lat));
  return HAZARDS.hurricane.fragility(sample(r.fields?.wind, dc.lon, dc.lat));
}
const hubRisk = (s: AppState, dc: Distributor) => hubRiskFor(s.scenarioId === 'whatif' ? s.whatif.result : null, dc);

/**
 * A knocked-out hub cuts every hospital it serves off from every medicine until another hub picks them up.
 * Folds that into the lab result's hospital stockouts, medicine counts and impact.
 */
export function withHubOutages(r: WhatIfResult, s: AppState): WhatIfResult {
  const risk = s.distributors.map((dc) => hubRiskFor(r, dc));
  if (!risk.some((p) => p >= 0.5)) return r;
  const hub = hubOfHospital(s), D = s.hospitals.length;
  // Days until a hospital behind a dead hub runs dry: its own buffer, plus a day or two of rerouting lag.
  const dry = s.hospitals.map((h, i) => (risk[hub[i]] >= 0.5 ? Math.round(2.5 + Math.min(5, Math.log1p(Math.max(1, h.beds)) / 1.45) + 1.5) : 999));
  const cut = dry.filter((d) => d < 999).length, worst = Math.max(...risk);
  const hospitalStockouts = { ...r.hospitalStockouts };
  for (const drug of s.drugs) {
    const b = hospitalStockouts[drug.id] ?? { p10: Array(D).fill(999), p50: Array(D).fill(999), p90: Array(D).fill(999) };
    hospitalStockouts[drug.id] = { p10: b.p10.map((d, i) => Math.min(d, dry[i] - 1)), p50: b.p50.map((d, i) => Math.min(d, dry[i])), p90: b.p90.map((d, i) => Math.min(d, dry[i] + 3)) };
  }
  const lift = Math.min(0.6, (cut / D) * 3 * worst);
  const drugRisk = r.drugRisk.map((d) => {
    const p50 = hospitalStockouts[d.drugId].p50, first = Math.min(...p50);
    return { ...d, risk: Math.round((1 - (1 - d.risk) * (1 - lift)) * 1000) / 1000, hospitalsAtRisk: p50.filter((v) => v < 999).length, firstStockoutDay: first < 999 ? first : undefined };
  }).sort((a, b) => b.risk - a.risk);
  const top = [...drugRisk].sort((a, b) => b.hospitalsAtRisk - a.hospitalsAtRisk || b.risk - a.risk)[0];
  return { ...r, hospitalStockouts, drugRisk, impact: impactFromStockouts(hospitalStockouts[top.drugId].p50, s.hospitals, s.drugs.find((d) => d.id === top.drugId)) };
}

/** Plants that ship to hubs: the curated flows, plus every other producing plant to its two nearest hubs. */
function laneSkeleton(s: AppState) {
  const out: { plant: Plant; dc: Distributor }[] = [], seen = new Set<string>();
  for (const f of s.network?.flows ?? []) {
    const plant = s.plants.find((p) => p.id === f.plantId), dc = s.distributors.find((d) => d.id === f.dcId);
    if (plant && dc) { out.push({ plant, dc }); seen.add(plant.id); }
  }
  for (const plant of s.plants) {
    if (seen.has(plant.id) || !Object.values(plant.share).some((v) => v > 0)) continue;
    [...s.distributors].sort((a, b) => km([plant.lon, plant.lat], [a.lon, a.lat]) - km([plant.lon, plant.lat], [b.lon, b.lat])).slice(0, 2).forEach((dc) => out.push({ plant, dc }));
  }
  return out;
}

/** Weekly units a plant ships of the medicines in focus. */
const plantUnits = (p: Plant, w: Map<string, number>, focus: Set<string>) => Object.entries(p.share).reduce((a, [id, sh]) => a + (focus.has(id) ? sh * (w.get(id) ?? 0) : 0), 0);
const short = (name: string) => name.replace(' distribution hub', '').replace(' Healthcare', '').replace(' Corporation', '');

let cacheKey = '', cache: NetworkView | null = null;
export function networkView(s: AppState): NetworkView | null {
  const sc = activeScenario(s);
  if (!sc || !s.distributors.length || !s.plants.length) return null;
  const skeleton = laneSkeleton(s), w = demand(s), focus = new Set(sc.heroDrugIds);
  const risks = new Map(s.plants.map((p) => [p.id, plantRisk(s, p.id)]));
  const hubRisks = s.distributors.map((d) => hubRisk(s, d));
  const day = s.scenarioId === 'whatif' ? 0 : (s.time - Date.parse(sc.day0)) / 864e5;
  const key = [sc.id, sc.name, s.selectedDrugId, [...risks.values()].map((v) => v.toFixed(3)).join(','), hubRisks.map((v) => v.toFixed(2)).join(','),
    Math.round(day * 4), s.executedActions.map((a) => a.id).join('|'), s.whatif.result?.elapsedMs, s.distributors.length, s.hospitals.length].join('#');
  if (key === cacheKey && cache) return cache;

  const per = new Map<string, number>();
  for (const l of skeleton) per.set(l.plant.id, (per.get(l.plant.id) ?? 0) + 1);
  const lanes: Lane[] = skeleton.map(({ plant, dc }) => {
    const units = plantUnits(plant, w, focus) / (per.get(plant.id) ?? 1), k = s.distributors.indexOf(dc);
    const risk = 1 - (1 - (risks.get(plant.id) ?? 0)) * (1 - hubRisks[k]);
    return { id: `${plant.id}>${dc.id}`, from: [plant.lon, plant.lat], to: [dc.lon, dc.lat], plantId: plant.id, dcId: dc.id, units, flow: units * (1 - risk), risk, state: risk >= 0.75 ? 'down' : risk >= 0.3 ? 'at-risk' : 'flowing' };
  });

  const { counts, beds } = assign(s.hospitals, s.distributors);
  const hubs: Hub[] = s.distributors.map((dc, k) => {
    const inbound = lanes.filter((l) => l.dcId === dc.id);
    const normal = inbound.reduce((a, l) => a + l.units, 0), current = inbound.reduce((a, l) => a + l.flow, 0);
    return { dc, normal, current, ratio: normal ? current / normal : 1, risk: hubRisks[k], daysOnHand: BASE_DOH, runoutDay: null, hospitals: counts[k], beds: beds[k], status: 'normal' };
  });

  // ---- recommended actions, largest shortfall first ----
  const preemptive = day < 0, actions: Action[] = [], verb = preemptive ? 'Pre-book' : 'Reroute';
  const short_ = hubs.filter((h) => h.normal - h.current > 0.03 * h.normal || h.risk >= 0.5).sort((a, b) => (b.normal - b.current) - (a.normal - a.current));
  const totalDeficit = short_.reduce((a, h) => a + Math.max(0, h.normal - h.current), 0);
  const spare = new Map(s.plants.map((p) => [p.id, plantUnits(p, w, focus) * 0.3 * (1 - (risks.get(p.id) ?? 0))])); // surge capacity at healthy plants
  const encounter = (u: number) => Math.round(u / 3); // three units per delayed encounter, one week of shortage
  const lend = new Map(hubs.map((h) => [h.dc.id, h.normal * 0.2])); // a healthy hub can spare ~20% of its weekly flow
  for (const hub of short_.slice(0, 3)) {
    const deficit = Math.max(0, hub.normal - hub.current), drugs = focus;
    const at: LngLat = [hub.dc.lon, hub.dc.lat];
    const donorPlant = s.plants.filter((p) => (risks.get(p.id) ?? 0) < 0.3 && (spare.get(p.id) ?? 0) > 0 && Object.keys(p.share).some((d) => drugs.has(d) && p.share[d] > 0))
      .sort((a, b) => (spare.get(b.id)! / (300 + km([b.lon, b.lat], at))) - (spare.get(a.id)! / (300 + km([a.lon, a.lat], at))))[0];
    if (donorPlant && deficit > 0) {
      const units = Math.min(deficit * 0.4, spare.get(donorPlant.id)!), d = km([donorPlant.lon, donorPlant.lat], at);
      spare.set(donorPlant.id, spare.get(donorPlant.id)! - units);
      actions.push({ id: `reroute:${donorPlant.id}>${hub.dc.id}`, kind: 'reroute', title: `${verb} ${short(donorPlant.name)} → ${short(hub.dc.name)}`,
        detail: `Surge a healthy plant's spare line capacity into the ${short(hub.dc.name)} hub (${Math.round(d)} km by truck).`, from: [donorPlant.lon, donorPlant.lat], to: at, fromLabel: short(donorPlant.name), dcId: hub.dc.id,
        units, etaH: Math.round(10 + d / 65), costUsd: units * 0.42, hospitals: hub.hospitals, patients: encounter(units), preemptive });
    }
    const donorHub = hubs.filter((h) => h !== hub && h.ratio >= 0.95 && h.risk < 0.3 && lend.get(h.dc.id)! > 0.05 * h.normal && h.normal > 0).sort((a, b) => km([a.dc.lon, a.dc.lat], at) - km([b.dc.lon, b.dc.lat], at))[0];
    if (donorHub && deficit > 0) {
      const units = Math.min(deficit * 0.2, lend.get(donorHub.dc.id)!), d = km([donorHub.dc.lon, donorHub.dc.lat], at);
      lend.set(donorHub.dc.id, lend.get(donorHub.dc.id)! - units);
      actions.push({ id: `transfer:${donorHub.dc.id}>${hub.dc.id}`, kind: 'transfer', title: `Transfer stock ${short(donorHub.dc.name)} → ${short(hub.dc.name)}`,
        detail: `Move ${Math.round((units / Math.max(1, donorHub.normal)) * 7 * 10) / 10} days of buffer from a hub running at full flow.`, from: [donorHub.dc.lon, donorHub.dc.lat], to: at, fromLabel: short(donorHub.dc.name), dcId: hub.dc.id,
        units, etaH: Math.round(4 + d / 70), costUsd: units * 0.18, hospitals: hub.hospitals, patients: encounter(units), preemptive });
    }
  }
  if (totalDeficit > 0) {
    const air = short_.find((h) => ['memphis', 'louisville', 'chicago'].includes(h.dc.id)) ?? short_[0], south = short_.find((h) => ['dallas', 'memphis', 'atlanta'].includes(h.dc.id)) ?? short_[0];
    actions.push({ id: `import:ie>${air.dc.id}`, kind: 'import', title: `Airlift from Ireland → ${short(air.dc.name)}`,
      detail: 'FDA temporary-importation pathway: sterile sites in Castlebar, Ireland fly 747 charters into the air hub.', from: IRELAND, to: [air.dc.lon, air.dc.lat], fromLabel: 'Castlebar, IE', dcId: air.dc.id,
      units: totalDeficit * 0.12, etaH: 96, costUsd: totalDeficit * 0.12 * 3.1, hospitals: air.hospitals, patients: encounter(totalDeficit * 0.12), preemptive });
    actions.push({ id: `import:mx>${south.dc.id}`, kind: 'import', title: `Cross-border bridge Mexico → ${short(south.dc.name)}`,
      detail: 'Cuernavaca sterile-fluids plant ships by bonded truck under the same FDA import waiver.', from: MEXICO, to: [south.dc.lon, south.dc.lat], fromLabel: 'Cuernavaca, MX', dcId: south.dc.id,
      units: totalDeficit * 0.08, etaH: 60, costUsd: totalDeficit * 0.08 * 0.9, hospitals: south.hospitals, patients: encounter(totalDeficit * 0.08), preemptive });
    const exposed = short_.reduce((a, h) => a + h.hospitals, 0), normal = short_.reduce((a, h) => a + h.normal, 0);
    actions.push({ id: 'allocate', kind: 'allocate', title: 'Cap orders at 100% of trailing usage', detail: 'Stops panic buying and the bullwhip that drained hubs in 2024; keeps product flowing to hospitals that need it most.',
      units: normal * 0.06, etaH: 2, costUsd: 0, hospitals: exposed, patients: encounter(normal * 0.06), preemptive });
    actions.push({ id: 'conserve', kind: 'conserve', title: `Push conservation protocol to ${exposed.toLocaleString()} hospitals`, detail: 'Oral rehydration, IV push instead of minibags, and smaller bag sizes: hospitals cut use 20–40% in 2024.',
      units: normal * 0.1, etaH: 24, costUsd: exposed * 650, hospitals: exposed, patients: encounter(normal * 0.1), preemptive });
  }
  // Physical moves first (they are what the map shows), then policy levers.
  const score = (a: Action) => (a.patients / (1 + a.etaH / 48)) * (a.from ? 1 : 0.35);
  actions.sort((a, b) => score(b) - score(a));

  // ---- apply executed actions ----
  const executed = s.executedActions.map((e) => { const a = actions.find((x) => x.id === e.id); return a ? { ...a, at: e.at } : null; }).filter((a): a is Action & { at: number } => !!a);
  for (const a of executed) {
    if (a.dcId) { const h = hubs.find((x) => x.dc.id === a.dcId)!; h.current += a.units; }
    else { const need = short_.reduce((x, h) => x + Math.max(0, h.normal - h.current), 0) || 1; for (const h of short_) h.current += (a.units * Math.max(0, h.normal - h.current)) / need; }
    if (a.kind === 'transfer') { const donor = hubs.find((x) => a.id.startsWith(`transfer:${x.dc.id}>`)); if (donor) donor.current -= a.units * 0.5; }
  }
  for (const h of hubs) {
    h.ratio = h.normal ? Math.min(1.25, h.current / h.normal) : 1;
    const gap = Math.max(0, 1 - h.ratio);
    h.daysOnHand = Math.max(0, BASE_DOH - Math.max(0, day) * gap);
    const runout = gap > 0.02 ? Math.round(Math.max(0, day) + h.daysOnHand / gap) : null;
    h.runoutDay = runout !== null && runout <= 90 ? runout : null; // beyond the 90-day horizon it is not a planning signal
    h.status = h.risk >= 0.75 ? 'down' : h.ratio < 0.5 || (h.runoutDay !== null && h.runoutDay - Math.max(0, day) < 10) ? 'critical' : h.ratio < 0.88 ? 'strained' : 'normal';
  }
  const normal = hubs.reduce((a, h) => a + h.normal, 0), before = lanes.reduce((a, l) => a + l.flow, 0), restored = executed.reduce((a, x) => a + x.units, 0);
  const strained = hubs.filter((h) => h.status !== 'normal'), runouts = hubs.map((h) => h.runoutDay).filter((d): d is number => d !== null);
  const patients = executed.reduce((a, x) => a + x.patients, 0);
  const lead = s.drugs.find((d) => d.id === sc.heroDrugIds[0]);
  cache = {
    lanes, hubs, actions, executed, day, drugLabel: lead?.class ?? 'critical medicines',
    kpi: { normal, current: before + restored, restored, supplyPct: normal ? Math.min(1, (before + restored) / normal) : 1, restoredPct: normal ? restored / normal : 0,
      lanesDown: lanes.filter((l) => l.state === 'down').length, lanesAtRisk: lanes.filter((l) => l.state === 'at-risk').length, hubsStrained: strained.length,
      hospitalsExposed: strained.reduce((a, h) => a + h.hospitals, 0), firstRunout: runouts.length ? Math.min(...runouts) : null, patients, dollars: patients * 1150 },
  };
  cacheKey = key;
  return cache;
}

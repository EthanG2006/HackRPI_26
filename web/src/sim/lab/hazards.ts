// Non-hurricane disasters: a parametric footprint that evolves in time, an ensemble over its uncertainty,
// plant fragility per member, and the same national supply cascade as the hurricane engine.
import { labCascade, rng, type LabInput } from './run';
import { HAZARDS, roman } from './hazardMeta';
import type { HazardConfig, LabGrid, LngLat, PlantHazard, PlantOutage, WhatIfResult } from '../../types';

const KM = 111.2, DEG = Math.PI / 180, STEPS = 48;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const smooth = (x: number) => { const u = clamp(x, 0, 1); return u * u * (3 - 2 * u); };
const kx = (lat: number) => KM * Math.cos(lat * DEG);
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : `${Math.round(n)}`);

interface Line { pts: LngLat[]; cum: number[]; total: number }
function line(pts: LngLat[]): Line {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot((pts[i][0] - pts[i - 1][0]) * kx((pts[i][1] + pts[i - 1][1]) / 2), (pts[i][1] - pts[i - 1][1]) * KM));
  return { pts, cum, total: cum[cum.length - 1] || 1 };
}
/** Distance (km) from a point to the polyline and the along-line position (km) of the closest point. */
function near(l: Line, lon: number, lat: number) {
  const sx = kx(lat);
  if (l.pts.length === 1) return { d: Math.hypot((lon - l.pts[0][0]) * sx, (lat - l.pts[0][1]) * KM), s: 0 };
  let d = Infinity, s = 0;
  for (let i = 1; i < l.pts.length; i++) {
    const [ax, ay] = l.pts[i - 1], [bx, by] = l.pts[i];
    const px = (lon - ax) * sx, py = (lat - ay) * KM, vx = (bx - ax) * sx, vy = (by - ay) * KM;
    const u = clamp((px * vx + py * vy) / (vx * vx + vy * vy || 1), 0, 1), di = Math.hypot(px - u * vx, py - u * vy);
    if (di < d) { d = di; s = l.cum[i - 1] + u * (l.cum[i] - l.cum[i - 1]); }
  }
  return { d, s };
}
/** Move a point dKm along a math-angle bearing (radians, 0 = east). */
const offset = ([lon, lat]: LngLat, dKm: number, ang: number): LngLat => [lon + (dKm * Math.cos(ang)) / kx(lat), lat + (dKm * Math.sin(ang)) / KM];
const bearing = (a: LngLat, b: LngLat) => Math.atan2((b[1] - a[1]) * KM, (b[0] - a[0]) * kx(a[1]));

type Outcome = { v: number; p: number; med: number };
interface Model {
  T: number; pad: number; dom: PlantHazard['dominant']; sd: number; ramp: number; extent: LngLat[];
  val: (lon: number, lat: number, t: number) => number;
  /** One ensemble member: returns the outcome at any site for that member's version of the event. */
  draw: (normal: () => number, uni: () => number) => (lon: number, lat: number) => Outcome;
  paths?: WhatIfResult['hazardPaths'];
  summary: { label: string; value: string; note?: string }[];
}

function quake(h: HazardConfig, track: LngLat[]): Model {
  const M = h.intensity, depth = h.extent, epi = track[0], ang = bearing(epi, track[1] ?? [epi[0] - 1, epi[1] - 1]);
  const L = Math.min(900, 10 ** (-2.44 + 0.59 * M)); // Wells & Coppersmith (1994) rupture length
  const fault = line([epi, offset(epi, L, ang)]), frag = HAZARDS.earthquake.fragility;
  const ceus = epi[0] > -105 ? 0.55 : 1; // stable continental crust carries shaking ~2× farther
  const mmi = (R: number, dM = 0) => clamp(1.5 * (M + dM) - 3.2 * Math.log10(Math.hypot(R * ceus, depth) + 20) + 1.8, 0, 12);
  const reach = (level: number) => Math.max(0, (10 ** ((1.5 * M + 1.8 - level) / 3.2) - 20) / ceus);
  const far = Math.min(1100, reach(4.5)); // below MMI 4.5 the legend is transparent
  return {
    T: 240, pad: 0, dom: 'quake', sd: 0.5, ramp: 1.6, extent: [offset(epi, far, 0), offset(epi, far, Math.PI / 2), offset(epi, far, Math.PI), offset(epi, far, -Math.PI / 2)],
    val: (lon, lat, t) => (Math.hypot((lon - epi[0]) * kx(lat), (lat - epi[1]) * KM) <= 3.5 * t ? mmi(near(fault, lon, lat).d) : 0),
    draw: (normal) => {
      const dM = 0.12 * normal(), shift = 8 * normal();
      return (lon, lat) => { const v = mmi(Math.max(0, near(fault, lon, lat).d + shift), dM) + 0.45 * normal(); return { v, p: frag(v), med: 10 * Math.exp(0.6 * (v - 6)) }; };
    },
    paths: [{ path: fault.pts, start: 0, end: 0, level: -1 }],
    summary: [
      { label: 'Magnitude', value: `M${M.toFixed(1)}`, note: `${Math.round(L)} km rupture · ${depth} km deep` },
      { label: 'Peak shaking', value: `MMI ${roman(mmi(0))}`, note: 'along the fault' },
      { label: 'Strong shaking reach', value: `${Math.round(reach(7))} km`, note: ceus < 1 ? 'MMI VII+; central-US crust carries it far' : 'MMI VII+' },
    ],
  };
}

function wildfire(h: HazardConfig, track: LngLat[]): Model {
  const W = h.intensity, D = h.extent / 100, T = h.durationH, ign = track[0], ang0 = bearing(ign, track[1] ?? [ign[0] - 0.3, ign[1] - 0.3]);
  const ros0 = 0.2 + 0.05 * W ** 1.15 * D * D; // head-fire spread, km/h
  const LB = 1 + 0.11 * W ** 0.8; // length-to-breadth ratio of the burn ellipse
  const run = (t: number, ros = ros0) => ros * 14 * (1 - Math.exp(-t / 14)) + 0.4; // slows as winds ease and crews engage
  const frag = HAZARDS.wildfire.fragility;
  const impact = (lon: number, lat: number, t: number, ang: number, ros: number) => {
    const L = run(t, ros), a = L / 2, b = Math.max(0.3, a / LB);
    const x = (lon - ign[0]) * kx(ign[1]), y = (lat - ign[1]) * KM;
    const u = x * Math.cos(ang) + y * Math.sin(ang), v = -x * Math.sin(ang) + y * Math.cos(ang);
    const e = Math.hypot((u - a + 0.4) / a, v / b);
    let f = e <= 1 ? 1 : 0.62 * Math.exp(-(e - 1) / 0.22); // burn, then ember-cast evacuation fringe
    // Smoke and utility power shutoffs reach tens of km downwind of the head.
    if (u > 0 && t > 0) f = Math.max(f, 0.3 * Math.exp(-Math.max(0, u - L) / 55) * Math.exp(-((v / (5 + 0.3 * u)) ** 2)));
    return f;
  };
  const Lmax = run(T), area = Math.PI * (Lmax / 2) * Math.max(0.3, Lmax / 2 / LB);
  return {
    T, pad: 0.6, dom: 'fire', sd: 0.45, ramp: 1.3, extent: [ign, offset(ign, Lmax + 70, ang0), offset(ign, 25, ang0 + Math.PI / 2), offset(ign, 25, ang0 - Math.PI / 2), offset(ign, 10, ang0 + Math.PI)],
    val: (lon, lat, t) => impact(lon, lat, t, ang0, ros0),
    draw: (normal) => {
      const ang = ang0 + 0.17 * normal(), ros = ros0 * Math.exp(0.2 * normal());
      return (lon, lat) => { const v = impact(lon, lat, T, ang, ros); return { v, p: frag(v), med: 4 + 140 * v ** 3 }; };
    },
    paths: [{ path: [ign], start: 0, end: 0, level: -1 }],
    summary: [
      { label: 'Fire run', value: `${Math.round(Lmax)} km`, note: `${W} mph winds · head fire ${ros0.toFixed(1)} km/h` },
      { label: 'Burned area', value: `${compact(area * 247.1)} acres`, note: `${Math.round(area)} km²` },
      { label: 'Smoke & power shutoffs', value: `~${Math.round(Lmax + 60)} km`, note: 'downwind of ignition' },
    ],
  };
}

function flood(h: HazardConfig, track: LngLat[]): Model {
  const C = h.intensity, T = h.durationH, river = line(track), W = 2 + 0.35 * C, frag = HAZARDS.flood.fragility;
  const depth = (d: number, c = C, w = W) => (d > 3 * w ? 0 : c * Math.exp((-1.6 * d) / w));
  const arrive = (s: number) => (s / river.total) * 0.55 * T, rise = 0.18 * T, hold = 0.3 * T;
  const stage = (s: number, t: number) => smooth((t - arrive(s)) / rise) * (1 - smooth((t - arrive(s) - rise - hold) / (0.35 * T)));
  return {
    T, pad: 0.5, dom: 'flood', sd: 0.4, ramp: 2, extent: track,
    val: (lon, lat, t) => { const n = near(river, lon, lat); return n.d > 3 * W ? 0 : depth(n.d) * stage(n.s, t); },
    draw: (normal) => {
      const c = C * Math.exp(0.18 * normal()), w = W * Math.exp(0.2 * normal());
      return (lon, lat) => { const v = depth(near(river, lon, lat).d, c, w); return { v, p: frag(v), med: 25 + 14 * v }; };
    },
    paths: [{ path: track, start: 0, end: T, level: -1 }],
    summary: [
      { label: 'Crest', value: `+${C} ft`, note: 'above flood stage' },
      { label: 'River reach', value: `${Math.round(river.total)} km`, note: `crest moves ${(river.total / (0.55 * T)).toFixed(1)} km/h` },
      { label: 'Floodplain', value: `${Math.round(2 * W)} km wide`, note: 'at 20% of crest depth' },
    ],
  };
}

const EF_WIDTH = [0.05, 0.1, 0.25, 0.5, 0.9, 1.5]; // km
const EF_DAYS = [5, 10, 35, 90, 120, 150];
function tornado(h: HazardConfig, track: LngLat[], seed: number): Model {
  const E = clamp(Math.round(h.intensity), 0, 5), N = Math.round(h.extent), T = h.durationH, main = line(track);
  const ang = bearing(track[0], track[track.length - 1]);
  type Twister = { l: Line; ef: number; start: number; end: number; box: [number, number, number, number] };
  const build = (pts: LngLat[], ef: number, start: number, end: number): Twister => {
    const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
    return { l: line(pts), ef, start, end, box: [Math.min(...lons) - 1.3, Math.min(...lats) - 1.1, Math.max(...lons) + 1.3, Math.max(...lats) + 1.1] };
  };
  // The drawn path is the strongest tornado; the rest spin up along the same corridor, mostly weaker.
  const outbreak = (normal: () => number, uni: () => number, shiftKm: number): Twister[] => {
    const lead = track.map((p) => offset(p, shiftKm, ang + Math.PI / 2));
    const list = [build(lead, E, 0.25 * T, 0.6 * T)];
    for (let i = 1; i < N; i++) {
      const u = uni() * 1.6 - 0.3, ef = Math.min(E, Math.floor(uni() ** 1.7 * (E + 1)));
      const alongPt = offset(track[0], u * main.total, ang), start = offset(alongPt, 70 * normal(), ang + Math.PI / 2);
      const len = 3 + (8 + 22 * ef) * (0.5 + uni()), a = ang + 0.25 * normal(), t0 = clamp((u + 0.3) / 1.6, 0, 1) * 0.85 * T;
      list.push(build([start, offset(start, len, a)], ef, t0, Math.min(T, t0 + len / 55)));
    }
    return list;
  };
  const cr = rng(seed), control = outbreak(cr.normal, cr.uni, 0);
  const val = (lon: number, lat: number, t: number) => {
    let sum = 0;
    for (const tw of control) {
      if (t < tw.start || lon < tw.box[0] || lon > tw.box[2] || lat < tw.box[1] || lat > tw.box[3]) continue;
      sum += (0.08 + 0.06 * tw.ef) * Math.exp(-((near(tw.l, lon, lat).d / 40) ** 2)) * smooth((t - tw.start) / Math.max(0.1, tw.end - tw.start));
    }
    return Math.min(0.9, sum);
  };
  const all = control.flatMap((tw) => tw.l.pts);
  return {
    T, pad: 0.8, dom: 'tornado', sd: 0.4, ramp: 1.5, extent: all,
    val,
    draw: (normal, uni) => {
      const list = outbreak(normal, uni, 1.2 * normal());
      return (lon, lat) => {
        let v = -1, p = 0, med = 0;
        for (const tw of list) {
          if (lon < tw.box[0] || lon > tw.box[2] || lat < tw.box[1] || lat > tw.box[3]) continue;
          const d = near(tw.l, lon, lat).d;
          if (d < EF_WIDTH[tw.ef] / 2 + 0.15) { const q = tw.ef >= 3 ? 0.97 : tw.ef === 2 ? 0.8 : 0.5; if (q > p) { p = q; v = tw.ef; med = EF_DAYS[tw.ef]; } }
          else if (d < 4 && p < 0.3) { p = 0.3; v = Math.max(v, -0.5); med = 6; }
        }
        return { v, p, med };
      };
    },
    paths: control.map((tw) => ({ path: tw.l.pts, start: tw.start, end: tw.end, level: tw.ef })),
    summary: [
      { label: 'Tornadoes', value: `${N}`, note: `${control.filter((t) => t.ef >= 3).length} rated EF3 or stronger` },
      { label: 'Strongest', value: `EF${E}`, note: `${Math.round(main.total)} km path · ${Math.round(EF_WIDTH[E] * 1000)} m wide` },
      { label: 'Outbreak window', value: `${T} h` },
    ],
  };
}

function winter(h: HazardConfig, track: LngLat[]): Model {
  const I = h.intensity, T = h.durationH, band = line(track), HALF = 110, frag = HAZARDS.winter.fragility;
  const arrive = (s: number) => (s / band.total) * 0.6 * T;
  return {
    T, pad: 2.6, dom: 'ice', sd: 0.5, ramp: 1, extent: track,
    val: (lon, lat, t) => { const n = near(band, lon, lat); return n.d > 3 * HALF ? 0 : I * Math.exp(-((n.d / HALF) ** 2)) * smooth((t - arrive(n.s)) / (0.35 * T)); },
    draw: (normal) => {
      const i = I * Math.exp(0.25 * normal()), hw = HALF * Math.exp(0.2 * normal()), shift = 25 * normal();
      return (lon, lat) => {
        const d = near(band, lon, lat).d, v = i * Math.exp(-((Math.max(0, d + shift) / hw) ** 2));
        // Cold far beyond the ice strains the grid (Uri 2021: rolling blackouts statewide).
        const grid = 0.3 * Math.exp(-((d / 300) ** 2)) * Math.min(1, I);
        return { v, p: 1 - (1 - frag(v)) * (1 - grid), med: 3 + 18 * v + 6 * grid };
      };
    },
    paths: [{ path: track, start: 0, end: T, level: -1 }],
    summary: [
      { label: 'Ice accretion', value: `${I.toFixed(2)} in`, note: I >= 1 ? 'catastrophic: towers and lines fail' : I >= 0.5 ? 'widespread outages' : 'scattered outages' },
      { label: 'Band length', value: `${Math.round(band.total)} km`, note: `${Math.round(2 * HALF)} km wide` },
      { label: 'Grid stress', value: '~300 km', note: 'rolling blackouts beyond the ice' },
    ],
  };
}

const quantile = (sorted: ArrayLike<number>, q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

export function runHazard(input: LabInput): WhatIfResult {
  const t0 = performance.now(), { req } = input, h = req.hazard!, seed = req.lab?.seed ?? 20241;
  if (req.track.length < 2 || req.track.some(([x, y]) => !Number.isFinite(x + y))) throw new Error('Place at least two points on the map.');
  const model = h.kind === 'earthquake' ? quake(h, req.track) : h.kind === 'wildfire' ? wildfire(h, req.track) : h.kind === 'flood' ? flood(h, req.track)
    : h.kind === 'tornado' ? tornado(h, req.track, seed) : winter(h, req.track);

  // Grid around the footprint, as fine as ~26k cells allow.
  const lons = [...model.extent, ...req.track].map((p) => p[0]), lats = [...model.extent, ...req.track].map((p) => p[1]);
  const west = Math.min(...lons) - model.pad, east = Math.max(...lons) + model.pad, south = Math.max(-10, Math.min(...lats) - model.pad), north = Math.min(62, Math.max(...lats) + model.pad);
  const res = clamp(Math.sqrt(((east - west) * (north - south)) / 26000), 0.015, 0.15);
  const nx = Math.ceil((east - west) / res), ny = Math.ceil((north - south) / res), cells = nx * ny;
  const snapshots: { hour: number; values: Float32Array }[] = [], peak = new Float32Array(cells);
  for (let k = 0; k <= STEPS; k++) {
    const hour = (k * model.T) / STEPS, values = new Float32Array(cells);
    for (let r = 0; r < ny; r++) {
      const lat = north - (r + 0.5) * res;
      for (let c = 0; c < nx; c++) { const v = model.val(west + (c + 0.5) * res, lat, hour); values[r * nx + c] = v; if (v > peak[r * nx + c]) peak[r * nx + c] = v; }
    }
    snapshots.push({ hour, values });
  }
  const grid: LabGrid = { west, north, east: west + nx * res, south: north - ny * res, nx, ny, values: peak };

  // Ensemble: every member is a different version of the event.
  const M = Math.round(clamp(req.members ?? 1000, 200, 1000)), nS = input.plants.length, { uni, normal } = rng(seed + 7);
  const restart = Array.from({ length: nS }, () => new Float32Array(M)), ramp = Array.from({ length: nS }, () => new Float32Array(M));
  const probM = Array.from({ length: nS }, () => new Float32Array(M)), valM = Array.from({ length: nS }, () => new Float32Array(M));
  const hits = new Uint32Array(nS);
  for (let m = 0; m < M; m++) {
    const at = model.draw(normal, uni);
    input.plants.forEach((p, k) => {
      const o = at(p.lon, p.lat);
      probM[k][m] = o.p; valM[k][m] = o.v;
      if (uni() < o.p) { hits[k]++; restart[k][m] = Math.max(1, o.med * Math.exp(model.sd * normal())); ramp[k][m] = restart[k][m] * model.ramp; }
    });
  }
  const domCount = input.plants.map((_, k) => ({ [model.dom]: hits[k] }));
  const cell = (lon: number, lat: number) => { const c = Math.floor((lon - west) / res), r = Math.floor((north - lat) / res); return c >= 0 && r >= 0 && c < nx && r < ny ? r * nx + c : -1; };
  const plantHazards: PlantHazard[] = [], outages: PlantOutage[] = [];
  input.plants.forEach((p, k) => {
    const pp = Float32Array.from(probM[k]).sort(), vv = Float32Array.from(valM[k]).sort();
    let mean = 0;
    for (const v of probM[k]) mean += v;
    mean /= M;
    const durs = Array.from(restart[k]).filter((d) => d > 0).sort((a, b) => a - b);
    const days = { p10: Math.round(durs.length ? quantile(durs, 0.1) : 0), p50: Math.round(durs.length ? quantile(durs, 0.5) : 0), p90: Math.round(durs.length ? quantile(durs, 0.9) : 0) };
    const i = cell(p.lon, p.lat), top = i >= 0 ? peak[i] : 0;
    const when = i >= 0 && top > 0 ? snapshots.find((s) => s.values[i] >= 0.5 * top)?.hour ?? 0 : 0;
    const ci: [number, number] = [r3(quantile(pp, 0.1)), r3(quantile(pp, 0.9))];
    plantHazards.push({ plantId: p.id, windKt: [0, 0, 0], rainIn: [0, 0, 0], tornado: h.kind === 'tornado' ? r3(mean) : 0, pDisrupt: r3(mean), ci,
      dominant: mean < 0.02 ? 'none' : model.dom, outageDays: days, peakHour: when, intensity: r3(quantile(vv, 0.5)) });
    outages.push({ plantId: p.id, pDisrupt: r3(mean), ci, outageDays: days });
  });
  const cascade = labCascade(input.drugs, input.plants, input.hospitals, restart, ramp, M, domCount);
  const n = STEPS + 1, zeros = Array(n).fill(0), at0 = req.track[0];
  return {
    engine: 'browser', elapsedMs: Math.round(performance.now() - t0), members: M, sampleTracks: [], cone: [], conePolys: [],
    outages, plantHazards, ...cascade, fields: { hazard: grid }, hazardSnapshots: snapshots,
    hazardKind: h.kind, hazardPaths: model.paths, hazardSummary: model.summary,
    series: { hours: snapshots.map((s) => s.hour), lon: Array(n).fill(at0[0]), lat: Array(n).fill(at0[1]), vmax: { p10: zeros, p50: zeros, p90: zeros }, ctrl: zeros,
      pc: Array(n).fill(1010), rmwKm: zeros, land: Array(n).fill(true), landfalls: [] },
    diagnostics: { seed, gridKm: Math.round(res * 111), gridCells: cells, steps: n, fieldMembers: M, terrain: 'not used', timingsMs: { total: Math.round(performance.now() - t0) },
      params: { members: M, intensity: h.intensity, extent: h.extent, durationH: model.T }, warnings: [] },
  };
}

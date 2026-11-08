// Storm Lab engine: control run on a grid + N-member ensemble → hazard fields, plant fragility, supply cascade.
import type { Band, Drug, DrugRisk, Hospital, LabGrid, LngLat, Plant, PlantHazard, PlantOutage, StormFix, WhatIfRequest, WhatIfResult } from '../../types';
import { CATEGORY_VMAX, DEFAULT_ERRORS, DEFAULT_LAB, type LabConfig, type Phys } from './params';
import { clamp, flowStep, KM_PER_DEG_LAT, KT, kmPerDegLon, orographicAdd, rainRate, rainStep, shearFactor, shearStep, symmetricVmax, tornadoPotential, windStep, windVec } from './physics';
import { buildPath, deriveTrack, type Path, type Track } from './track';
import { gradAt, isLand, reliefAt, type Terrain } from './terrain';
import { impactFromStockouts } from '../ensemble';
import { contours } from 'd3-contour';

export interface LabInput {
  req: WhatIfRequest;
  plants: Plant[];
  drugs: Drug[];
  hospitals: Hospital[];
  phys: Phys;
  errors: typeof DEFAULT_ERRORS;
  terrain: Terrain;
  coef?: { order: string[]; samples: number[][] } | null;
}

/** Expert-informed priors for plant fragility (logit scale). Order matches HazardModelFile.featureOrder. */
export const FRAGILITY_PRIORS = [
  { key: 'intercept', mean: -3.4, sd: 0.4, why: 'Calibrated to Maria 2017 and Helene 2024: a direct hit stops nearly every sterile plant, even hardened ones.' },
  { key: 'wind', mean: 4.2, sd: 0.5, why: 'Per 50 kt of site wind above 50 kt: roof/cladding damage, cleanroom breach and weeks of grid loss (Maria: 11 months to restore power).' },
  { key: 'rain', mean: 0.9, sd: 0.3, why: 'General rainfall (log scale): access roads, staff who cannot reach the site, water and steam utilities.' },
  { key: 'rainRiver', mean: 3.2, sd: 0.5, why: 'Rain near a river drives inundation, the North Cove (Helene 2024) failure mode that removed 60% of US IV fluid.' },
  { key: 'sfha', mean: 1.2, sd: 0.4, why: 'Inside a FEMA Special Flood Hazard Area, the same rain floods more often.' },
  { key: 'tornado', mean: 3.0, sd: 0.5, why: 'Probability of a tornado within 25 mi; Rocky Mount 2023 destroyed 50,000 pallets of injectables in minutes.' },
] as const;

const SOIL = { dry: 0.75, normal: 1, wet: 1.35 } as const;

export function rng(seed: number) {
  let a = seed >>> 0 || 1;
  const uni = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = NaN;
  const normal = () => {
    if (!Number.isNaN(spare)) { const s = spare; spare = NaN; return s; }
    const u = Math.max(1e-12, uni()), v = uni(), r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  return { uni, normal };
}

const interp = (xs: number[], ys: number[], x: number) => {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
  return ys[ys.length - 1] + ((ys[ys.length - 1] - ys[ys.length - 2]) * (x - xs[xs.length - 1])) / (xs[xs.length - 1] - xs[xs.length - 2]);
};

const quantile = (sorted: ArrayLike<number>, q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
const r3 = (x: number) => Math.round(x * 1000) / 1000;

interface GridSpec { west: number; north: number; res: number; nx: number; ny: number; lon: Float64Array; lat: Float64Array; land: Uint8Array; gx: Float32Array; gy: Float32Array }

function makeGrid(p: Path, t: Terrain): GridSpec {
  let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
  for (let i = 0; i < p.n; i++) { w = Math.min(w, p.lon[i]); e = Math.max(e, p.lon[i]); s = Math.min(s, p.lat[i]); n = Math.max(n, p.lat[i]); }
  w = Math.max(-130, w - 7); e = Math.min(-10, e + 7); s = Math.max(2, s - 6); n = Math.min(60, n + 6);
  const res = Math.round(clamp(Math.sqrt(((e - w) * (n - s)) / 17000), 0.08, 0.3) * 100) / 100;
  const nx = Math.ceil((e - w) / res), ny = Math.ceil((n - s) / res);
  const lon = new Float64Array(nx), lat = new Float64Array(ny), land = new Uint8Array(nx * ny);
  const gx = new Float32Array(nx * ny), gy = new Float32Array(nx * ny);
  for (let c = 0; c < nx; c++) lon[c] = w + (c + 0.5) * res;
  for (let r = 0; r < ny; r++) lat[r] = n - (r + 0.5) * res;
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    const i = r * nx + c;
    land[i] = isLand(t, lon[c], lat[r]) ? 1 : 0;
    if (land[i] && t.elev) [gx[i], gy[i]] = gradAt(t, lon[c], lat[r]);
  }
  return { west: w, north: n, res, nx, ny, lon, lat, land, gx, gy };
}

const grid = (g: GridSpec, values: Float32Array): LabGrid => ({ west: g.west, north: g.north, east: g.west + g.nx * g.res, south: g.north - g.ny * g.res, nx: g.nx, ny: g.ny, values });

/** Accumulate one storm (control or member) onto grid arrays. */
function sweep(tr: Track, g: GridSpec, P: Phys, cfg: LabConfig, stride: number, cutKm: number, out: { wind: Float32Array; rain: Float32Array; tor?: Float32Array },
  snap?: (h: number) => void) {
  const vec: [number, number] = [0, 0], sh = shearStep(cfg.shearKt, cfg.shearDirDeg, P);
  for (let h = 0; h < tr.n; h += stride) {
    const vs = symmetricVmax(tr.vmax[h], tr.ux[h], tr.uy[h], P);
    const ws = windStep(vs, tr.rmw[h], tr.B[h], tr.lat[h], P.sfcWater);
    const fs = flowStep(tr.ux[h], tr.uy[h], vs, tr.land[h] === 1, P);
    const rs = rainStep(tr.vmax[h], P), kx = kmPerDegLon(tr.lat[h]);
    const h2 = Math.min(tr.n - 1, h + stride);
    const ax = 0, ay = 0, bx = (tr.lon[h2] - tr.lon[h]) * kx, by = (tr.lat[h2] - tr.lat[h]) * KM_PER_DEG_LAT, bb = bx * bx + by * by || 1;
    const dLat = cutKm / KM_PER_DEG_LAT, dLon = cutKm / kx;
    const r0 = Math.max(0, Math.floor((g.north - (tr.lat[h] + dLat)) / g.res)), r1 = Math.min(g.ny - 1, Math.ceil((g.north - (tr.lat[h] - dLat)) / g.res));
    const c0 = Math.max(0, Math.floor((tr.lon[h] - dLon - g.west) / g.res)), c1 = Math.min(g.nx - 1, Math.ceil((tr.lon[h] + dLon - g.west) / g.res));
    const hours = Math.min(stride, tr.n - h), landCentre = tr.land[h] === 1;
    for (let r = r0; r <= r1; r++) {
      const dy = (g.lat[r] - tr.lat[h]) * KM_PER_DEG_LAT;
      for (let c = c0; c <= c1; c++) {
        const dx = (g.lon[c] - tr.lon[h]) * kx;
        const d2 = dx * dx + dy * dy;
        if (d2 > cutKm * cutKm) continue;
        const i = r * g.nx + c;
        // Closest approach on this segment avoids "beading" between steps.
        const u = clamp(((dx - ax) * bx + (dy - ay) * by) / bb, 0, 1);
        let w = windVec(dx - u * bx, dy - u * by, ws, fs, vec);
        if (g.land[i] && !landCentre) w *= P.landFactor;
        if (w > out.wind[i]) out.wind[i] = w;
        const rr = Math.sqrt(d2);
        let rate = rainRate(rr, rs) * shearFactor(dx, dy, rr, sh);
        // Reuses the wind vector just computed (closest approach) for the upslope term.
        if (cfg.orographic && g.land[i] && (g.gx[i] || g.gy[i])) rate += orographicAdd(vec[0] * KT, vec[1] * KT, g.gx[i], g.gy[i], P);
        out.rain[i] += (rate / 24) * hours;
        if (out.tor && g.land[i]) out.tor[i] += 0.045 * hours * tornadoPotential(dx, dy, tr.ux[h], tr.uy[h], tr.sinceLandfall[h], tr.vmax[h], cfg.shearKt, P);
      }
    }
    snap?.(h);
  }
}

interface SiteGeo { lon: number; lat: number; riverKm: number; sfha: boolean; relief: number; gx: number; gy: number }

/** Max wind, rain and tornado exposure for each plant along one track. */
function siteHazards(tr: Track, sites: SiteGeo[], P: Phys, cfg: LabConfig, wind: Float32Array, rain: Float32Array, tor: Float32Array, peak?: Int16Array) {
  const vec: [number, number] = [0, 0], sh = shearStep(cfg.shearKt, cfg.shearDirDeg, P);
  wind.fill(0); rain.fill(0); tor.fill(0);
  for (let h = 0; h < tr.n; h++) {
    let near = false;
    const kx = kmPerDegLon(tr.lat[h]);
    for (const s of sites) if (Math.abs(s.lat - tr.lat[h]) < 7 && Math.abs(s.lon - tr.lon[h]) < 8) { near = true; break; }
    if (!near) continue;
    const vs = symmetricVmax(tr.vmax[h], tr.ux[h], tr.uy[h], P);
    const ws = windStep(vs, tr.rmw[h], tr.B[h], tr.lat[h], P.sfcWater);
    const fs = flowStep(tr.ux[h], tr.uy[h], vs, tr.land[h] === 1, P), rs = rainStep(tr.vmax[h], P);
    const h2 = Math.min(tr.n - 1, h + 1), bx = (tr.lon[h2] - tr.lon[h]) * kx, by = (tr.lat[h2] - tr.lat[h]) * KM_PER_DEG_LAT, bb = bx * bx + by * by || 1;
    for (let k = 0; k < sites.length; k++) {
      const s = sites[k];
      const dx = (s.lon - tr.lon[h]) * kx, dy = (s.lat - tr.lat[h]) * KM_PER_DEG_LAT, rr = Math.sqrt(dx * dx + dy * dy);
      if (rr > 800) continue;
      const u = clamp((dx * bx + dy * by) / bb, 0, 1);
      const w = windVec(dx - u * bx, dy - u * by, ws, fs, vec) * (tr.land[h] ? 1 : P.landFactor);
      if (w > wind[k]) { wind[k] = w; if (peak) peak[k] = h; }
      let rate = rainRate(rr, rs) * shearFactor(dx, dy, rr, sh);
      if (cfg.orographic && (s.gx || s.gy)) rate += orographicAdd(vec[0] * KT, vec[1] * KT, s.gx, s.gy, P);
      rain[k] += rate / 24;
      tor[k] += 0.045 * tornadoPotential(dx, dy, tr.ux[h], tr.uy[h], tr.sinceLandfall[h], tr.vmax[h], cfg.shearKt, P);
    }
  }
}

function coefSamples(input: LabInput, normal: () => number): Float64Array[] {
  const order = FRAGILITY_PRIORS.map((p) => p.key);
  const given = input.coef;
  if (given && given.samples.length >= 50 && order.every((k) => given.order.includes(k)))
    return given.samples.map((row) => Float64Array.from(order.map((k) => row[given.order.indexOf(k)])));
  // Prior-predictive draws (no labelled control cohort exists for plant outages; see model card).
  return Array.from({ length: 400 }, () => Float64Array.from(FRAGILITY_PRIORS.map((p) => p.mean + p.sd * normal())));
}

export function runLab(input: LabInput): WhatIfResult {
  const t0 = performance.now(), timings: Record<string, number> = {}, warnings: string[] = [];
  const mark = (k: string, since: number) => (timings[k] = Math.round(performance.now() - since));
  const { req, phys: P, terrain } = input;
  if (req.track.length < 2 || req.track.length > 400 || req.track.some(([x, y]) => !Number.isFinite(x + y) || Math.abs(y) > 60 || Math.abs(x) > 180))
    throw new Error('Place between 2 and 400 valid track points.');
  const cfg: LabConfig = { ...DEFAULT_LAB, vmaxKt: CATEGORY_VMAX[req.category] ?? DEFAULT_LAB.vmaxKt, ...(req.lab ?? {}) };
  cfg.members = Math.round(clamp(req.members ?? cfg.members, 100, 2000));
  const fixes: StormFix[] = req.track.map(([lon, lat], i) => {
    const f = req.fixes && req.fixes.length === req.track.length ? req.fixes[i] : undefined;
    return { ...(f ?? {}), lon, lat };
  });
  const { uni, normal } = rng(cfg.seed);
  let s = performance.now();
  const path = buildPath(fixes, cfg, req.forwardSpeedKt, P, terrain);
  const ctrl = deriveTrack(path, cfg, P, terrain);
  if (!terrain.elev && cfg.orographic) warnings.push('Terrain elevation unavailable — orographic rain enhancement is off.');
  const g = makeGrid(path, terrain);
  mark('setup', s);

  // ---------- control run on the grid ----------
  s = performance.now();
  const cells = g.nx * g.ny;
  const cWind = new Float32Array(cells), cRain = new Float32Array(cells), cTor = new Float32Array(cells);
  const rainSnapshots: { hour: number; values: Float32Array }[] = [], windSnapshots: { hour: number; values: Float32Array }[] = [];
  sweep(ctrl, g, P, cfg, 1, 650, { wind: cWind, rain: cRain, tor: cTor }, (h) => {
    if (h % 6 === 0 || h === ctrl.n - 1) { rainSnapshots.push({ hour: h, values: cRain.slice() }); windSnapshots.push({ hour: h, values: cWind.slice() }); }
  });
  for (let i = 0; i < cells; i++) cTor[i] = 1 - Math.exp(-cTor[i]);
  mark('control', s);

  // ---------- sites ----------
  const sites: SiteGeo[] = input.plants.map((p) => {
    const [gx, gy] = gradAt(terrain, p.lon, p.lat);
    return { lon: p.lon, lat: p.lat, riverKm: p.riverDistKm ?? 2, sfha: /^[AV]/.test(p.floodZone ?? ''), relief: reliefAt(terrain, p.lon, p.lat), gx, gy };
  });
  if (input.plants.some((p) => p.riverDistKm == null)) warnings.push('Some plants lack river-distance data; 2 km assumed.');

  // ---------- ensemble ----------
  s = performance.now();
  const M = cfg.members, nS = sites.length, n = path.n;
  const coef = coefSamples(input, normal);
  const fieldMembers = Math.min(M, 80);
  const cnt34 = new Uint16Array(cells), cnt50 = new Uint16Array(cells), cnt64 = new Uint16Array(cells), cntRain = new Uint16Array(cells);
  const mWind = new Float32Array(cells), mRain = new Float32Array(cells);
  const siteWind = new Float32Array(nS), siteRain = new Float32Array(nS), siteTor = new Float32Array(nS);
  const windM = Array.from({ length: nS }, () => new Float32Array(M)), rainM = Array.from({ length: nS }, () => new Float32Array(M));
  const torM = Array.from({ length: nS }, () => new Float32Array(M)), probM = Array.from({ length: nS }, () => new Float32Array(M));
  const restart = Array.from({ length: nS }, () => new Float32Array(M)), ramp = Array.from({ length: nS }, () => new Float32Array(M));
  const domCount = Array.from({ length: nS }, () => ({ wind: 0, flood: 0, tornado: 0 }));
  const vSorted = Array.from({ length: n }, () => new Float32Array(M)), dist = Array.from({ length: n }, () => new Float32Array(M));
  const samples: LngLat[][] = [];
  const sig = (h: number) => (interp(input.errors.leadHours, input.errors.coneRadiusNm, h) * 1.852 * cfg.trackErrorScale) / Math.sqrt(2 * Math.log(3));
  const sigV = (h: number) => interp(input.errors.leadHours, input.errors.intensityErrorKt, h) * cfg.intensityErrorScale;
  const soil = SOIL[cfg.soilMoisture];
  const knots = Math.ceil(n / 24) + 2;
  const kc = new Float64Array(knots), ka = new Float64Array(knots), kv = new Float64Array(knots);
  for (let m = 0; m < M; m++) {
    const lon = new Float64Array(n), lat = new Float64Array(n), noise = new Float32Array(n);
    // Smooth, unit-variance error curves: a coherent part (the fan of the cone) plus a slowly varying part
    // with knots every 24 h and smoothstep interpolation, so member motion never jitters hour to hour.
    const zc = normal(), za = normal(), zv = normal();
    for (let k = 0; k < knots; k++) { kc[k] = normal(); ka[k] = normal(); kv[k] = normal(); }
    for (let h = 0; h < n; h++) {
      const k = Math.floor(h / 24), f = (h % 24) / 24, wgt = f * f * (3 - 2 * f);
      const xc = 0.8 * zc + 0.6 * (kc[k] + (kc[k + 1] - kc[k]) * wgt), xa = 0.8 * za + 0.6 * (ka[k] + (ka[k + 1] - ka[k]) * wgt);
      const xv = 0.7 * zv + 0.71 * (kv[k] + (kv[k + 1] - kv[k]) * wgt);
      const sp = Math.hypot(ctrl.ux[h], ctrl.uy[h]) || 1, ax = ctrl.ux[h] / sp, ay = ctrl.uy[h] / sp; // along-track unit
      const off = sig(h), ex = xa * ax - xc * ay, ny = xa * ay + xc * ax; // cross-track = left-normal
      lon[h] = ctrl.lon[h] + (off * ex) / kmPerDegLon(ctrl.lat[h]);
      lat[h] = ctrl.lat[h] + (off * ny) / KM_PER_DEG_LAT;
      noise[h] = sigV(h) * xv;
    }
    const tr = deriveTrack({ ...path, lon, lat }, cfg, P, terrain, noise, Math.exp(cfg.sizeSpread * normal()), { rmw: ctrl.rmw, B: ctrl.B });
    for (let h = 0; h < n; h++) {
      vSorted[h][m] = tr.vmax[h];
      dist[h][m] = Math.hypot((lon[h] - ctrl.lon[h]) * kmPerDegLon(ctrl.lat[h]), (lat[h] - ctrl.lat[h]) * KM_PER_DEG_LAT);
    }
    if (m < 40) { const pts: LngLat[] = []; for (let h = 0; h < n; h += 3) pts.push([r3(lon[h]), r3(lat[h])]); samples.push(pts); }
    if (m < fieldMembers) {
      mWind.fill(0); mRain.fill(0);
      sweep(tr, g, P, cfg, 3, 450, { wind: mWind, rain: mRain });
      for (let i = 0; i < cells; i++) {
        const w = mWind[i];
        if (w >= 34) { cnt34[i]++; if (w >= 50) { cnt50[i]++; if (w >= 64) cnt64[i]++; } }
        if (mRain[i] * soil >= P.floodIn) cntRain[i]++;
      }
    }
    siteHazards(tr, sites, P, cfg, siteWind, siteRain, siteTor);
    const c = coef[m % coef.length];
    for (let k = 0; k < nS; k++) {
      const st = sites[k];
      const rEff = siteRain[k] * soil * Math.min(1.6, 1 + st.relief / 1500);
      const w = Math.max(0, siteWind[k] - 50) / 50, rr = Math.log1p(rEff / 4), prox = Math.exp(-st.riverKm / 1.5);
      const torP = 1 - Math.exp(-siteTor[k]);
      const contrib = { wind: c[1] * w, flood: c[2] * rr + c[3] * rr * prox + c[4] * (st.sfha ? rr : 0), tornado: c[5] * torP };
      const p = 1 / (1 + Math.exp(-(c[0] + contrib.wind + contrib.flood + contrib.tornado)));
      windM[k][m] = siteWind[k]; rainM[k][m] = rEff; torM[k][m] = torP; probM[k][m] = p;
      if (uni() < p) {
        const dom = contrib.flood >= contrib.wind && contrib.flood >= contrib.tornado ? 'flood' : contrib.tornado > contrib.wind ? 'tornado' : 'wind';
        domCount[k][dom]++;
        // Days to first restart (lognormal) and ramp back to full output; calibrated to documented events.
        const med = dom === 'flood' ? 60 : dom === 'tornado' ? 90 : Math.max(4, 6 + 45 * w * w - cfg.backupPowerDays);
        const sd = dom === 'flood' ? 0.45 : dom === 'tornado' ? 0.4 : 0.6;
        restart[k][m] = med * Math.exp(sd * normal());
        ramp[k][m] = restart[k][m] * (dom === 'flood' ? 2.5 : dom === 'tornado' ? 1.5 : 1);
      }
    }
  }
  mark('ensemble', s);

  // ---------- summaries ----------
  s = performance.now();
  const peakIdx = new Int16Array(nS);
  siteHazards(ctrl, sites, P, cfg, siteWind, siteRain, siteTor, peakIdx);
  const plantHazards: PlantHazard[] = [], outages: PlantOutage[] = [];
  input.plants.forEach((p, k) => {
    const pw = Float32Array.from(windM[k]).sort(), pr = Float32Array.from(rainM[k]).sort(), pp = Float32Array.from(probM[k]).sort();
    let mean = 0;
    for (const v of probM[k]) mean += v;
    mean /= M;
    const durs = Array.from(restart[k]).filter((d) => d > 0).sort((a, b) => a - b);
    const dc = domCount[k], tot = dc.wind + dc.flood + dc.tornado;
    const dominant = tot === 0 || mean < 0.02 ? 'none' : dc.flood >= dc.wind && dc.flood >= dc.tornado ? 'flood' : dc.tornado > dc.wind ? 'tornado' : 'wind';
    const days = { p10: Math.round(durs.length ? quantile(durs, 0.1) : 0), p50: Math.round(durs.length ? quantile(durs, 0.5) : 0), p90: Math.round(durs.length ? quantile(durs, 0.9) : 0) };
    let torMean = 0;
    for (const v of torM[k]) torMean += v;
    plantHazards.push({ plantId: p.id, windKt: [Math.round(quantile(pw, 0.1)), Math.round(quantile(pw, 0.5)), Math.round(quantile(pw, 0.9))],
      rainIn: [r1(quantile(pr, 0.1)), r1(quantile(pr, 0.5)), r1(quantile(pr, 0.9))], tornado: r3(torMean / M),
      pDisrupt: r3(mean), ci: [r3(quantile(pp, 0.1)), r3(quantile(pp, 0.9))], dominant, outageDays: days, peakHour: peakIdx[k] });
    outages.push({ plantId: p.id, pDisrupt: r3(mean), ci: [r3(quantile(pp, 0.1)), r3(quantile(pp, 0.9))], outageDays: days });
  });
  const vBand: Band = { p10: [], p50: [], p90: [] };
  // Cone = union of circles enclosing 2/3 of members at each hour (NHC's construction), traced on the grid.
  const coneMask = new Float32Array(cells);
  for (let h = 0; h < n; h++) {
    const v = vSorted[h].sort();
    vBand.p10.push(Math.round(quantile(v, 0.1))); vBand.p50.push(Math.round(quantile(v, 0.5))); vBand.p90.push(Math.round(quantile(v, 0.9)));
    const r67 = Math.max(15, quantile(dist[h].sort(), 0.667)), kx = kmPerDegLon(ctrl.lat[h]);
    const r0 = Math.max(0, Math.floor((g.north - ctrl.lat[h] - r67 / KM_PER_DEG_LAT) / g.res)), r1 = Math.min(g.ny - 1, Math.ceil((g.north - ctrl.lat[h] + r67 / KM_PER_DEG_LAT) / g.res));
    const c0 = Math.max(0, Math.floor((ctrl.lon[h] - r67 / kx - g.west) / g.res)), c1 = Math.min(g.nx - 1, Math.ceil((ctrl.lon[h] + r67 / kx - g.west) / g.res));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++)
      if (((g.lon[c] - ctrl.lon[h]) * kx) ** 2 + ((g.lat[r] - ctrl.lat[h]) * KM_PER_DEG_LAT) ** 2 <= r67 * r67) coneMask[r * g.nx + c] = 1;
  }
  const coneRings = contours().size([g.nx, g.ny]).thresholds([0.5])(Array.from(coneMask))[0]?.coordinates ?? [];
  const conePolys = coneRings.map((poly) => poly.map((ring) => ring.map(([x, y]) => [r3(g.west + x * g.res), r3(g.north - y * g.res)] as LngLat)));
  const pct = (a: Uint16Array, d: number) => { const o = new Float32Array(cells); for (let i = 0; i < cells; i++) o[i] = a[i] / d; return o; };
  const fields = {
    p34: grid(g, pct(cnt34, fieldMembers)), p50: grid(g, pct(cnt50, fieldMembers)), p64: grid(g, pct(cnt64, fieldMembers)),
    wind: grid(g, cWind), rain: grid(g, cRain), pRain: grid(g, pct(cntRain, fieldMembers)), tornado: grid(g, cTor),
  };
  const cascade = labCascade(input.drugs, input.plants, input.hospitals, restart, ramp, M, domCount);
  mark('cascade', s);
  // Landfall intensity is the last over-water value, as in the official record.
  const landfalls = ctrl.landfalls.map((h) => ({ hour: h, lon: r3(ctrl.lon[h]), lat: r3(ctrl.lat[h]), vmaxKt: Math.round(ctrl.vmax[Math.max(0, h - 1)]) }));
  const step = Math.max(1, Math.round(n / 160));
  const idx = Array.from({ length: Math.ceil(n / step) }, (_, i) => i * step);
  return {
    engine: 'browser', elapsedMs: Math.round(performance.now() - t0), members: M, sampleTracks: samples, cone: conePolys[0] ?? [], conePolys,
    outages, plantHazards, ...cascade, fields, rainSnapshots, windSnapshots,
    series: {
      hours: idx.map((h) => ctrl.hours[h]), startTime: req.startTime, lon: idx.map((h) => r3(ctrl.lon[h])), lat: idx.map((h) => r3(ctrl.lat[h])),
      vmax: { p10: idx.map((h) => vBand.p10[h]), p50: idx.map((h) => vBand.p50[h]), p90: idx.map((h) => vBand.p90[h]) },
      ctrl: idx.map((h) => Math.round(ctrl.vmax[h])),
      pc: idx.map((h) => Math.round(P.pEnv - ctrl.dp[h])), rmwKm: idx.map((h) => Math.round(ctrl.rmw[h])), land: idx.map((h) => ctrl.land[h] === 1), landfalls,
    },
    diagnostics: {
      seed: cfg.seed, gridKm: Math.round(g.res * 111), gridCells: cells, steps: n, fieldMembers, terrain: terrain.source,
      timingsMs: { ...timings, total: Math.round(performance.now() - t0) }, warnings,
      params: { members: M, trackErrorScale: cfg.trackErrorScale, intensityErrorScale: cfg.intensityErrorScale, sizeSpread: cfg.sizeSpread, peakVmaxKt: Math.round(Math.max(...ctrl.vmax)), minPcHpa: Math.round(P.pEnv - Math.max(...ctrl.dp)) },
    },
  };
}

const r1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Supply cascade: per member, each plant is offline until its restart day, then ramps back linearly.
 * National supply = 1 − Σ share × lost fraction, plus up to 10% surge from unaffected makers after two weeks.
 * Hospitals stock out when the cumulative deficit exceeds their days on hand (same buffers as the replay model).
 */
const DRIVERS: Record<string, string> = { flood: 'Plant flooding (rain near river)', wind: 'Plant wind damage / grid loss', tornado: 'Tornado strike risk', quake: 'Earthquake shaking damage', fire: 'Wildfire, smoke and power shutoffs', ice: 'Ice storm grid failure and frozen utilities' };

export function labCascade(drugs: Drug[], plants: Plant[], hospitals: Hospital[], restart: Float32Array[], ramp: Float32Array[], M: number, dom: Record<string, number>[]) {
  const D = 90;
  const buffers = hospitals.map((h) => 2.5 + Math.min(5, Math.log1p(Math.max(1, h.beds)) / 1.45) - 1.3 * +h.rural - 0.7 * +(h.svi >= 0.75));
  const hospitalStockouts: WhatIfResult['hospitalStockouts'] = {};
  const risks: DrugRisk[] = [];
  const loss = new Float32Array(M * D);
  for (const drug of drugs) {
    const makers = plants.map((p, i) => ({ i, share: p.share[drug.id] ?? 0 })).filter((x) => x.share > 0 && restart[x.i].some((d) => d > 0));
    const base = clamp(drug.baselineRisk ?? 0, 0, 1);
    if (!makers.length) {
      risks.push({ drugId: drug.id, risk: r3(base), ci: drug.baselineRiskCI ?? [base, base], supplyCurve: { p10: Array(D).fill(1), p50: Array(D).fill(1), p90: Array(D).fill(1) }, hospitalsAtRisk: 0, shap: [{ feature: 'baseline', label: 'Baseline supply fragility (no exposed plant)', value: r3(base) }] });
      continue;
    }
    loss.fill(0);
    let shortMembers = 0;
    const why: Record<string, number> = {};
    for (let m = 0; m < M; m++) {
      let longShort = 0, run = 0;
      for (const { i, share } of makers) {
        const r = restart[i][m];
        if (r <= 0) continue;
        const rp = Math.max(1, ramp[i][m]);
        for (let d = 0; d < D; d++) loss[m * D + d] += share * (d < r ? 1 : d < r + rp ? 1 - (d - r) / rp : 0);
      }
      for (let d = 0; d < D; d++) {
        const surge = d < 14 ? 0 : Math.min(0.1, (d - 14) / 140);
        const v = Math.max(0, Math.min(1, loss[m * D + d]) - surge);
        loss[m * D + d] = v;
        run = v >= 0.1 ? run + 1 : 0;
        longShort = Math.max(longShort, run);
      }
      if (longShort >= 7) shortMembers++;
    }
    for (const { i } of makers) for (const [k, v] of Object.entries(dom[i])) why[k] = (why[k] ?? 0) + v;
    const pShort = shortMembers / M, risk = base + (1 - base) * pShort;
    const band: Band = { p10: [], p50: [], p90: [] }, deficits: Record<'p10' | 'p50' | 'p90', number[]> = { p10: [], p50: [], p90: [] };
    const hist = new Uint32Array(201), cum = { p10: 0, p50: 0, p90: 0 };
    // Loss is in [0,1]: quantiles from a 0.5%-bin histogram instead of sorting every day.
    const q = (target: number) => { let acc = 0; for (let b = 0; b < 201; b++) { acc += hist[b]; if (acc >= target) return b / 200; } return 1; };
    for (let d = 0; d < D; d++) {
      hist.fill(0);
      for (let m = 0; m < M; m++) hist[Math.round(loss[m * D + d] * 200)]++;
      // P10 supply = optimistic (low loss); stockout P10 = early (high loss), so the bands invert.
      const lo = q(0.1 * M), mid = q(0.5 * M), hi = q(0.9 * M);
      band.p10.push(r3(1 - hi)); band.p50.push(r3(1 - mid)); band.p90.push(r3(1 - lo));
      cum.p10 += hi; cum.p50 += mid; cum.p90 += lo;
      deficits.p10.push(cum.p10); deficits.p50.push(cum.p50); deficits.p90.push(cum.p90);
    }
    const days = (curve: number[]) => buffers.map((b) => {
      const need = b + (drug.sterileInjectable ? 0 : 1);
      if (curve[D - 1] < need) return 999;
      let lo = 0, hi = D - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (curve[mid] >= need) hi = mid; else lo = mid + 1; }
      return lo;
    });
    const stock: Band = { p10: days(deficits.p10), p50: days(deficits.p50), p90: days(deficits.p90) };
    hospitalStockouts[drug.id] = stock;
    const atRisk = stock.p50.filter((v) => v < 999).length;
    let first = 999;
    for (const v of stock.p50) first = Math.min(first, v);
    const tot = Object.values(why).reduce((a, b) => a + b, 0) || 1, weather = risk - base;
    const ci = Math.sqrt((pShort * (1 - pShort)) / M) * 1.2816;
    risks.push({
      drugId: drug.id, risk: r3(risk), ci: [r3(base + (1 - base) * clamp(pShort - ci, 0, 1)), r3(base + (1 - base) * clamp(pShort + ci, 0, 1))],
      supplyCurve: band, hospitalsAtRisk: atRisk, firstStockoutDay: first < 999 ? first : undefined,
      shap: [
        { feature: 'baseline', label: 'Baseline supply fragility', value: r3(base) },
        ...Object.keys(why).filter((k) => why[k] > 0).map((k) => ({ feature: k, label: DRIVERS[k] ?? k, value: r3((weather * why[k]) / tot) })),
      ],
    });
  }
  risks.sort((a, b) => b.risk - a.risk);
  const top = [...risks].sort((a, b) => b.hospitalsAtRisk - a.hospitalsAtRisk || b.risk - a.risk)[0];
  const impact = impactFromStockouts(top && hospitalStockouts[top.drugId] ? hospitalStockouts[top.drugId].p50 : [], hospitals, drugs.find((d) => d.id === top?.drugId));
  return { drugRisk: risks, hospitalStockouts, impact };
}

// Hourly storm life cycle from fixes: positions, motion, land interaction, intensity, pressure and structure.
import type { LabConfig, Phys } from './params';
import type { StormFix } from '../../types';
import { clamp, fitToR34, hollandB, inlandDecay, kmPerDegLon, KM_PER_DEG_LAT, KT, pcFromVmax, rmwClimo, symmetricVmax } from './physics';
import { isLand, type Terrain } from './terrain';

export const MAX_HOURS = 240;

/** Control path: positions and over-water intensity targets resampled hourly. */
export interface Path {
  n: number;
  hours: Float32Array;
  lon: Float64Array;
  lat: Float64Array;
  target: Float32Array; // over-water intensity target (kt)
  rmwFix: Float32Array | null; // observed Rmax (km) when fixes carry it
  pcFix: Float32Array | null; // observed central pressure (hPa) when fixes carry it
  r34Fix: Float32Array | null; // observed mean 34-kt radius (km)
  dpRatio: number; // storm-specific pressure deficit / wind–pressure relationship
  fixHours: number[];
}

/** Everything the hazard models need per hour. */
export interface Track extends Path {
  ux: Float32Array; // motion (kt) east
  uy: Float32Array; // motion (kt) north
  vmax: Float32Array; // 1-min sustained surface wind (kt)
  dp: Float32Array; // pressure deficit (hPa)
  rmw: Float32Array; // km
  B: Float32Array;
  land: Uint8Array;
  sinceLandfall: Float32Array; // hours since the latest landfall (negative before the first)
  landfalls: number[]; // step indices
}

const kmBetween = (a: [number, number], b: [number, number]) => {
  const lat = (a[1] + b[1]) / 2;
  return Math.hypot((b[0] - a[0]) * kmPerDegLon(lat), (b[1] - a[1]) * KM_PER_DEG_LAT);
};

export function buildPath(fixes: StormFix[], cfg: LabConfig, forwardSpeedKt: number, P: Phys, t: Terrain): Path {
  if (fixes.length < 2) throw new Error('A storm needs at least two track points.');
  // Fix times: from the record when every fix has one, else from the forward speed.
  const timed = fixes.every((f) => Number.isFinite(f.hour));
  const kmPerHour = Math.max(2, forwardSpeedKt) * 1.852;
  const hours: number[] = [0];
  for (let i = 1; i < fixes.length; i++) {
    const dt = timed ? fixes[i].hour! - fixes[i - 1].hour! : kmBetween([fixes[i - 1].lon, fixes[i - 1].lat], [fixes[i].lon, fixes[i].lat]) / kmPerHour;
    hours.push(hours[i - 1] + Math.max(0.25, dt));
  }
  if (cfg.stallAtFix >= 0 && cfg.stallAtFix < fixes.length && cfg.stallHours > 0)
    for (let i = cfg.stallAtFix + 1; i < hours.length; i++) hours[i] += cfg.stallHours;
  // A stall holds position: duplicate the stalling fix in time.
  const fx = fixes.map((f, i) => ({ ...f, hour: hours[i] }));
  if (cfg.stallAtFix >= 0 && cfg.stallAtFix < fixes.length && cfg.stallHours > 0) {
    const f = fx[cfg.stallAtFix];
    fx.splice(cfg.stallAtFix + 1, 0, { ...f, hour: f.hour + cfg.stallHours });
  }
  const end = Math.min(MAX_HOURS, fx[fx.length - 1].hour);
  const n = Math.floor(end) + 1;
  const lon = new Float64Array(n), lat = new Float64Array(n), target = new Float32Array(n), hrs = new Float32Array(n);
  const hasRmw = fx.some((f) => Number.isFinite(f.rmwKm));
  const rmwFix = hasRmw ? new Float32Array(n) : null;
  const pcFix = fx.every((f) => Number.isFinite(f.pcHpa)) ? new Float32Array(n) : null;
  const r34Fix = fx.some((f) => Number.isFinite(f.r34Km)) ? new Float32Array(n) : null;
  // Historical intensity is only a valid over-water target where the ORIGINAL storm was over water.
  let hold = cfg.vmaxKt;
  const scale = cfg.intensityScale ?? 1;
  const targets = fx.map((f) => {
    if (!Number.isFinite(f.vmaxKt)) return cfg.vmaxKt;
    const ol = f.origLon ?? f.lon, oa = f.origLat ?? f.lat;
    if (!isLand(t, ol, oa)) hold = f.vmaxKt! * scale;
    return isLand(t, ol, oa) ? hold : f.vmaxKt! * scale;
  });
  let k = 0;
  for (let h = 0; h < n; h++) {
    while (k < fx.length - 2 && fx[k + 1].hour < h) k++;
    const a = fx[k], b = fx[k + 1];
    const u = clamp((h - a.hour) / Math.max(1e-6, b.hour - a.hour), 0, 1);
    hrs[h] = h;
    lon[h] = a.lon + (b.lon - a.lon) * u;
    lat[h] = a.lat + (b.lat - a.lat) * u;
    target[h] = targets[k] + (targets[k + 1] - targets[k]) * u;
    if (rmwFix) {
      const ra = a.rmwKm ?? b.rmwKm ?? NaN, rb = b.rmwKm ?? a.rmwKm ?? NaN;
      rmwFix[h] = ra + (rb - ra) * u;
    }
    if (pcFix) pcFix[h] = a.pcHpa! + (b.pcHpa! - a.pcHpa!) * u;
    if (r34Fix) {
      const ra = a.r34Km ?? NaN, rb = b.r34Km ?? NaN;
      r34Fix[h] = Number.isFinite(ra) && Number.isFinite(rb) ? ra + (rb - ra) * u : u < 0.5 ? ra : rb;
    }
  }
  // Storm-specific pressure anomaly at hurricane strength (large storms run deeper for the same wind).
  const ratios = fx.filter((f) => Number.isFinite(f.pcHpa) && Number.isFinite(f.vmaxKt) && f.vmaxKt! >= 64)
    .map((f) => (P.pEnv - f.pcHpa!) / (P.pEnv - pcFromVmax(f.vmaxKt!, P)));
  ratios.sort((x, y) => x - y);
  let dpRatio = ratios.length ? ratios[ratios.length >> 1] : 1;
  if (cfg.pcHpa !== null) dpRatio = (P.pEnv - cfg.pcHpa) / Math.max(1, P.pEnv - pcFromVmax(cfg.vmaxKt, P));
  return { n, hours: hrs, lon, lat, target, rmwFix, r34Fix, pcFix: cfg.pcHpa === null ? pcFix : null, dpRatio: clamp(dpRatio, 0.5, 2), fixHours: fx.map((f) => f.hour) };
}

/**
 * Derive motion, land interaction and intensity for a path (control or perturbed member).
 * `noise` adds an intensity error series (kt) and `rmwScale` a size perturbation.
 */
export function deriveTrack(p: Path, cfg: LabConfig, P: Phys, t: Terrain, noise?: Float32Array, rmwScale = 1, structure?: { rmw: Float32Array; B: Float32Array }): Track {
  const n = p.n;
  const ux = new Float32Array(n), uy = new Float32Array(n), vmax = new Float32Array(n), dp = new Float32Array(n);
  const rmw = new Float32Array(n), B = new Float32Array(n), land = new Uint8Array(n), since = new Float32Array(n);
  const landfalls: number[] = [];
  for (let h = 0; h < n; h++) {
    const a = Math.max(0, h - 1), b = Math.min(n - 1, h + 1), span = Math.max(1, b - a);
    const midLat = p.lat[h];
    ux[h] = ((p.lon[b] - p.lon[a]) * kmPerDegLon(midLat)) / span / 1.852;
    uy[h] = ((p.lat[b] - p.lat[a]) * KM_PER_DEG_LAT) / span / 1.852;
    land[h] = isLand(t, p.lon[h], p.lat[h]) ? 1 : 0;
    if (land[h] && (h === 0 || !land[h - 1]) && h > 0) landfalls.push(h);
  }
  const rate = Math.max(0.1, cfg.intensifyKtPerDay / 24);
  let v = p.target[0], vLand = v, overLand = 0, recovering = false;
  for (let h = 0; h < n; h++) {
    const goal = p.target[h] + (noise ? noise[h] : 0);
    // After landfall, only warm ocean (south of ~35°N) can re-intensify a storm; cold water keeps it decaying.
    if (land[h] || (recovering && Math.abs(p.lat[h]) >= 35)) {
      if (overLand === 0) vLand = v;
      overLand++;
      v = cfg.inlandDecay ? inlandDecay(vLand, overLand, P) : goal;
      recovering = cfg.inlandDecay;
    } else {
      overLand = 0;
      // Over water the storm follows its target (the record, or the user's intensity); only a storm that
      // re-emerges from land is limited to a climatological re-intensification rate.
      if (recovering && v < goal) v = Math.min(goal, v + rate);
      else { v = goal; recovering = false; }
    }
    v = clamp(v, 15, 185);
    vmax[h] = v;
    // Observed pressure while the storm follows its record; otherwise the wind–pressure relationship.
    const onRecord = p.pcFix && !land[h] && !recovering && Math.abs(v - p.target[h]) < 1 && !noise;
    dp[h] = onRecord ? Math.max(2, P.pEnv - p.pcFix![h]) : Math.max(2, (P.pEnv - pcFromVmax(v, P)) * p.dpRatio);
    if (structure) {
      // Ensemble members inherit the control's fitted structure, perturbed only in size.
      rmw[h] = clamp(structure.rmw[h] * rmwScale, 8, 250);
      B[h] = structure.B[h];
      continue;
    }
    const obsRmw = p.rmwFix && Number.isFinite(p.rmwFix[h]) ? p.rmwFix[h] : null;
    const bDerived = cfg.hollandB ?? hollandB(v, P.pEnv - dp[h], P);
    const r34 = p.r34Fix ? p.r34Fix[h] : NaN;
    let rm: number, bb = bDerived;
    if (cfg.rmwKm !== null) rm = cfg.rmwKm;
    else if (Number.isFinite(r34) && v >= 40 && cfg.hollandB === null) {
      // Observed storm size: fit the profile to the 34-kt radius (B if Rmax observed, else Rmax).
      const fit = fitToR34(symmetricVmax(v, ux[h], uy[h], P), r34, obsRmw, bDerived, P);
      rm = Number.isFinite(fit.rmw) ? fit.rmw : obsRmw ?? rmwClimo(v, p.lat[h], P);
      bb = fit.B;
    } else {
      // Climatology; inland the wind maximum spreads as the core decays (1%/h, capped at 2x).
      rm = obsRmw ?? rmwClimo(v, p.lat[h], P) * (land[h] ? Math.min(2, 1 + 0.01 * overLand) : 1);
    }
    rmw[h] = clamp(rm * rmwScale, 8, 250);
    B[h] = bb;
  }
  let last = -Infinity, first = landfalls[0] ?? Infinity;
  for (let h = 0; h < n; h++) {
    if (landfalls.includes(h)) last = h;
    since[h] = Number.isFinite(last) ? h - last : h - first;
  }
  return { ...p, ux, uy, vmax, dp, rmw, B, land, sinceLandfall: since, landfalls };
}

/** Motion speed (kt) at an hour, for display. */
export const speedKt = (tr: Track, h: number) => Math.hypot(tr.ux[h], tr.uy[h]);
export const ktToMs = (kt: number) => kt * KT;

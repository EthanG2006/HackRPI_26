// Parametric tropical-cyclone hazard physics (all SI inside, kt/km/in at the edges).
import type { Phys } from './params';

export const KT = 0.514444; // m/s per knot
export const DEG = Math.PI / 180;
export const KM_PER_DEG_LAT = 110.57;
export const kmPerDegLon = (lat: number) => 111.32 * Math.max(0.05, Math.cos(lat * DEG));
export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Willoughby, Darling & Rahn (2006) climatological radius of maximum wind (km). */
export const rmwClimo = (vmaxKt: number, lat: number, P: Phys) => clamp(P.rmwA * Math.exp(P.rmwB * vmaxKt * KT + P.rmwC * Math.abs(lat)), 8, 150);

/** Central pressure from the Atlantic wind–pressure relationship (hPa). */
export const pcFromVmax = (vmaxKt: number, P: Phys) => P.pEnv - P.wprA * Math.pow(Math.max(15, vmaxKt), P.wprB);

/** Holland (1980) B from the gradient-level maximum wind and pressure deficit. */
export function hollandB(vmaxKt: number, pcHpa: number, P: Phys): number {
  const vg = (vmaxKt * KT) / P.sfcWater;
  const dpPa = Math.max(300, (P.pEnv - pcHpa) * 100);
  return clamp((P.rho * Math.E * vg * vg) / dpPa, P.bMin, P.bMax);
}

/**
 * Holland (1980) cyclostrophic profile, normalised: S(x;B) = sqrt(x^-B · e^(1 - x^-B)), x = r/Rmax, S(1) = 1.
 * Tabulated once over B and x so every wind evaluation in the hot loops is a lookup.
 */
const B0 = 0.8, BSTEP = 0.01, NB = 181, XSTEP = 0.02, NX = 2001; // x up to 40·Rmax
export const SHAPE = (() => {
  const t = new Float32Array(NB * NX);
  for (let b = 0; b < NB; b++) {
    const B = B0 + b * BSTEP;
    for (let i = 1; i < NX; i++) {
      const q = Math.pow(i * XSTEP, -B);
      t[b * NX + i] = Math.sqrt(q * Math.exp(1 - q));
    }
  }
  return t;
})();

/** Holland shape S(x;B) evaluated directly (used by the profile fits, not in hot loops). */
export const holland = (x: number, B: number) => { const q = Math.pow(Math.max(1e-6, x), -B); return Math.sqrt(q * Math.exp(1 - q)); };

/**
 * Fit the profile to an observed mean 34-kt radius (km), as operational parametric models do:
 * with an observed Rmax solve for B; otherwise solve for Rmax given B. Coriolis is neglected in the fit.
 */
export function fitToR34(vsymKt: number, r34Km: number, rmwKm: number | null, B: number, P: Phys): { rmw: number; B: number } {
  const s = 34 / vsymKt;
  if (!(s > 0 && s < 1) || !(r34Km > 0)) return { rmw: rmwKm ?? NaN, B };
  if (rmwKm !== null && r34Km > rmwKm) {
    const x = r34Km / rmwKm;
    if (holland(x, P.bMax) > s) return { rmw: rmwKm, B: P.bMax };
    if (holland(x, P.bMin) < s) return { rmw: rmwKm, B: P.bMin };
    let lo = P.bMin, hi = P.bMax;
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (holland(x, mid) > s) lo = mid; else hi = mid; }
    return { rmw: rmwKm, B: (lo + hi) / 2 };
  }
  let lo = 1, hi = 40;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (holland(mid, B) > s) lo = mid; else hi = mid; }
  return { rmw: clamp(r34Km / ((lo + hi) / 2), 8, 250), B };
}

/** Per-hour wind state: symmetric surface wind at radius r = sfc·(sqrt(Vc²S² + (r·fh)²) − r·fh), with V(Rmax) = Vmax. */
export interface WindStep { rmw: number; row: number; vc: number; fh: number; sfc: number }

export function windStep(vmaxKt: number, rmwKm: number, B: number, lat: number, sfc: number): WindStep {
  const fh = (2 * 7.2921e-5 * Math.sin(Math.max(5, Math.abs(lat)) * DEG) * 1000) / 2 / KT; // kt per km (r·f/2)
  const vg = vmaxKt / sfc, c = rmwKm * fh;
  const vc = Math.sqrt((vg + c) * (vg + c) - c * c); // cyclostrophic peak so the gradient wind hits Vmax at Rmax
  return { rmw: rmwKm, row: Math.round(clamp((B - B0) / BSTEP, 0, NB - 1)) * NX, vc, fh, sfc };
}

/** Symmetric surface wind (kt) at radius rKm. */
export function symWind(rKm: number, w: WindStep): number {
  const x = rKm / w.rmw / XSTEP;
  const i = x | 0;
  const s = i >= NX - 1 ? SHAPE[w.row + NX - 1] * Math.sqrt((NX - 1) / Math.max(x, 1)) : SHAPE[w.row + i] + (SHAPE[w.row + i + 1] - SHAPE[w.row + i]) * (x - i);
  const v = w.vc * s, c = rKm * w.fh;
  return Math.max(0, w.sfc * (Math.sqrt(v * v + c * c) - c));
}

/** Kaplan & DeMaria (1995): maximum wind (kt) after `hours` over land, from the landfall intensity v0. */
export const inlandDecay = (v0: number, hours: number, P: Phys) => (v0 <= P.kdVb ? v0 : P.kdVb + (P.kdR * v0 - P.kdVb) * Math.exp(-P.kdAlpha * hours));

/** Per-hour flow geometry: inflow rotation and the motion share added to the wind (Lin & Chavas 2012). */
export interface FlowStep { cb: number; sb: number; tx: number; ty: number; vmax: number }

/** Storms rarely move faster than ~45 kt; capping guards the asymmetry term against unrealistic motion. */
const capMotion = (ux: number, uy: number): [number, number] => {
  const s = Math.hypot(ux, uy), k = s > 45 ? 45 / s : 1;
  return [ux * k, uy * k];
};

export function flowStep(ux: number, uy: number, vmaxKt: number, overLand: boolean, P: Phys): FlowStep {
  const b = (overLand ? P.inflowLand : P.inflowWater) * DEG, rot = P.asymRotDeg * DEG;
  [ux, uy] = capMotion(ux, uy);
  return { cb: Math.cos(b), sb: Math.sin(b), tx: (ux * Math.cos(rot) - uy * Math.sin(rot)) * P.asymAlpha, ty: (ux * Math.sin(rot) + uy * Math.cos(rot)) * P.asymAlpha, vmax: Math.max(1, vmaxKt) };
}

/**
 * Best-track Vmax already includes the motion asymmetry, so the symmetric profile is built from
 * Vmax − α·|motion| (floored at 75%) and the motion share is added back azimuthally.
 */
export const symmetricVmax = (vmaxKt: number, ux: number, uy: number, P: Phys) => Math.max(0.75 * vmaxKt, vmaxKt - P.asymAlpha * Math.hypot(...capMotion(ux, uy)));

/**
 * Surface wind vector (kt, east/north) at offset (dx, dy) km from the centre: counter-clockwise flow turned inward
 * by the inflow angle, plus the motion share scaled by the profile so it fades away from the core.
 */
export function windVec(dx: number, dy: number, w: WindStep, f: FlowStep, out: [number, number]): number {
  const r = Math.sqrt(dx * dx + dy * dy) + 1e-6;
  const vs = symWind(r, w), s = vs / f.vmax, ex = dx / r, ey = dy / r;
  const vx = vs * (-ey * f.cb - ex * f.sb) + s * f.tx, vy = vs * (ex * f.cb - ey * f.sb) + s * f.ty;
  out[0] = vx; out[1] = vy;
  return Math.sqrt(vx * vx + vy * vy);
}

/** R-CLIPER rain rate (in/day) evaluated directly (used at sites, where a table per step would cost more). */
export interface RainStep { t0: number; tm: number; rm: number; re: number }
export function rainStep(vmaxKt: number, P: Phys): RainStep {
  const U = 1 + (vmaxKt - 35) / 33;
  return { t0: Math.max(0, P.rcT0a + P.rcT0b * U), tm: Math.max(0.2, P.rcTma + P.rcTmb * U), rm: Math.max(15, P.rcRma + P.rcRmb * U), re: Math.max(40, P.rcRea + P.rcReb * U) };
}
export const rainRate = (r: number, s: RainStep) => (r < s.rm ? s.t0 + ((s.tm - s.t0) * r) / s.rm : s.tm * Math.exp(-(r - s.rm) / s.re));

/**
 * Wavenumber-1 shear asymmetry (PHRaM, Lonfat et al. 2007): rain peaks downshear-left.
 * Precomputed per step as the downshear-left unit vector (east, north) times the amplitude.
 */
export interface ShearStep { sx: number; sy: number }
export function shearStep(shearKt: number, shearDirDeg: number, P: Phys): ShearStep {
  const amp = Math.min(0.75, P.shearAmp * Math.max(0, shearKt) * KT), dsl = (shearDirDeg - 90) * DEG;
  return { sx: amp * Math.sin(dsl), sy: amp * Math.cos(dsl) };
}
/** cos(bearing − downshear-left) fades in over the inner 60 km, so the factor is 1 + amp·(d·ŝ)/max(r, 60). */
export const shearFactor = (dx: number, dy: number, r: number, s: ShearStep) => Math.max(0.2, 1 + (dx * s.sx + dy * s.sy) / Math.max(r, 60));

/**
 * Orographic rain from forced ascent, upslope model (Smith 1979): P = ε·ρ·q_s·w with w = V·∇h.
 * topoC = ε·ρ·q_s in mm/h per m/s of ascent; capped at 60 mm/h. Returned in in/day to add to R-CLIPER.
 */
export const orographicAdd = (vx: number, vy: number, gx: number, gy: number, P: Phys) => (Math.min(60, P.topoC * Math.max(0, vx * gx + vy * gy)) * 24) / 25.4;

/**
 * Tropical-cyclone tornado potential (0..1) at an over-land point: a radial band 100–400 km out,
 * peaked in the right-front quadrant relative to motion, ramping up around landfall.
 */
export function tornadoPotential(dx: number, dy: number, ux: number, uy: number, hoursSinceLandfall: number, vmaxKt: number, shearKt: number, P: Phys): number {
  if (vmaxKt < 34 || hoursSinceLandfall < -12) return 0;
  const r = Math.sqrt(dx * dx + dy * dy);
  if (r < P.torRmin * 0.5 || r > P.torRmax * 1.3) return 0;
  const mid = (P.torRmin + P.torRmax) / 2, half = (P.torRmax - P.torRmin) / 2;
  const radial = Math.exp(-(((r - mid) / half) ** 2));
  const motion = Math.atan2(ux, uy); // heading, clockwise from north
  const bearing = Math.atan2(dx, dy);
  const quad = 0.5 * (1 + Math.cos(bearing - motion - P.torQuad * DEG));
  const t = hoursSinceLandfall;
  const time = t < 0 ? Math.exp(t / 8) : Math.exp(-(((t - P.torPeakH) / P.torDecayH) ** 2) / 2);
  const intensity = clamp((vmaxKt - 34) / 60, 0, 1) * (0.6 + 0.4 * clamp(shearKt / 25, 0, 1));
  return radial * quad * quad * time * intensity;
}

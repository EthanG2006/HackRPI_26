// Physical constants for the Storm Lab. Defaults are literature values; at runtime they are
// overridden by web/public/data/model/physics_params.json (each entry carries its citation).
import type { LabConfig, NhcErrorsFile, ParamEntry } from '../../types';
export type { LabConfig, SoilMoisture } from '../../types';

export interface Phys {
  rho: number; pEnv: number; bMin: number; bMax: number;
  rmwA: number; rmwB: number; rmwC: number; // Willoughby, Darling & Rahn (2006): Rmax[km] = a·exp(b·V[m/s] + c·|lat|)
  kdAlpha: number; kdR: number; kdVb: number; // Kaplan & DeMaria (1995) inland decay
  wprA: number; wprB: number; // ΔP[hPa] = a·Vmax[kt]^b, fit to the Dvorak (1984) Atlantic wind–pressure table
  sfcWater: number; landFactor: number; // gradient→10 m reduction over sea; extra open-land roughness reduction
  asymAlpha: number; asymRotDeg: number; // Lin & Chavas (2012) translation asymmetry
  inflowWater: number; inflowLand: number; // surface inflow angle (deg)
  rcT0a: number; rcT0b: number; rcTma: number; rcTmb: number; rcRma: number; rcRmb: number; rcRea: number; rcReb: number; // R-CLIPER
  shearAmp: number; topoC: number; // PHRaM-style shear asymmetry (per kt) and upslope enhancement (per m/s)
  torRmin: number; torRmax: number; torQuad: number; torPeakH: number; torDecayH: number; // TC tornado climatology
  floodIn: number; // storm-total rain where small, steep basins flood
}

export const DEFAULT_PHYS: Phys = {
  rho: 1.15, pEnv: 1010, bMin: 1.0, bMax: 2.5,
  rmwA: 46.4, rmwB: -0.0155, rmwC: 0.0169,
  kdAlpha: 0.095, kdR: 0.9, kdVb: 26.7,
  wprA: 0.005435, wprB: 1.9717,
  sfcWater: 0.9, landFactor: 0.78,
  asymAlpha: 0.55, asymRotDeg: 20,
  inflowWater: 22.6, inflowLand: 35,
  rcT0a: -1.1, rcT0b: 3.96, rcTma: -1.6, rcTmb: 4.8, rcRma: 64.5, rcRmb: -13.0, rcRea: 150, rcReb: -16,
  shearAmp: 0.04, topoC: 37,
  torRmin: 160, torRmax: 400, torQuad: 75, torPeakH: 24, torDecayH: 72,
  floodIn: 6,
};

const KEY_MAP: Record<string, keyof Phys> = {
  rho_air: 'rho', p_env_hpa: 'pEnv', holland_b_min: 'bMin', holland_b_max: 'bMax',
  rmw_w06_a: 'rmwA', rmw_w06_b: 'rmwB', rmw_w06_c: 'rmwC',
  kd_alpha: 'kdAlpha', kd_r: 'kdR', kd_vb: 'kdVb', wpr_a: 'wprA', wpr_b: 'wprB',
  sfc_factor_water: 'sfcWater', land_factor: 'landFactor', asym_alpha: 'asymAlpha', asym_rotation_deg: 'asymRotDeg',
  inflow_deg_water: 'inflowWater', inflow_deg_land: 'inflowLand',
  rc_t0_a: 'rcT0a', rc_t0_b: 'rcT0b', rc_tm_a: 'rcTma', rc_tm_b: 'rcTmb', rc_rm_a: 'rcRma', rc_rm_b: 'rcRmb', rc_re_a: 'rcRea', rc_re_b: 'rcReb',
  phram_shear_amp: 'shearAmp', oro_upslope_c: 'topoC',
  tctor_r_min_km: 'torRmin', tctor_r_max_km: 'torRmax', tctor_quadrant_deg: 'torQuad', tctor_peak_hours: 'torPeakH', tctor_decay_hours: 'torDecayH',
  rain_flood_in: 'floodIn',
};

/** Merge a physics_params.json array over the defaults. Unknown keys and non-finite values are ignored. */
export function physFrom(entries: ParamEntry[] | null | undefined): Phys {
  const p = { ...DEFAULT_PHYS };
  for (const e of entries ?? []) {
    const k = KEY_MAP[e.key];
    if (k && Number.isFinite(e.value)) p[k] = e.value;
  }
  return p;
}

/** NHC 2026 cone radii (n mi) and 2021–25 official intensity errors (kt). Fallback; runtime reads nhc_errors.json. */
export const DEFAULT_ERRORS: Pick<NhcErrorsFile, 'leadHours' | 'coneRadiusNm' | 'intensityErrorKt'> = {
  leadHours: [0, 12, 24, 36, 48, 60, 72, 96, 120],
  coneRadiusNm: [0, 25, 39, 49, 62, 77, 95, 134, 200],
  intensityErrorKt: [1.3, 5.0, 7.1, 8.5, 9.9, 10.8, 11.6, 13.3, 14.7],
};

export const CATEGORY_VMAX: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 75, 2: 90, 3: 105, 4: 125, 5: 145 };

export const DEFAULT_LAB: LabConfig = {
  vmaxKt: 125, intensityScale: 1, pcHpa: null, rmwKm: null, hollandB: null, inlandDecay: true, intensifyKtPerDay: 20,
  shearKt: 10, shearDirDeg: 45, stallHours: 0, stallAtFix: -1, soilMoisture: 'normal', orographic: true,
  members: 1000, trackErrorScale: 1, intensityErrorScale: 1, sizeSpread: 0.25, seed: 20241,
  backupPowerDays: 3, alertThreshold: 0.35,
};

export const saffirSimpson = (kt: number) => (kt >= 137 ? 5 : kt >= 113 ? 4 : kt >= 96 ? 3 : kt >= 83 ? 2 : kt >= 64 ? 1 : kt >= 34 ? 0 : -1);
export const categoryLabel = (kt: number) => {
  const c = saffirSimpson(kt);
  return c >= 1 ? `Cat ${c}` : c === 0 ? 'Tropical storm' : 'Depression';
};

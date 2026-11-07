// The one risk ramp (cool -> amber -> red), used by every layer, chart and badge.
// Interpolated in OKLab so the midpoints don't turn muddy.

export type RGBA = [number, number, number, number];

const STOPS: [number, string][] = [
  [0.0, '#2d6a8f'], // cool
  [0.5, '#f2a33a'], // amber
  [0.78, '#ff5a3c'],
  [1.0, '#ff2d55'], // red
];

export const STORM_CYAN: RGBA = [56, 214, 255, 255];
export const STORM_CYAN_HEX = '#38d6ff';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toLin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLin = (v: number) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
};
function rgbToOklab([r, g, b]: [number, number, number]): [number, number, number] {
  const [lr, lg, lb] = [toLin(r), toLin(g), toLin(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function oklabToRgb([L, a, b]: [number, number, number]): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const LAB_STOPS = STOPS.map(([t, hex]) => [t, rgbToOklab(hexToRgb(hex))] as const);
const LUT: [number, number, number][] = Array.from({ length: 256 }, (_, i) => {
  const t = i / 255;
  let k = 0;
  while (k < LAB_STOPS.length - 2 && t > LAB_STOPS[k + 1][0]) k++;
  const [t0, c0] = LAB_STOPS[k];
  const [t1, c1] = LAB_STOPS[k + 1];
  const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  return oklabToRgb([c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u]);
});

/** Risk in [0,1] -> RGBA for deck.gl. */
export function riskColor(t: number, alpha = 255): RGBA {
  const i = Math.round(Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * 255);
  const [r, g, b] = LUT[i];
  return [r, g, b, alpha];
}

/** Risk in [0,1] -> CSS color. */
export function riskCss(t: number, alpha = 1): string {
  const [r, g, b] = riskColor(t);
  return alpha === 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;
}

/** Days until stockout -> risk. <=3 days is max risk, >=60 days (or none) is calm. */
export function daysToRisk(days: number | null | undefined): number {
  if (days === null || days === undefined || days >= 999) return 0;
  if (days <= 3) return 1;
  if (days >= 60) return 0.05;
  // log-ish falloff: 7d ~0.78, 14d ~0.55, 30d ~0.3
  return Math.max(0.05, Math.min(1, 1 - Math.log(days / 3) / Math.log(60 / 3)));
}

/** CSS gradient string of the ramp, for legends. */
export const RISK_GRADIENT_CSS = `linear-gradient(90deg, ${Array.from({ length: 9 }, (_, i) => `${riskCss(i / 8)} ${(i / 8) * 100}%`).join(', ')})`;

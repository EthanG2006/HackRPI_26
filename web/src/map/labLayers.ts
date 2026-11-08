// Storm Lab map layers: hazard field image + isolines, uncertainty cone, spaghetti, intensity-coloured track.
import { BitmapLayer, GeoJsonLayer, LineLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { contours } from 'd3-contour';
import type { AppState } from '../store';
import type { LabFieldId, LabGrid, LngLat, WhatIfResult } from '../types';

type RGBA = [number, number, number, number];
interface FieldMeta { label: string; unit: string; stops: [number, string, number][]; levels: number[]; fmt: (v: number) => string; source: string }

const pct = (v: number) => `${Math.round(v * 100)}%`;
const PROB: [number, string, number][] = [[0.02, '#4fb3b5', 0], [0.1, '#5cc3bd', 0.42], [0.3, '#9bcf8e', 0.55], [0.5, '#e8c46a', 0.62], [0.7, '#eb9a5a', 0.68], [0.9, '#de6556', 0.74], [1, '#c8414e', 0.78]];

export const FIELD_META: Record<LabFieldId, FieldMeta> = {
  p34: { label: 'Chance of tropical-storm-force wind', unit: '≥ 34 kt', stops: PROB, levels: [0.1, 0.5, 0.9], fmt: pct, source: 'Ensemble exceedance, like NHC wind speed probabilities' },
  p50: { label: 'Chance of damaging wind', unit: '≥ 50 kt', stops: PROB, levels: [0.1, 0.5, 0.9], fmt: pct, source: 'Ensemble exceedance' },
  p64: { label: 'Chance of hurricane-force wind', unit: '≥ 64 kt', stops: PROB, levels: [0.1, 0.5, 0.9], fmt: pct, source: 'Ensemble exceedance, like NHC wind speed probabilities' },
  wind: {
    label: 'Maximum sustained wind', unit: 'kt, control run', levels: [34, 64, 96, 113], fmt: (v) => `${Math.round(v)}`, source: 'Holland (1980) field, 1-min at 10 m',
    stops: [[30, '#5aa9b8', 0], [34, '#63bfc0', 0.38], [50, '#93cfa4', 0.48], [64, '#e9d27c', 0.56], [83, '#efad62', 0.62], [96, '#e57f52', 0.68], [113, '#d4535a', 0.74], [137, '#a83850', 0.8]],
  },
  rain: {
    label: 'Storm-total rainfall', unit: 'in, control run', levels: [4, 8, 12, 20], fmt: (v) => v.toFixed(v < 10 ? 1 : 0), source: 'R-CLIPER + shear asymmetry + upslope enhancement',
    stops: [[0.5, '#4a8fb4', 0], [2, '#4f9fc4', 0.4], [4, '#4fb39c', 0.5], [8, '#9fcb6c', 0.58], [12, '#ead074', 0.64], [20, '#ec9a58', 0.7], [30, '#dc5d58', 0.76], [40, '#b8405f', 0.8]],
  },
  pRain: { label: 'Chance of flood-producing rain', unit: '≥ threshold, soil-adjusted', stops: PROB, levels: [0.1, 0.5, 0.9], fmt: pct, source: 'Ensemble exceedance of the flood threshold' },
  tornado: {
    label: 'Tornado potential', unit: 'P(within 25 mi), experimental', levels: [0.05, 0.15, 0.3], fmt: pct, source: 'Parametric TC-tornado climatology',
    stops: [[0.01, '#d9a85b', 0], [0.05, '#e3b062', 0.4], [0.15, '#e88a52', 0.55], [0.3, '#d9574f', 0.7], [0.5, '#b8404f', 0.78]],
  },
};

const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** 256-entry RGBA lookup over the field's value range. */
function lutFor(m: FieldMeta) {
  const lo = m.stops[0][0], hi = m.stops[m.stops.length - 1][0], out = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const v = lo + ((hi - lo) * i) / 255;
    let k = 0;
    while (k < m.stops.length - 2 && v > m.stops[k + 1][0]) k++;
    const [v0, c0, a0] = m.stops[k], [v1, c1, a1] = m.stops[k + 1], t = Math.max(0, Math.min(1, (v - v0) / (v1 - v0 || 1)));
    const A = hex(c0), B = hex(c1);
    for (let j = 0; j < 3; j++) out[i * 4 + j] = A[j] + (B[j] - A[j]) * t;
    out[i * 4 + 3] = 255 * (a0 + (a1 - a0) * t);
  }
  return { lut: out, lo, hi };
}
const LUTS = Object.fromEntries(Object.entries(FIELD_META).map(([k, m]) => [k, lutFor(m)])) as Record<LabFieldId, ReturnType<typeof lutFor>>;

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const invMerc = (y: number) => (Math.atan(Math.exp(y)) * 360) / Math.PI - 90;

/** Field → canvas, resampled to Mercator-uniform rows so BitmapLayer places every cell exactly. */
function toImage(g: LabGrid, values: Float32Array, field: LabFieldId): HTMLCanvasElement {
  const { lut, lo, hi } = LUTS[field];
  const W = g.nx, H = g.ny, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!, img = ctx.createImageData(W, H), px = img.data;
  const yN = mercY(g.north), yS = mercY(g.south), res = (g.north - g.south) / g.ny;
  for (let j = 0; j < H; j++) {
    const lat = invMerc(yN + ((j + 0.5) / H) * (yS - yN));
    const fr = Math.max(0, Math.min(H - 1.001, (g.north - lat) / res - 0.5)), r0 = fr | 0, t = fr - r0;
    for (let i = 0; i < W; i++) {
      const v = values[r0 * W + i] * (1 - t) + values[(r0 + 1) * W + i] * t;
      if (!(v > lo)) continue;
      const k = Math.min(255, Math.max(0, Math.round(((v - lo) / (hi - lo)) * 255))) * 4, o = (j * W + i) * 4;
      px[o] = lut[k]; px[o + 1] = lut[k + 1]; px[o + 2] = lut[k + 2]; px[o + 3] = lut[k + 3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Values for the field at the playback hour (accumulating fields interpolate between snapshots). */
function valuesAt(r: WhatIfResult, field: LabFieldId, hour: number | null): Float32Array | null {
  const g = r.fields?.[field];
  if (!g) return null;
  const snaps = field === 'rain' ? r.rainSnapshots : field === 'wind' ? r.windSnapshots : undefined;
  if (hour === null || !snaps?.length) return g.values;
  let k = 0;
  while (k < snaps.length - 1 && snaps[k + 1].hour <= hour) k++;
  const a = snaps[k], b = snaps[Math.min(snaps.length - 1, k + 1)];
  if (b === a || hour <= a.hour) return a.values;
  const t = Math.min(1, (hour - a.hour) / (b.hour - a.hour)), out = new Float32Array(a.values.length);
  for (let i = 0; i < out.length; i++) out[i] = a.values[i] + (b.values[i] - a.values[i]) * t;
  return out;
}

let imgKey = '', imgCache: HTMLCanvasElement | null = null, isoKey = '', isoCache: { path: LngLat[]; level: number }[] = [];

function isolines(g: LabGrid, values: Float32Array, levels: number[]) {
  const res = (g.east - g.west) / g.nx, out: { path: LngLat[]; level: number }[] = [];
  for (const mp of contours().size([g.nx, g.ny]).thresholds(levels)(Array.from(values)))
    for (const poly of mp.coordinates) for (const ring of poly)
      if (ring.length > 8) out.push({ level: mp.value, path: ring.map(([x, y]) => [g.west + x * res, g.north - y * res] as LngLat) });
  return out;
}

const CAT: RGBA[] = [[120, 196, 200, 255], [233, 210, 124, 255], [239, 173, 98, 255], [229, 127, 82, 255], [212, 83, 90, 255], [168, 56, 80, 255]];
const catColor = (kt: number): RGBA => CAT[kt >= 137 ? 5 : kt >= 113 ? 4 : kt >= 96 ? 3 : kt >= 83 ? 2 : kt >= 64 ? 1 : 0];

/** Hazard field + isolines: drawn under hospitals and plants. */
export function labFieldLayers(s: AppState): Layer[] {
  const r = s.whatif.result, field = s.whatif.field;
  const g = r?.fields?.[field];
  if (s.scenarioId !== 'whatif' || !r || !g) return [];
  const hour = s.whatif.hour === null ? null : Math.round(s.whatif.hour * 2) / 2;
  const key = `${r.elapsedMs}|${r.diagnostics?.seed}|${field}|${hour}|${g.nx}`;
  if (key !== imgKey) {
    const v = valuesAt(r, field, hour);
    imgCache = v ? toImage(g, v, field) : null;
    imgKey = key;
    const ik = `${r.elapsedMs}|${field}|${hour === null ? 'T' : Math.round(hour / 3)}`;
    if (ik !== isoKey && v) { isoCache = isolines(g, v, FIELD_META[field].levels); isoKey = ik; }
  }
  if (!imgCache) return [];
  const meta = FIELD_META[field], maxLevel = meta.levels[meta.levels.length - 1];
  return [
    new BitmapLayer({ id: 'lab-field', image: imgCache, bounds: [g.west, g.south, g.east, g.north], opacity: 0.9, parameters: { depthWriteEnabled: false } as never }),
    new PathLayer<{ path: LngLat[]; level: number }>({ id: 'lab-isolines', data: isoCache, getPath: (d) => d.path, widthUnits: 'pixels',
      getWidth: (d) => (d.level === maxLevel ? 1.6 : 1), getColor: (d) => [235, 244, 246, d.level === maxLevel ? 200 : 120], updateTriggers: { getWidth: [isoKey], getColor: [isoKey] } }),
  ];
}

/** Track, cone, spaghetti, landfalls and editable fixes: drawn above the field. */
export function labTrackLayers(s: AppState): Layer[] {
  if (s.scenarioId !== 'whatif') return [];
  const { track, result: r, hour } = s.whatif;
  const out: Layer[] = [];
  const cone = r?.conePolys ?? (r?.cone?.length ? [r.cone] : []);
  if (cone.length) out.push(new GeoJsonLayer({ id: 'lab-cone', data: { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: cone } } as never,
    filled: true, stroked: true, getFillColor: [210, 236, 240, 16], getLineColor: [210, 236, 240, 120], lineWidthMinPixels: 1.2 }));
  if (r?.sampleTracks.length) out.push(new PathLayer({ id: 'lab-spaghetti', data: r.sampleTracks.slice(0, 24), getPath: (p: LngLat[]) => p, getWidth: 0.7, widthUnits: 'pixels', getColor: [200, 230, 236, 26] }));
  const ser = r?.series;
  if (ser) {
    const segs = ser.lon.slice(1).map((_, i) => ({ a: [ser.lon[i], ser.lat[i]] as LngLat, b: [ser.lon[i + 1], ser.lat[i + 1]] as LngLat, v: ser.vmax.p50[i], h: ser.hours[i] }));
    out.push(new LineLayer({ id: 'lab-track', data: segs, getSourcePosition: (d) => d.a, getTargetPosition: (d) => d.b, widthUnits: 'pixels', getWidth: 3.2,
      getColor: (d) => { const c = catColor(d.v); return [c[0], c[1], c[2], hour === null || d.h <= hour ? 255 : 90]; }, updateTriggers: { getColor: [hour === null ? -1 : Math.floor(hour)] } }));
    out.push(new ScatterplotLayer({ id: 'lab-landfalls', data: ser.landfalls, getPosition: (d) => [d.lon, d.lat], getRadius: 7, radiusUnits: 'pixels', filled: false, stroked: true,
      getLineColor: [245, 250, 250, 230], getLineWidth: 1.5, lineWidthUnits: 'pixels' }));
    out.push(new TextLayer({ id: 'lab-landfall-labels', data: ser.landfalls, getPosition: (d) => [d.lon, d.lat], getText: (d) => `Landfall · ${d.vmaxKt} kt`, getSize: 12,
      getColor: [236, 244, 246, 230], getPixelOffset: [10, -12], getTextAnchor: 'start', fontFamily: 'Inter Variable, Inter, sans-serif', fontWeight: 600,
      outlineWidth: 3, outlineColor: [8, 20, 28, 220], fontSettings: { sdf: true } }));
  } else if (track.length) {
    out.push(new PathLayer({ id: 'lab-drawn', data: [track], getPath: (p: LngLat[]) => p, getWidth: 2.5, widthUnits: 'pixels', getColor: [131, 232, 218, 230] }));
  }
  out.push(new ScatterplotLayer({ id: 'lab-fixes', data: track, getPosition: (p: LngLat) => p, getRadius: s.whatif.fixes ? 2.6 : 4.2, radiusUnits: 'pixels',
    getFillColor: [12, 28, 36, 255], stroked: true, getLineColor: [226, 246, 244, 235], getLineWidth: 1.4, lineWidthUnits: 'pixels' }));
  return out;
}

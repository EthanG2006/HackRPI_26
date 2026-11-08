// Land mask + elevation on a 0.1° grid over the Atlantic basin. Uses data/terrain.json when present,
// otherwise rasterises the bundled basemap land polygons (elevation then unknown → orography off).
import type { TerrainFile } from '../../types';
import { KM_PER_DEG_LAT, kmPerDegLon } from './physics';

export interface Terrain {
  west: number; north: number; res: number; nx: number; ny: number;
  elev: Int16Array | null;
  land: Uint8Array;
  source: 'terrain.json' | 'basemap land polygons';
}

function b64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type Ring = number[][];
type Geo = { type: string; coordinates: unknown };

/** Even-odd scanline fill of polygon rings at cell centres. */
function rasterize(features: { geometry: Geo | null }[], t: Omit<Terrain, 'elev' | 'land' | 'source'>): Uint8Array {
  const land = new Uint8Array(t.nx * t.ny);
  const rings: Ring[] = [];
  for (const f of features) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates as Ring[]] : g.type === 'MultiPolygon' ? (g.coordinates as Ring[][]) : [];
    for (const p of polys) for (const r of p) rings.push(r);
  }
  // Bucket edges by row so each scanline only visits edges that cross it.
  const buckets: number[][] = Array.from({ length: t.ny }, () => []);
  const edges: number[] = []; // x0,y0,x1,y1
  for (const r of rings) {
    for (let i = 0; i < r.length - 1; i++) {
      const [x0, y0] = r[i], [x1, y1] = r[i + 1];
      if (y0 === y1) continue;
      const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
      const rowA = Math.max(0, Math.ceil((t.north - hi) / t.res - 0.5));
      const rowB = Math.min(t.ny - 1, Math.floor((t.north - lo) / t.res - 0.5));
      if (rowA > rowB) continue;
      const e = edges.length;
      edges.push(x0, y0, x1, y1);
      for (let row = rowA; row <= rowB; row++) buckets[row].push(e);
    }
  }
  const xs: number[] = [];
  for (let row = 0; row < t.ny; row++) {
    const y = t.north - (row + 0.5) * t.res;
    xs.length = 0;
    for (const e of buckets[row]) {
      const y0 = edges[e + 1], y1 = edges[e + 3];
      if ((y0 > y) === (y1 > y)) continue;
      const x0 = edges[e], x1 = edges[e + 2];
      xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - t.west) / t.res - 0.5));
      const c1 = Math.min(t.nx - 1, Math.floor((xs[k + 1] - t.west) / t.res - 0.5));
      for (let c = c0; c <= c1; c++) land[row * t.nx + c] ^= 1;
    }
  }
  return land;
}

let cached: Promise<Terrain> | null = null;

export function loadTerrain(base = '/'): Promise<Terrain> {
  cached ??= (async () => {
    try {
      const r = await fetch(`${base}data/terrain.json`);
      if (!r.ok) throw new Error(String(r.status));
      const t = (await r.json()) as TerrainFile;
      const e = b64(t.elevB64);
      return {
        west: t.west, north: t.north, res: t.res, nx: t.nx, ny: t.ny,
        elev: new Int16Array(e.buffer, e.byteOffset, e.byteLength >> 1),
        land: b64(t.landB64), source: 'terrain.json',
      };
    } catch {
      const spec = { west: -110, north: 50, res: 0.1, nx: 550, ny: 420 };
      const geo = (await (await fetch(`${base}basemap/land.json`)).json()) as { features: { geometry: Geo | null }[] };
      return { ...spec, elev: null, land: rasterize(geo.features, spec), source: 'basemap land polygons' };
    }
  })();
  return cached;
}

const cell = (t: Terrain, lon: number, lat: number) => {
  const c = Math.floor((lon - t.west) / t.res), r = Math.floor((t.north - lat) / t.res);
  return c < 0 || r < 0 || c >= t.nx || r >= t.ny ? -1 : r * t.nx + c;
};

/** Outside the grid counts as water (open Atlantic / Pacific). */
export const isLand = (t: Terrain, lon: number, lat: number) => {
  const i = cell(t, lon, lat);
  return i >= 0 && t.land[i] === 1;
};

export const elevAt = (t: Terrain, lon: number, lat: number) => {
  const i = cell(t, lon, lat);
  return i < 0 || !t.elev ? 0 : Math.max(0, t.elev[i]);
};

/** Terrain slope (m/m) toward east and north, central differences on the grid. */
export function gradAt(t: Terrain, lon: number, lat: number): [number, number] {
  if (!t.elev) return [0, 0];
  const d = t.res;
  const gx = (elevAt(t, lon + d, lat) - elevAt(t, lon - d, lat)) / (2 * d * kmPerDegLon(lat) * 1000);
  const gy = (elevAt(t, lon, lat + d) - elevAt(t, lon, lat - d)) / (2 * d * KM_PER_DEG_LAT * 1000);
  return [gx, gy];
}

/** Local relief (m) within ~radiusKm: a proxy for how flashy nearby basins are. */
export function reliefAt(t: Terrain, lon: number, lat: number, radiusKm = 20): number {
  if (!t.elev) return 0;
  const dLat = radiusKm / KM_PER_DEG_LAT, dLon = radiusKm / kmPerDegLon(lat);
  let lo = Infinity, hi = -Infinity;
  for (let y = lat - dLat; y <= lat + dLat; y += t.res) for (let x = lon - dLon; x <= lon + dLon; x += t.res) {
    const e = elevAt(t, x, y);
    lo = Math.min(lo, e); hi = Math.max(hi, e);
  }
  return Number.isFinite(hi - lo) ? hi - lo : 0;
}

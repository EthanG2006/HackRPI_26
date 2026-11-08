// Storm presets: NOAA HURDAT2 best tracks (hurdat_presets.json), falling back to the replay storms.
import { useApp } from '../store';
import type { Camera, LngLat, PresetStormsFile, StormFix, TrackPoint } from '../types';

export interface LabPreset {
  id: string;
  name: string;
  year: number;
  note: string;
  fixes: StormFix[];
  startTime: string;
  camera: Camera;
  kind: 'historical' | 'synthetic';
}

/** Best track → fixes. Hours are relative to the first record; positions keep their original coordinates. */
export function fixesFrom(track: TrackPoint[]): StormFix[] {
  const pts = track.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  const t0 = Date.parse(pts[0].t);
  return pts.map((p) => {
    const quads = (p.r34Nm ?? []).filter((q) => q > 0);
    return {
      lon: p.lon, lat: p.lat, origLon: p.lon, origLat: p.lat, hour: (Date.parse(p.t) - t0) / 3.6e6,
      vmaxKt: p.vmaxKt, ...(Number.isFinite(p.mslpMb) ? { pcHpa: p.mslpMb } : {}), ...(p.rmwNm && p.rmwNm > 0 ? { rmwKm: p.rmwNm * 1.852 } : {}),
      ...(quads.length ? { r34Km: (quads.reduce((a, b) => a + b, 0) / quads.length) * 1.852 } : {}),
    };
  });
}

export function cameraFor(points: LngLat[]): Camera {
  const lons = points.map((p) => p[0]), lats = points.map((p) => p[1]);
  const w = Math.min(...lons), e = Math.max(...lons), s = Math.min(...lats), n = Math.max(...lats);
  const span = Math.max(e - w, (n - s) * 1.4, 6);
  return { longitude: (w + e) / 2 + span * 0.08, latitude: (s + n) / 2, zoom: Math.max(3.2, Math.min(6.5, Math.log2(360 / span) + 0.4)), duration: 1600 };
}

const SYNTHETIC: { id: string; name: string; note: string; track: LngLat[]; vmax: number }[] = [
  { id: 'syn-pr', name: 'Category 4 into Puerto Rico', note: 'A Maria-like track across the island’s pharmaceutical corridor.', track: [[-58, 14.6], [-61.5, 15.9], [-64.4, 17.2], [-66.3, 18.2], [-68.2, 19.4], [-70.5, 21.2], [-72.4, 23.4]], vmax: 130 },
  { id: 'syn-gulf', name: 'Category 4 into the Gulf Coast', note: 'Landfall near Mobile Bay, then north through Alabama and Tennessee.', track: [[-86.2, 22.5], [-87.2, 25.4], [-88, 28], [-88.2, 30.3], [-87.6, 32.6], [-86.8, 35.2], [-85.6, 37.6]], vmax: 125 },
  { id: 'syn-carolina', name: 'Stalling Carolinas rainmaker', note: 'A Florence-style slow landfall; set a stall to explore extreme rain.', track: [[-71, 30.5], [-74.5, 32.5], [-77.2, 33.9], [-78.6, 34.6], [-80.6, 35.1], [-82.4, 36.2], [-82.8, 38.5]], vmax: 105 },
];

let cache: LabPreset[] | null = null;

export async function loadPresets(): Promise<LabPreset[]> {
  if (cache) return cache;
  const out: LabPreset[] = [];
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}data/hurdat_presets.json`);
    if (!r.ok) throw new Error(String(r.status));
    const file = (await r.json()) as PresetStormsFile;
    for (const s of file.storms) {
      if (s.track.length < 3) continue;
      const fixes = fixesFrom(s.track);
      out.push({ id: s.id, name: s.name, year: s.year, note: s.note, fixes, startTime: s.track[0].t, camera: cameraFor(fixes.map((f) => [f.lon, f.lat])), kind: 'historical' });
    }
  } catch {
    // Offline or not yet built: the replay storms carry their own best tracks.
    const storms = useApp.getState().storms;
    for (const [id, name, year, note] of [['helene', 'Helene', 2024, 'Inland flooding of Baxter North Cove'], ['maria', 'Maria', 2017, 'Puerto Rico’s pharmaceutical plants and power grid']] as const) {
      const bt = storms[id]?.storm?.bestTrack;
      if (!bt?.length) continue;
      const fixes = fixesFrom(bt);
      out.push({ id: storms[id]!.storm!.id, name, year, note, fixes, startTime: bt[0].t, camera: cameraFor(fixes.map((f) => [f.lon, f.lat])), kind: 'historical' });
    }
  }
  out.sort((a, b) => b.year - a.year);
  for (const s of SYNTHETIC)
    out.push({ id: s.id, name: s.name, year: 0, note: s.note, fixes: s.track.map(([lon, lat]) => ({ lon, lat, vmaxKt: s.vmax })), startTime: '', camera: cameraFor(s.track), kind: 'synthetic' });
  cache = out;
  return out;
}

/** Load a preset into the lab: track + per-point record, intensity target and camera. */
export function applyPreset(p: LabPreset) {
  const s = useApp.getState();
  const historical = p.kind === 'historical';
  const peak = Math.max(...p.fixes.map((f) => f.vmaxKt ?? 0));
  s.setWhatIf({
    track: p.fixes.map((f) => [f.lon, f.lat] as LngLat), fixes: historical ? p.fixes : null, presetId: p.id, startTime: historical ? p.startTime : undefined,
    lab: { ...s.whatif.lab, vmaxKt: historical ? s.whatif.lab.vmaxKt : peak }, drawing: false, result: null, error: undefined, hour: null, labPlaying: false,
  });
  s.set({ scenarioId: 'whatif', rightPanel: 'whatif', playing: false, equityOpen: false });
  s.flyTo(p.camera);
}

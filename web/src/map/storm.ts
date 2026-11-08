// Where the storm is "now": the interpolated best track (replay) or the Storm Lab control run (playback).
import type { AppState } from '../store';
import { labHourNow, seriesAt } from '../lab/labClock';

export interface StormState { lon: number; lat: number; vmax: number; rmwKm: number; pressure: number }

export function stormState(s: AppState, t: number): StormState | null {
  if (s.scenarioId === 'whatif') {
    const series = s.whatif.result?.series, hour = labHourNow(s);
    if (!series || hour === null) return null;
    const st = seriesAt(series, hour);
    return st && st.vmax >= 20 ? { lon: st.lon, lat: st.lat, vmax: st.vmax, rmwKm: st.rmwKm, pressure: st.pc } : null;
  }
  const bt = s.storms[s.scenarioId]?.storm?.bestTrack;
  if (!bt?.length) return null;
  const t0 = Date.parse(bt[0].t), t1 = Date.parse(bt[bt.length - 1].t);
  if (t < t0 || t > t1 + 6 * 3.6e6) return null;
  let i = 0;
  while (i < bt.length - 2 && Date.parse(bt[i + 1].t) <= t) i++;
  const a = bt[i], b = bt[Math.min(bt.length - 1, i + 1)];
  const ta = Date.parse(a.t), tb = Date.parse(b.t);
  const u = tb > ta ? Math.max(0, Math.min(1, (t - ta) / (tb - ta))) : 0;
  const mix = (x?: number, y?: number, fallback = 0) => (x ?? y ?? fallback) + ((y ?? x ?? fallback) - (x ?? y ?? fallback)) * u;
  const vmax = mix(a.vmaxKt, b.vmaxKt);
  if (vmax < 20) return null;
  return { lon: mix(a.lon, b.lon), lat: mix(a.lat, b.lat), vmax, rmwKm: mix(a.rmwNm, b.rmwNm, 35) * 1.852, pressure: mix(a.mslpMb, b.mslpMb, 970) };
}

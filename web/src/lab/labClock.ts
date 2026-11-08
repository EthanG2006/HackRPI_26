// Per-frame playback hour for the Storm Lab. React state syncs ~10×/s; the map reads this every frame.
import type { AppState } from '../store';
import type { LabSeries } from '../types';

export const labClock = { hour: 0, playing: false };

/** Smooth playback hour, or null when the lab shows storm totals. */
export function labHourNow(s: AppState): number | null {
  if (s.scenarioId !== 'whatif' || s.whatif.hour === null) return null;
  return labClock.playing ? labClock.hour : s.whatif.hour;
}

/** Interpolated control-run state at an hour. */
export function seriesAt(s: LabSeries, hour: number) {
  const hs = s.hours, n = hs.length;
  if (!n) return null;
  let i = 0;
  while (i < n - 2 && hs[i + 1] < hour) i++;
  const t = Math.max(0, Math.min(1, (hour - hs[i]) / Math.max(1e-6, hs[i + 1] - hs[i] || 1)));
  const mix = (a: number[]) => a[i] + ((a[Math.min(n - 1, i + 1)] ?? a[i]) - a[i]) * t;
  return { lon: mix(s.lon), lat: mix(s.lat), vmax: mix(s.ctrl ?? s.vmax.p50), rmwKm: mix(s.rmwKm), pc: mix(s.pc) };
}

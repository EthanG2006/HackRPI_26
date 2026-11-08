// Replay clock: advances store.time while playing and fires the Rx Radar alert when the clock crosses it.
import { useEffect } from 'react';
import { SIM_MS_PER_WALL_MS_AT_1X, activeScenario, useApp } from '../store';

// The store ticks ~8×/s (React work); per-frame drawing extrapolates from the last tick so motion stays fluid.
let tickWall = 0, tickTime = NaN;

/** Replay time for per-frame visuals: exact when paused or after a seek, extrapolated between ticks while playing. */
export function smoothTime(): number {
  const s = useApp.getState();
  if (!s.playing || s.time !== tickTime) return s.time;
  return s.time + Math.min(250, performance.now() - tickWall) * s.speed * SIM_MS_PER_WALL_MS_AT_1X;
}

export function useReplayClock(): void {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const s = useApp.getState();
      const dt = Math.min(250, now - last);
      if (!s.playing) last = now;
      if (s.playing && dt >= 125 && s.ready) {
        last = now;
        const sc = activeScenario(s);
        const end = sc ? Date.parse(sc.end) : Infinity;
        const next = Math.min(end, s.time + dt * s.speed * SIM_MS_PER_WALL_MS_AT_1X);
        const alertT = sc?.alert ? Date.parse(sc.alert.t) : NaN;
        const patch: Partial<typeof s> = { time: next };
        if (next >= end) patch.playing = false;
        tickWall = now;
        tickTime = next;
        useApp.setState(patch);
        if (s.alertFiredAt === null && s.time < alertT && next >= alertT) s.fireAlert();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}

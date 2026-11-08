// Runs the Storm Lab: on demand (whatifRunAt) and, in auto mode, ~350 ms after any setting changes.
import { useCallback, useEffect, useRef } from 'react';
import { useApp } from '../store';
import { runWhatIfInBrowser } from '../sim/whatif';
import { withHubOutages } from '../logistics/network';
import type { WhatIfRequest } from '../types';

export function useLabRunner() {
  const ready = useApp((s) => s.ready);
  const command = useApp((s) => s.whatifRunAt);
  const w = useApp((s) => s.whatif);
  const active = useApp((s) => s.scenarioId === 'whatif');
  const timer = useRef<number | undefined>(undefined);
  const lastKey = useRef('');

  const run = useCallback(async () => {
    const s = useApp.getState(), cur = s.whatif;
    if (cur.track.length < 2) return s.setWhatIf({ error: 'Draw at least two track points, or pick a preset.' });
    const req: WhatIfRequest = {
      track: cur.track, category: cur.category, forwardSpeedKt: cur.forwardSpeedKt, members: cur.lab.members,
      lab: cur.lab, fixes: cur.fixes ?? undefined, startTime: cur.startTime, hazard: cur.hazard.kind === 'hurricane' ? undefined : cur.hazard,
    };
    lastKey.current = key(cur);
    s.setWhatIf({ running: true, error: undefined });
    if (s.scenarioId !== 'whatif') s.set({ scenarioId: 'whatif', playing: false });
    try {
      const result = withHubOutages(await runWhatIfInBrowser(req), useApp.getState());
      useApp.getState().setWhatIf({ result, running: false });
      useApp.getState().set({ executedActions: [] }); // a new event needs a new plan
    } catch (e) {
      if ((e as Error).name !== 'AbortError') useApp.getState().setWhatIf({ running: false, error: (e as Error).message });
    }
  }, []);

  // Explicit run requests (Run button, presenter beat 6, copilot run_storm).
  useEffect(() => { if (command !== null && ready) void run(); }, [command, ready, run]);

  // Auto re-run when inputs change (not while drawing, not for playback-only changes).
  useEffect(() => {
    if (!active || !ready || !w.auto || w.drawing || w.track.length < 2) return;
    const k = key(w);
    if (k === lastKey.current) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void run(), 350);
    return () => window.clearTimeout(timer.current);
  }, [active, ready, w, run]);

  return run;
}

const key = (w: ReturnType<typeof useApp.getState>['whatif']) => JSON.stringify([w.track, w.fixes?.length, w.lab, w.forwardSpeedKt, w.category, w.hazard]);

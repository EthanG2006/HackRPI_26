// Shared derived data. The map colors hospitals with hospitalDays(); panels use the same numbers so they always agree.
import { activeScenario, type AppState } from '../store';
import type { PolicyResult } from '../types';

/** Drug that colors the map: the selected drug, else the scenario's first hero drug. */
export function focusDrugId(s: AppState): string | null {
  return s.selectedDrugId ?? activeScenario(s)?.heroDrugIds[0] ?? null;
}

/** Equity result on screen: the chosen policy, or for Rx Radar the frontier point nearest the lambda slider. */
export function equityResult(s: AppState): Pick<PolicyResult, 'stockoutDay' | 'coverage'> | null {
  const eq = s.equity[s.scenarioId];
  if (!eq) return null;
  if (s.policy === 'rxradar' && eq.frontier.length) {
    let best = eq.frontier[0];
    for (const f of eq.frontier) if (Math.abs(f.lambda - s.lambda) < Math.abs(best.lambda - s.lambda)) best = f;
    if (best.stockoutDay && best.coverage) return { stockoutDay: best.stockoutDay, coverage: best.coverage };
  }
  return eq.policies[s.policy] ?? null;
}

/**
 * Per-hospital P50 stockout day, aligned with s.hospitals (999 = none in horizon).
 * In the equity lab this is the selected allocation policy's outcome; otherwise the active scenario's forecast.
 */
export function hospitalDays(s: AppState): ArrayLike<number> | null {
  if (s.equityOpen) {
    const r = equityResult(s);
    if (r) return r.stockoutDay;
  }
  const sc = activeScenario(s);
  const d = focusDrugId(s);
  return (d && sc?.hospitalStockouts[d]?.p50) || null;
}

/** Earliest P50 stockout day across all at-risk drugs for one hospital index. */
export function worstDay(s: AppState, hospitalIdx: number): number {
  const sc = activeScenario(s);
  if (!sc) return 999;
  let best = 999;
  for (const band of Object.values(sc.hospitalStockouts)) best = Math.min(best, band.p50[hospitalIdx] ?? 999);
  return best;
}

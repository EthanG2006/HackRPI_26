// The impact story judges see: one hero number, hours of warning, and the with/without comparison.
// Figures derive from the scenario, equity and lab results, so the strip, scoreboard and map agree.
import { activeScenario, type AppState } from '../store';
import { IMPACT_SCALE, USD_PER_ENCOUNTER } from '../sim/realism';
import type { ScenarioId } from '../types';

export const REPLAYS: ScenarioId[] = ['helene', 'maria', 'rocky-mount'];

/** Hours between the first Rx Radar warning and the plant failing (null when nothing could warn). */
export function warningHours(s: AppState): number | null {
  const sc = activeScenario(s);
  if (!sc) return null;
  if (sc.backtest) return sc.backtest.leadTimeHours;
  const r = s.scenarioId === 'whatif' ? s.whatif.result : null;
  if (!r?.plantHazards || r.hazardKind === 'earthquake') return null;
  const hit = r.plantHazards.filter((h) => h.pDisrupt >= 0.3).sort((a, b) => b.pDisrupt - a.pDisrupt)[0];
  return hit ? Math.round(hit.peakHour) : null;
}

export interface CompareRow { label: string; without: number; with: number; fmt: 'int' | 'compact' | 'usd' | 'hours'; better: 'lower' | 'higher' }
/** Market scramble vs Rx Radar (early warning + fair allocation), from the replay's allocation model. */
export function comparison(s: AppState, id: ScenarioId) {
  const eq = s.equity[id], sc = s.scenarios[id];
  if (!eq || !sc) return null;
  const n = s.hospitals.length || eq.policies.market.stockoutDay.length, m = eq.policies.market.metrics, r = eq.policies.rxradar.metrics;
  const delayed = (x: number) => x * IMPACT_SCALE;
  const rows: CompareRow[] = [
    { label: 'Hospitals that run out', without: Math.round(m.pctStockedOut * n), with: Math.round(r.pctStockedOut * n), fmt: 'int', better: 'lower' },
    { label: 'Vulnerable-county hospitals that run out', without: m.highSviStockouts, with: r.highSviStockouts, fmt: 'int', better: 'lower' },
    { label: 'Rural hospitals that run out', without: m.ruralStockouts, with: r.ruralStockouts, fmt: 'int', better: 'lower' },
    { label: 'Patient care delayed', without: delayed(m.patientsDelayed), with: delayed(r.patientsDelayed), fmt: 'compact', better: 'lower' },
    { label: 'Cost of the shortage', without: delayed(m.patientsDelayed) * USD_PER_ENCOUNTER, with: delayed(r.patientsDelayed) * USD_PER_ENCOUNTER, fmt: 'usd', better: 'lower' },
  ];
  if (sc.backtest) rows.push({ label: 'Warning before the plant fails', without: 0, with: sc.backtest.leadTimeHours, fmt: 'hours', better: 'higher' });
  return { name: sc.name, drug: s.drugs.find((d) => d.id === eq.drugId)?.shortName ?? eq.drugId, kept: Math.round((m.pctStockedOut - r.pctStockedOut) * n), rows };
}

/** Totals across every replayed disaster (confirmed, post-impact figures). */
export function acrossReplays(s: AppState) {
  let patients = 0, dollars = 0, kept = 0, hours = 0, warned = 0;
  for (const id of REPLAYS) {
    const sc = s.scenarios[id], c = comparison(s, id);
    if (!sc) continue;
    patients += sc.impact.patientsProtected; dollars += sc.impact.dollarsSaved; kept += c?.kept ?? 0;
    if (sc.backtest) { hours += sc.backtest.leadTimeHours; warned++; }
  }
  return { patients, dollars, kept, avgWarning: warned ? hours / warned : 0, events: REPLAYS.filter((id) => s.scenarios[id]).length };
}

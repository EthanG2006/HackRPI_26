// Loads every static JSON file from web/public/data into the store.
// Rule: never block on data. A missing or broken file logs a warning and the panel shows its empty state.
import { useApp } from '../store';
import type {
  CountiesFile,
  Distributor,
  Drug,
  EquityFile,
  Fact,
  HazardModelFile,
  HospitalsFile,
  LiveSnapshot,
  ModelFile,
  NetworkFile,
  Plant,
  ScenarioFile,
  ScenarioId,
  Source,
  StormFile,
  TrendsFile,
} from '../types';

const BASE = `${import.meta.env.BASE_URL}data/`;

export async function loadJSON<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(BASE + path);
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    const msg = `data/${path}: ${(e as Error).message}`;
    console.warn('[rx-radar] missing data file', msg);
    useApp.setState((s) => ({ loadErrors: [...s.loadErrors, msg] }));
    return null;
  }
}

export const REPLAY_SCENARIOS: ScenarioId[] = ['helene', 'rocky-mount', 'maria'];

export async function loadAll(): Promise<void> {
  const [hospitals, counties, plants, drugs, distributors, network, sources, facts, trends, riskModel, hazardModel, live] = await Promise.all([
    loadJSON<HospitalsFile>('hospitals.json'),
    loadJSON<CountiesFile>('counties.json'),
    loadJSON<Plant[]>('plants.json'),
    loadJSON<Drug[]>('drugs.json'),
    loadJSON<Distributor[]>('distributors.json'),
    loadJSON<NetworkFile>('network.json'),
    loadJSON<Source[]>('sources.json'),
    loadJSON<Fact[]>('facts.json'),
    loadJSON<TrendsFile>('trends.json'),
    loadJSON<ModelFile>('model/risk_model.json'),
    loadJSON<HazardModelFile>('model/hazard_model.json'),
    loadJSON<LiveSnapshot>('live_cache.json'),
  ]);
  const hs = hospitals?.hospitals ?? [];
  useApp.setState({
    hospitals: hs,
    hospitalIndex: new Map(hs.map((h, i) => [h.id, i])),
    counties,
    plants: plants ?? [],
    drugs: drugs ?? [],
    distributors: distributors ?? [],
    network,
    sources: sources ?? [],
    facts: facts ?? [],
    trends,
    riskModel,
    hazardModel,
    live,
  });

  const perScenario = await Promise.all(
    REPLAY_SCENARIOS.map(async (id) => {
      const [scenario, storm, equity] = await Promise.all([
        loadJSON<ScenarioFile>(`scenarios/${id}.json`),
        loadJSON<StormFile>(`storms/${id}.json`),
        loadJSON<EquityFile>(`equity/${id}.json`),
      ]);
      return { id, scenario, storm, equity };
    }),
  );
  useApp.setState((s) => {
    const scenarios = { ...s.scenarios };
    const storms = { ...s.storms };
    const equity = { ...s.equity };
    for (const p of perScenario) {
      if (p.scenario) scenarios[p.id] = p.scenario;
      if (p.storm) storms[p.id] = p.storm;
      if (p.equity) equity[p.id] = p.equity;
    }
    return { scenarios, storms, equity, ready: true };
  });

  pollHealth();
}

async function pollHealth(): Promise<void> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch('/api/health', { signal: ctrl.signal });
    clearTimeout(timer);
    const j = (await res.json()) as { ok: boolean; anthropic?: boolean };
    useApp.setState({ api: { online: !!j.ok, anthropic: !!j.anthropic, checkedAt: Date.now() } });
  } catch {
    useApp.setState({ api: { online: false, anthropic: false, checkedAt: Date.now() } });
  }
  setTimeout(pollHealth, 10_000);
}

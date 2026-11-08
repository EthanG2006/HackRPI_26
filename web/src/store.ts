// Global app state (zustand). Shared by every teammate: add fields additively, never rename.
import { create } from 'zustand';
import type {
  AuditEntry,
  Camera,
  CountiesFile,
  Distributor,
  Drug,
  EquityFile,
  Fact,
  Hospital,
  LiveSnapshot,
  LngLat,
  ModelFile,
  HazardModelFile,
  NetworkFile,
  Plant,
  PolicyId,
  ScenarioFile,
  ScenarioId,
  Source,
  StormFile,
  TrendsFile,
  WhatIfResult,
  LabConfig,
  LabFieldId,
  StormFix,
} from './types';
import { CATEGORY_VMAX, DEFAULT_LAB } from './sim/lab/params';

export type LayerId =
  | 'storm' // cones + best track + eye spiral
  | 'wind' // Holland wind particles
  | 'radar' // NEXRAD replay / RainViewer live
  | 'satellite' // GOES/GIBS cloud imagery
  | 'rain' // WPC excessive rainfall outlooks
  | 'gauges' // USGS river gauges
  | 'flood' // FEMA flood zones near plants
  | 'tornado' // SPC outlooks + damage track
  | 'plants'
  | 'network' // supply arcs
  | 'hospitals'
  | 'svi' // CDC SVI choropleth
  | 'nri'; // FEMA NRI choropleth

export type PageId = 'model-card' | 'sources' | 'under-the-hood' | 'audit' | 'climate' | 'impact' | null;
export type RightPanelId = 'drugs' | 'drug' | 'hospital' | 'equity' | 'whatif';

/** Replay clock: at 1x one wall-clock second advances this many simulated milliseconds (15 minutes). */
export const SIM_MS_PER_WALL_MS_AT_1X = 900;
export const SPEEDS = [1, 2, 4, 8, 16, 32, 64] as const;

export interface WhatIfState {
  drawing: boolean;
  track: LngLat[];
  category: 1 | 2 | 3 | 4 | 5;
  forwardSpeedKt: number;
  running: boolean;
  result: WhatIfResult | null;
  error?: string;
  // ---- Storm Lab ----
  lab: LabConfig; // physics + ensemble settings
  fixes: StormFix[] | null; // per-point record from a historical preset (aligned with track)
  presetId: string | null;
  startTime?: string; // ISO time of hour 0 (presets)
  field: LabFieldId; // hazard field drawn on the map
  hour: number | null; // playback hour; null = storm totals
  labPlaying: boolean;
  auto: boolean; // re-run automatically when a setting changes
}

export interface AppState {
  // ---- static data (loaded once by src/data/load.ts) ----
  ready: boolean;
  loadErrors: string[];
  hospitals: Hospital[];
  hospitalIndex: Map<string, number>; // id -> index in hospitals (alignment for per-hospital arrays)
  plants: Plant[];
  drugs: Drug[];
  distributors: Distributor[];
  network: NetworkFile | null;
  counties: CountiesFile | null;
  sources: Source[];
  facts: Fact[];
  trends: TrendsFile | null;
  riskModel: ModelFile | null;
  hazardModel: HazardModelFile | null;
  scenarios: Partial<Record<ScenarioId, ScenarioFile>>;
  storms: Partial<Record<ScenarioId, StormFile>>;
  equity: Partial<Record<ScenarioId, EquityFile>>;
  live: LiveSnapshot | null;

  // ---- scenario + replay clock ----
  scenarioId: ScenarioId;
  time: number; // ms epoch on the replay clock
  playing: boolean;
  speed: number; // one of SPEEDS

  // ---- camera ----
  /** Pending fly-to. MapView consumes it and clears it. */
  camera: Camera | null;

  // ---- layers ----
  layers: Record<LayerId, boolean>;

  // ---- selection / highlight ----
  selectedDrugId: string | null;
  selectedHospitalId: string | null;
  selectedPlantId: string | null;
  highlight: { ids: string[]; label: string } | null; // hospital ids pulsed on the map

  // ---- alert + shockwave (wall-clock ms; null = not fired) ----
  alertFiredAt: number | null;
  shockwaveAt: number | null;

  // ---- chrome ----
  introDone: boolean;
  rightPanel: RightPanelId;
  page: PageId;
  copilotOpen: boolean;
  paletteOpen: boolean;
  notesOpen: boolean;
  beat: number; // presenter beat 0..8 (0 = title)
  muted: boolean;

  // ---- equity lab ----
  equityOpen: boolean;
  policy: PolicyId;
  lambda: number; // 0 = pure efficiency, 1 = max equity (frontier position)
  abmDay: number;
  abmPlaying: boolean;

  // ---- what-if ----
  whatif: WhatIfState;

  // ---- backend status ----
  api: { online: boolean; anthropic: boolean; checkedAt: number };

  // ---- human-in-the-loop audit log ----
  audit: AuditEntry[];

  // ---- cross-team commands (set by presenter beats / copilot; consumed by the owning component) ----
  /** Copilot drawer opens and asks this question (owner: copilot). */
  copilotAsk: { text: string; at: number } | null;
  /** WhatIfPanel runs the ensemble with the current `whatif` state when this changes (owner: map). */
  whatifRunAt: number | null;
  /** Panels generate the CMO briefing PDF for this hospital id (owner: panels). */
  briefingFor: { hospitalId: string; at: number } | null;
  /** Equity lab starts/stops the hoarding animation (owner: equity). */
  equityAutoplayAt: number | null;

  // ---- actions ----
  set: (patch: Partial<AppState>) => void;
  setTime: (t: number) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  flyTo: (camera: Camera) => void;
  toggleLayer: (id: LayerId, on?: boolean) => void;
  setLayers: (patch: Partial<Record<LayerId, boolean>>) => void;
  selectDrug: (id: string | null) => void;
  openHospital: (id: string | null, fly?: boolean) => void;
  setHighlight: (ids: string[], label: string) => void;
  clearHighlight: () => void;
  fireAlert: () => void;
  resetAlert: () => void;
  setWhatIf: (patch: Partial<WhatIfState>) => void;
  addAudit: (entry: Omit<AuditEntry, 'id' | 'at'>) => void;
}

const DEFAULT_LAYERS: Record<LayerId, boolean> = {
  storm: true,
  wind: true,
  radar: true,
  satellite: false,
  rain: true,
  gauges: true,
  flood: false,
  tornado: true,
  plants: true,
  network: true,
  hospitals: true,
  svi: false,
  nri: false,
};

const AUDIT_KEY = 'rxradar.audit.v1';
function loadAudit(): AuditEntry[] {
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(AUDIT_KEY) ?? '[]');
    return Array.isArray(rows) ? rows.filter(row => row && typeof row.action === 'string' && typeof row.at === 'string') : [];
  } catch {
    return [];
  }
}

export const useApp = create<AppState>()((set, get) => ({
  ready: false,
  loadErrors: [],
  hospitals: [],
  hospitalIndex: new Map(),
  plants: [],
  drugs: [],
  distributors: [],
  network: null,
  counties: null,
  sources: [],
  facts: [],
  trends: null,
  riskModel: null,
  hazardModel: null,
  scenarios: {},
  storms: {},
  equity: {},
  live: null,

  scenarioId: 'helene',
  time: Date.parse('2024-09-23T21:00:00Z'),
  playing: false,
  speed: 16,

  camera: null,
  layers: DEFAULT_LAYERS,

  selectedDrugId: null,
  selectedHospitalId: null,
  selectedPlantId: null,
  highlight: null,

  alertFiredAt: null,
  shockwaveAt: null,

  introDone: false,
  rightPanel: 'drugs',
  page: null,
  copilotOpen: false,
  paletteOpen: false,
  notesOpen: false,
  beat: 0,
  muted: false,

  equityOpen: false,
  policy: 'market',
  lambda: 0.5,
  abmDay: 0,
  abmPlaying: false,

  whatif: { drawing: false, track: [], category: 4, forwardSpeedKt: 12, running: false, result: null,
    lab: DEFAULT_LAB, fixes: null, presetId: null, field: 'p64', hour: null, labPlaying: false, auto: true },

  api: { online: false, anthropic: false, checkedAt: 0 },
  audit: loadAudit(),

  copilotAsk: null,
  whatifRunAt: null,
  briefingFor: null,
  equityAutoplayAt: null,

  set: (patch) => set(patch),
  setTime: (t) => set({ time: t }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  flyTo: (camera) => set({ camera }),
  toggleLayer: (id, on) => set((s) => ({ layers: { ...s.layers, [id]: on ?? !s.layers[id] } })),
  setLayers: (patch) => set((s) => ({ layers: { ...s.layers, ...patch } })),
  selectDrug: (id) => set({ selectedDrugId: id, rightPanel: id ? 'drug' : 'drugs' }),
  openHospital: (id, fly = true) => {
    const s = get();
    if (!id) return set({ selectedHospitalId: null, rightPanel: 'drugs' });
    const i = s.hospitalIndex.get(id);
    const h = i === undefined ? undefined : s.hospitals[i];
    set({
      selectedHospitalId: id,
      rightPanel: 'hospital',
      ...(fly && h ? { camera: { longitude: h.lon, latitude: h.lat, zoom: 9.5, pitch: 40, bearing: 0, duration: 2500 } } : {}),
    });
  },
  setHighlight: (ids, label) => set({ highlight: { ids, label } }),
  clearHighlight: () => set({ highlight: null }),
  fireAlert: () => {
    const now = performance.now();
    set({ alertFiredAt: now, shockwaveAt: now + 600 });
  },
  resetAlert: () => set({ alertFiredAt: null, shockwaveAt: null }),
  setWhatIf: (patch) => set((s) => {
    const next = { ...s.whatif, ...patch };
    // Callers that only know "category" (copilot, presenter) set the lab intensity through it.
    if (patch.category && !patch.lab) next.lab = { ...next.lab, vmaxKt: CATEGORY_VMAX[patch.category] };
    // A new track without its own fixes is a drawn storm: drop the historical record.
    if (patch.track && !('fixes' in patch)) { next.fixes = null; next.presetId = null; next.startTime = undefined; }
    return { whatif: next };
  }),
  addAudit: (entry) => {
    const full: AuditEntry = { ...entry, id: crypto.randomUUID(), at: new Date().toISOString() };
    const audit = [full, ...get().audit];
    try {
      localStorage.setItem(AUDIT_KEY, JSON.stringify(audit));
    } catch {
      /* private mode: keep in memory */
    }
    set({ audit });
  },
}));

/** The scenario currently on screen. For 'whatif' it is assembled from the live result. */
export function useActiveScenario(): ScenarioFile | null {
  return useApp((s) => activeScenario(s));
}

let lastEnsemble: { result: WhatIfResult; category: number } | undefined;
let assembled: ScenarioFile | null = null;
let replaySource: ScenarioFile | undefined;
let replaySnapshot: NonNullable<ScenarioFile['predictionSnapshots']>[number] | undefined;
let replayView: ScenarioFile | null = null;
export function activeScenario(s: AppState): ScenarioFile | null {
  if (s.scenarioId !== 'whatif') {
    const base = s.scenarios[s.scenarioId];
    if (!base) return null;
    // The equity lab explores a specified plant-outage contingency across policies.
    if (s.equityOpen || !base.predictionSnapshots?.length) return base;
    const available = base.predictionSnapshots.filter(p => Date.parse(p.t) <= s.time);
    const snapshot = available.at(-1) ?? base.predictionSnapshots[0];
    if (base === replaySource && snapshot === replaySnapshot && replayView) return replayView;
    replaySource = base;
    replaySnapshot = snapshot;
    return replayView = { ...base, drugRisk: snapshot.drugRisk, hospitalStockouts: snapshot.hospitalStockouts,
      outages: snapshot.outages, impact: snapshot.impact };
  }
  const r = s.whatif.result;
  if (!r) return null;
  if (lastEnsemble?.result === r && lastEnsemble.category === s.whatif.category && assembled) return assembled;
  lastEnsemble = { result:r, category:s.whatif.category };
  const base = s.scenarios.helene;
  const day0 = s.whatif.startTime ?? new Date().toISOString();
  return assembled = {
    id: 'whatif',
    name: 'What-if storm',
    subtitle: `Category ${s.whatif.category} · ${r.members.toLocaleString()} ensemble tracks · ${Math.round(r.elapsedMs)} ms (${r.engine})`,
    start:day0,
    end:new Date(Date.parse(day0)+90*86400000).toISOString(),
    day0,
    heroPlantIds: [...r.outages].sort((a, b) => b.pDisrupt - a.pDisrupt).slice(0, 3).map((o) => o.plantId),
    heroDrugIds: [...r.drugRisk].sort((a, b) => b.risk - a.risk).slice(0, 3).map((d) => d.drugId),
    camera: s.scenarios.helene?.camera ?? { longitude: -80, latitude: 30, zoom: 4 },
    events: [],
    hazard: [],
    outages: r.outages,
    drugRisk: r.drugRisk,
    hospitalStockouts: r.hospitalStockouts,
    impact: r.impact ?? emptyImpact(),
    provenance: 'MODEL',
  };
}

export function emptyImpact(): ScenarioFile['impact'] {
  return { patientsProtected: 0, dollarsSaved: 0, co2TonsAvoided: 0, highSviPreventedPct: 0, breakdown: { patients: [], dollars: [], co2: [], equity: [] } };
}

export const getHospital = (id: string | null): Hospital | undefined => {
  if (!id) return undefined;
  const s = useApp.getState();
  const i = s.hospitalIndex.get(id);
  return i === undefined ? undefined : s.hospitals[i];
};

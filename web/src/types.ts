// Rx Radar data contracts: the single source of truth for every JSON file in web/public/data/.
// Python producers (pipeline/, server/) must emit exactly these shapes (camelCase keys, ISO-8601 UTC times).
// Change a shape only additively (new optional fields) so other teammates keep compiling.

/** Every number and layer carries one of these. Shown as a badge in the UI. */
export type Provenance =
  | 'REAL' // published/measured data (FDA, CMS, CDC, NOAA observations)
  | 'REPLAY' // archived weather products replayed at their original issue time (forecast cones, outlooks, radar)
  | 'MODEL' // Rx Radar model estimate, always with uncertainty
  | 'SIMULATED'; // synthetic stand-in where public data does not exist

export interface Sourced {
  provenance: Provenance;
  sourceIds?: string[]; // ids in sources.json
}

export type LngLat = [number, number]; // [lon, lat]
export type Ring = LngLat[];
export type PolygonCoords = Ring[]; // GeoJSON Polygon coordinates
export type MultiPolygonCoords = PolygonCoords[];

// ---------- sources.json / facts.json / trends.json (owner: facts agent) ----------

export interface Source {
  id: string; // kebab-case, e.g. "nhc-gis-archive"
  name: string;
  publisher: string;
  url: string;
  retrieved: string; // YYYY-MM-DD
  license: string; // e.g. "Public domain (US Gov)", "CC BY 4.0"
  usedFor: string;
  status: 'used' | 'cached' | 'stand-in'; // stand-in = we simulated because the source failed
  notes?: string;
}

export interface Fact {
  id: string; // e.g. "helene-baxter-60pct"
  text: string; // exactly as shown in the UI
  sourceIds: string[];
  verified: boolean;
  note?: string; // how it was verified or corrected
}

export interface TrendsFile {
  /** NOAA (or successor) billion-dollar disasters per year. */
  disasters: { year: number; count: number; costBn?: number }[];
  /** Active US drug shortages (ASHP) per year or quarter. */
  shortages: { period: string; year: number; active: number }[];
  sourceIds: string[];
}

// ---------- hospitals.json (owner: geo/weather data agent) ----------

export type HospitalType = 'acute' | 'critical_access' | 'childrens' | 'other';

export interface Hospital {
  id: string; // CMS CCN (6 chars) when available
  name: string;
  city: string;
  state: string; // 2-letter
  lat: number;
  lon: number;
  beds: number;
  type: HospitalType;
  rural: boolean;
  safetyNet: boolean;
  pediatric: boolean; // children's hospital (or documented pediatric unit)
  fips: string; // 5-digit county FIPS
  svi: number; // CDC SVI overall percentile of the county, 0..1 (RPL_THEMES)
  system?: string; // health-system name if part of one
  systemSize?: number; // hospitals in that system (used by the hoarding sim)
  provenance: Provenance; // REAL for CMS rows; SIMULATED if a field was imputed (see imputed)
  imputed?: string[]; // field names that were imputed
}

export interface HospitalsFile {
  hospitals: Hospital[];
  sourceIds: string[];
}

/** counties.json: per-county attributes keyed by 5-digit FIPS. Geometry comes from us-atlas (bundled). */
export interface CountyAttrs {
  svi: number; // 0..1
  nriHurricane?: number; // FEMA NRI risk score 0..100
  nriRiverine?: number;
  nriTornado?: number;
  rural?: boolean;
  name?: string;
}
export interface CountiesFile {
  counties: Record<string, CountyAttrs>;
  sourceIds: string[];
}

// ---------- plants.json, drugs.json, distributors.json, network.json (owner: supply-network + risk agent) ----------

export interface Plant extends Sourced {
  id: string; // kebab-case, e.g. "baxter-north-cove"
  name: string; // "Baxter North Cove"
  company: string;
  fei?: string; // FDA Establishment Identifier
  address?: string;
  city: string;
  state: string; // US state / "PR"
  country: string; // "US"
  lat: number;
  lon: number;
  drugIds: string[]; // drugs made here
  share: Record<string, number>; // drugId -> estimated share of US supply (0..1)
  shareProvenance: Provenance; // usually MODEL unless publicly stated (e.g. Baxter ~60% IV fluids)
  linkConfidence: number; // 0..1, confidence of the drug->plant links overall
  sterileInjectable: boolean;
  floodZone?: string; // FEMA NFHL zone, e.g. "AE", "X"
  riverDistKm?: number;
  elevationM?: number;
  nri?: { hurricane?: number; riverine?: number; tornado?: number }; // county NRI scores 0..100
  notes?: string;
}

export interface ShapItem {
  feature: string; // machine name
  label: string; // human sentence, e.g. "One plant makes ~60% of supply"
  value: number; // contribution in model output units (log-odds or probability; see ModelFile.shapUnits)
}

export interface Drug {
  id: string; // kebab-case, e.g. "sodium-chloride-0-9-iv"
  name: string; // "0.9% Sodium Chloride Injection"
  shortName: string; // "Normal saline"
  class: string; // "IV fluid", "Oncology", "Anesthesia", ...
  form: string; // "injection" | "solution" | "oral suspension" | "inhalation" ...
  sterileInjectable: boolean;
  whoEssential: boolean; // WHO Model List of Essential Medicines (23rd, 2023)
  noAlternative: boolean;
  pediatric: boolean; // critical pediatric use
  manufacturers: number; // distinct manufacturers (openFDA NDC)
  hhi: number; // market concentration 0..10000
  nadacPerUnit?: number; // USD, Medicaid NADAC (REAL) when available
  contractPricePerUnit: number; // USD per unit (MODEL if not published)
  unit: string; // "bag", "vial", "mL" ...
  grayMarketMultiplier: number; // typical gray-market markup during shortage (source in assumptions)
  baselineRisk: number; // LightGBM P(shortage within 12 months), 0..1
  baselineRiskCI: [number, number];
  shap: ShapItem[]; // baseline (weather-free) drivers
  pastShortages: number; // FDA/ASHP shortage episodes
  currentlyShort: boolean;
  alternatives: { name: string; note: string; sourceIds?: string[] }[];
  conservation: { strategy: string; note?: string; sourceIds?: string[] }[];
  dailyUsePer100Beds: number; // units/day per 100 staffed beds (MODEL)
  provenance: Provenance;
  sourceIds?: string[];
}

export interface Distributor extends Sourced {
  id: string;
  name: string; // "Cardinal Health DC — Atlanta"
  company: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
}

export interface NetworkNode {
  id: string; // "drug:<id>" | "labeler:<name>" | "plant:<id>" | "dc:<id>"
  kind: 'drug' | 'labeler' | 'plant' | 'distributor';
  label: string;
  refId?: string; // id in plants/drugs/distributors
}
export interface NetworkEdge {
  source: string;
  target: string;
  kind: 'labeled-by' | 'made-at' | 'ships-to';
  confidence: number; // 0..1
  evidence?: string; // e.g. "Label text: 'Manufactured by Baxter Healthcare, Marion, NC' (fuzzy match 94)"
  provenance: Provenance;
}
export interface NetworkFile {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  /** Plant -> DC flows used by the map arcs. volume is relative (0..1). */
  flows: { plantId: string; dcId: string; drugIds: string[]; volume: number }[];
  sourceIds: string[];
}

// ---------- model/*.json (owner: risk-model agent and simulation agent) ----------

export interface CurvePoint {
  x: number;
  y: number;
}
export interface ModelFile {
  name: string; // "Baseline shortage-risk model (LightGBM)"
  version: string;
  trainedAt: string;
  shapUnits: 'log-odds' | 'probability';
  split: string; // description of the time-based split
  nTrain: number;
  nTest: number;
  metrics: { rocAuc: number; prAuc: number; brier: number; baseRate: number; [k: string]: number };
  roc: CurvePoint[];
  pr: CurvePoint[];
  calibration: { predicted: number; observed: number; n: number }[];
  featureImportance: { feature: string; label: string; meanAbsShap: number }[];
  fairness: { group: string; slice: string; n: number; rocAuc?: number; prAuc?: number; brier?: number; flag?: string }[];
  limitations: string[];
  provenance: Provenance;
}

export interface HazardModelFile {
  name: string; // "Plant weather-disruption model (Bayesian logistic)"
  features: { feature: string; label: string; priorMean: number; priorSd: number; postMean: number; postSd: number; rationale: string }[];
  nEvents: number;
  nNonEvents: number;
  events: { plantId: string; event: string; date: string; disrupted: boolean; sourceIds?: string[] }[];
  notes: string[];
  provenance: Provenance;
}

// ---------- storms/<scenarioId>.json (owner: geo/weather data agent) ----------

export interface TrackPoint {
  t: string;
  lat: number;
  lon: number;
  vmaxKt: number;
  mslpMb?: number;
  rmwNm?: number; // radius of max wind (HURDAT2 from 2021; estimated before)
  status: string; // HU, TS, TD, EX, LO, ...
  r34Nm?: [number, number, number, number]; // NE, SE, SW, NW
}

export interface Advisory {
  num: string; // "11", "11A"
  issued: string; // ISO time the advisory became public
  cone?: PolygonCoords | MultiPolygonCoords;
  forecast: { t: string; lat: number; lon: number; vmaxKt: number }[]; // official forecast points
}

export interface StormData extends Sourced {
  id: string; // "AL092024"
  name: string; // "Helene"
  bestTrack: TrackPoint[];
  advisories: Advisory[];
}

export type EroCategory = 'MRGL' | 'SLGT' | 'MDT' | 'HIGH';
export interface RainOutlook extends Sourced {
  issued: string;
  validStart: string;
  validEnd: string;
  day: 1 | 2 | 3 | 4 | 5;
  areas: { category: EroCategory; polygon: PolygonCoords | MultiPolygonCoords }[];
}

export interface GaugeSeries extends Sourced {
  siteId: string; // "USGS-02137727"
  name: string;
  lat: number;
  lon: number;
  unit: 'ft' | 'cfs';
  points: { t: string; v: number }[];
  floodStage?: number; // same unit
  majorFlood?: number;
  nearPlantId?: string;
  distanceKm?: number; // gauge to plant
  note?: string; // e.g. "gauge stopped reporting at peak"
}

export interface TornadoTrack extends Sourced {
  t: string;
  rating: string; // "EF3"
  path: LngLat[];
  widthYd?: number;
  lengthMi?: number;
  peakWindMph?: number;
}

export interface SpcOutlook extends Sourced {
  issued: string;
  validStart: string;
  validEnd: string;
  kind: 'categorical' | 'tornado';
  areas: { label: string; polygon: PolygonCoords | MultiPolygonCoords }[]; // label: "TSTM".."HIGH" or "0.02".."0.60" or "SIGN"
}

export interface RasterFrame {
  t: string;
  url: string; // relative to web/public, e.g. "data/radar/helene/202409270000.png"
  bounds: [number, number, number, number]; // [west, south, east, north]
}

export interface FloodZone {
  plantId: string;
  zone: string; // FEMA zone at the plant point
  polygons?: (PolygonCoords | MultiPolygonCoords)[]; // nearby SFHA polygons for drawing
  provenance: Provenance;
}

export interface StormFile {
  scenarioId: ScenarioId;
  storm?: StormData;
  rainfall?: RainOutlook[];
  gauges?: GaugeSeries[];
  tornado?: TornadoTrack;
  spc?: SpcOutlook[];
  radar?: { provenance: Provenance; sourceIds: string[]; frames: RasterFrame[] };
  satellite?: { provenance: Provenance; sourceIds: string[]; frames: RasterFrame[] };
  floodZones?: FloodZone[];
}

// ---------- scenarios/<scenarioId>.json (owner: simulation agent) ----------

export type ScenarioId = 'helene' | 'rocky-mount' | 'maria' | 'live' | 'whatif';

export interface Camera {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch?: number;
  bearing?: number;
  duration?: number; // ms for fly-to
}

export type EventKind =
  | 'advisory'
  | 'outlook'
  | 'watch'
  | 'landfall'
  | 'plant-hit'
  | 'alert'
  | 'allocation'
  | 'fda-listing'
  | 'restart'
  | 'other';

export interface TimelineEvent {
  t: string;
  kind: EventKind;
  label: string; // short pin label
  detail?: string;
  sourceIds?: string[];
  provenance: Provenance;
  pin?: boolean; // show as a pin on the timeline (advisories default to ticks)
}

export interface Alert {
  t: string; // when Rx Radar fires (replay clock)
  cutoff: string; // information cutoff: latest product used was issued at or before this time
  productsUsed: string[]; // e.g. ["NHC Advisory 11 (2024-09-25 15:00Z)", "WPC Day 2 ERO (2024-09-25 08:00Z)"]
  plantId: string;
  prob: number; // disruption probability at alert time
  probCI: [number, number];
  threshold: number;
  leadTimeHours: number; // alert -> actual plant failure
  actualEventT: string; // actual plant failure (REAL)
  drivers: string[]; // human sentences
  message: string; // push notification body
}

export interface HazardPoint {
  t: string; // advisory issue time
  plantId: string;
  p: number;
  lo: number; // 80% credible interval
  hi: number;
  inputs: { windProb34?: number; windProb64?: number; eroCategory?: EroCategory | null; minDistKm?: number; tornadoProb?: number };
}

export interface PlantOutage {
  plantId: string;
  pDisrupt: number;
  ci: [number, number];
  outageDays: { p10: number; p50: number; p90: number };
}

export interface Band {
  p10: number[];
  p50: number[];
  p90: number[];
}

export interface DrugRisk {
  drugId: string;
  risk: number; // P(national shortage) given this scenario, 0..1
  ci: [number, number];
  supplyCurve: Band; // fraction of normal US supply, index = day from scenario day0, 90 entries
  hospitalsAtRisk: number; // projected to stock out within horizon (P50)
  firstStockoutDay?: number; // P50 day of first hospital stockout
  shap: ShapItem[]; // scenario-specific waterfall (baseline + weather drivers)
}

/** Per drug, arrays aligned with hospitals.json order. Day index from day0. 999 = no stockout within horizon. */
export type HospitalStockouts = Record<string, Band>;

export interface ImpactItem {
  key: string;
  label: string;
  value: number;
  unit: string;
  assumption: string; // one line, shown in the breakdown
  sourceIds?: string[];
  provenance: Provenance;
}
export interface Impact {
  patientsProtected: number;
  dollarsSaved: number;
  co2TonsAvoided: number;
  highSviPreventedPct: number; // share of stockouts prevented that are in high-vulnerability counties, 0..1
  breakdown: Record<'patients' | 'dollars' | 'co2' | 'equity', ImpactItem[]>;
}

export interface Backtest {
  scenarioId: ScenarioId;
  alertT: string;
  plantFailureT: string;
  fdaListingT?: string;
  leadTimeHours: number; // alert -> plant failure
  leadTimeToListingDays?: number;
  notes: string;
}

export interface ScenarioFile {
  id: ScenarioId;
  name: string; // "Hurricane Helene"
  subtitle: string; // "Baxter North Cove, Marion NC — Sept 2024"
  start: string; // replay window
  end: string;
  day0: string; // day index 0 for supply curves / stockouts
  heroPlantIds: string[];
  heroDrugIds: string[];
  camera: Camera;
  events: TimelineEvent[];
  alert?: Alert;
  hazard: HazardPoint[];
  outages: PlantOutage[];
  drugRisk: DrugRisk[];
  hospitalStockouts: HospitalStockouts;
  /** Baseline days on hand per hospital per drug, aligned with hospitals.json. */
  inventoryDoh?: Record<string, number[]>;
  impact: Impact;
  backtest?: Backtest;
  provenance: Provenance;
  notes?: string[];
}

// ---------- equity/<scenarioId>.json (owner: equity agent) ----------

export type PolicyId = 'market' | 'proportional' | 'rxradar';

export interface PolicyMetrics {
  pctStockedOut: number; // 0..1 of hospitals
  highSviStockouts: number; // count of stocked-out hospitals in top-quartile SVI counties
  ruralStockouts: number;
  patientsDelayed: number;
  gini: number; // Gini of supply coverage across hospitals, 0..1
  totalCostUsd: number;
  efficiency: number; // need-weighted coverage, 0..1
  equity: number; // min group coverage (or 1 - normalized gap), 0..1
}

export interface PolicyResult {
  metrics: PolicyMetrics;
  coverage: number[]; // aligned with hospitals.json, 0..1 share of need met
  stockoutDay: number[]; // aligned, 999 = none
  daily?: { day: number; stockedOut: number; highSviStockedOut: number; ordersVsDemand: number }[]; // ABM timeline
}

export interface EquityFile {
  scenarioId: ScenarioId;
  drugId: string;
  horizonDays: number;
  supplyFraction: number; // available supply / normal demand during the shortage
  policies: Record<PolicyId, PolicyResult>;
  frontier: { lambda: number; metrics: PolicyMetrics; stockoutDay?: number[]; coverage?: number[] }[];
  bullwhip?: { day: number; orders: number; demand: number; supply: number }[];
  notes: string[];
  provenance: Provenance;
}

// ---------- what-if (owner: simulation agent; POST /api/whatif, browser fallback in src/sim) ----------

export interface WhatIfRequest {
  track: LngLat[]; // drawn by the user, >= 2 points, ordered in time
  category: 1 | 2 | 3 | 4 | 5;
  forwardSpeedKt: number;
  members?: number; // default 1000
}

export interface WhatIfResult {
  engine: 'numpy' | 'browser';
  elapsedMs: number;
  members: number;
  sampleTracks: LngLat[][]; // ~40 ensemble members for the spaghetti plot
  cone?: PolygonCoords;
  outages: PlantOutage[];
  drugRisk: DrugRisk[];
  hospitalStockouts: HospitalStockouts;
  impact?: Impact;
}

// ---------- live (owner: geo/weather data agent; GET /api/live, cached snapshot in data/live_cache.json) ----------

export interface LiveSnapshot {
  fetchedAt: string;
  fromCache: boolean;
  activeStorms: { id: string; name: string; classification: string; intensityKt: number; lat: number; lon: number; forecast?: { t: string; lat: number; lon: number; vmaxKt: number }[]; cone?: PolygonCoords | MultiPolygonCoords }[];
  alerts: { id: string; event: string; severity: string; headline: string; areaDesc: string; polygon?: PolygonCoords | MultiPolygonCoords; onset?: string; expires?: string }[];
  spc?: SpcOutlook;
  headline: string; // e.g. "No active tropical cyclones. Highest risk today: Moderate risk of severe storms over …"
  sourceIds: string[];
}

// ---------- audit log (client side, persisted to localStorage) ----------

export interface AuditEntry {
  id: string;
  at: string; // ISO wall-clock time
  user: string; // "Pharmacist (demo)"
  hospitalId: string;
  action: string;
  decision: 'approved' | 'rejected';
  reason: string;
  scenarioId: ScenarioId;
}

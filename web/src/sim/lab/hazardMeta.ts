// Disaster catalog for the lab: what each type means, its controls, presets, legend and site fragility.
// Shared by the UI (main thread) and the hazard engine (worker), so it holds no heavy imports.
import type { HazardConfig, HazardKind, LngLat } from '../../types';

export interface FieldLegend { label: string; unit: string; stops: [number, string, number][]; levels: number[]; fmt: (v: number) => string; source: string }
export interface HazardPreset { id: string; name: string; note: string; track: LngLat[]; intensity: number; extent: number; durationH: number }
export interface SliderSpec { key: 'intensity' | 'extent' | 'durationH'; label: string; min: number; max: number; step: number; fmt: (v: number) => string; hint?: string }
export interface HazardMeta {
  kind: HazardKind;
  name: string; // "Earthquake"
  noun: string; // headline noun: "M7.7 earthquake"
  draw: string; // what the drawn points mean
  sliders: SliderSpec[];
  presets: HazardPreset[];
  field: FieldLegend;
  headline: (h: HazardConfig) => string;
  site: (v: number) => string; // a plant's hazard value as text
  clock: (t: number) => string; // playback time label
  fragility: (v: number) => number; // P(site stops) from the mapped field value
  playRate: number; // timeline units per second of playback
}

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
export const roman = (v: number) => ROMAN[Math.max(0, Math.min(12, Math.round(v)))];
const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const PROB: [number, string, number][] = [[0.02, '#4fb3b5', 0], [0.1, '#5cc3bd', 0.42], [0.3, '#9bcf8e', 0.55], [0.5, '#e8c46a', 0.62], [0.7, '#eb9a5a', 0.68], [0.9, '#de6556', 0.74], [1, '#c8414e', 0.78]];
const hours = (v: number) => (v >= 48 ? `${Math.round(v / 24)} days` : `${Math.round(v)} h`);

export const HAZARDS: Record<HazardKind, HazardMeta> = {
  hurricane: {
    kind: 'hurricane', name: 'Hurricane', noun: 'hurricane', draw: 'Drag the track points to move the storm.', sliders: [], presets: [],
    field: { label: '', unit: '', stops: PROB, levels: [], fmt: String, source: '' },
    headline: () => 'Hurricane', site: (v) => `${Math.round(v)} kt`, clock: (t) => `+${Math.round(t)} h`,
    fragility: (kt) => logistic((kt - 72) / 9), playRate: 9,
  },
  earthquake: {
    kind: 'earthquake', name: 'Earthquake', noun: 'earthquake', draw: 'First point is the epicenter; the second sets the rupture direction.',
    sliders: [
      { key: 'intensity', label: 'Magnitude', min: 6, max: 9.2, step: 0.1, fmt: (v) => `M${v.toFixed(1)}`, hint: 'Each step of 1.0 releases ~32× more energy.' },
      { key: 'extent', label: 'Focal depth', min: 5, max: 40, step: 1, fmt: (v) => `${v} km`, hint: 'Shallow quakes shake the surface harder.' },
    ],
    presets: [
      { id: 'eq-newmadrid', name: 'New Madrid M7.7', note: 'Central-US fault under Memphis, the nation’s freight and distribution hub', track: [[-89.59, 36.55], [-89.85, 35.95]], intensity: 7.7, extent: 10, durationH: 240 },
      { id: 'eq-sanandreas', name: 'San Andreas M7.8', note: 'Southern California injectables cluster and the Riverside hub', track: [[-115.71, 33.35], [-117.3, 34.25]], intensity: 7.8, extent: 8, durationH: 240 },
      { id: 'eq-pr', name: 'Puerto Rico M7.2', note: 'Island pharma corridor; the 2020 M6.4 blacked out the whole grid', track: [[-66.82, 17.88], [-66.35, 17.95]], intensity: 7.2, extent: 12, durationH: 240 },
      { id: 'eq-charleston', name: 'Charleston M7.3', note: 'Repeat of 1886: Carolinas inhalation and injectables plants', track: [[-80.15, 32.9], [-80.6, 33.3]], intensity: 7.3, extent: 10, durationH: 240 },
    ],
    field: {
      label: 'Shaking intensity', unit: 'Modified Mercalli (MMI)', levels: [6, 7, 8], fmt: roman, source: 'Rupture-distance attenuation; central-US crust carries shaking ~2× farther',
      stops: [[4.5, '#5cc3bd', 0], [5, '#7cc9a8', 0.18], [6, '#e8c46a', 0.42], [7, '#eb9a5a', 0.6], [8, '#de6556', 0.72], [9, '#c8414e', 0.8], [10.5, '#a83850', 0.86]],
    },
    headline: (h) => `M${h.intensity.toFixed(1)} earthquake`, site: (v) => `MMI ${roman(v)}`,
    clock: (t) => `T+${Math.round(t)} s · S-wave ${Math.round(3.5 * t)} km out`,
    fragility: (mmi) => (mmi < 4 ? 0 : logistic(2 * (mmi - 6.6))), playRate: 22,
  },
  wildfire: {
    kind: 'wildfire', name: 'Wildfire', noun: 'wildfire', draw: 'First point is the ignition; the second is where the wind drives it.',
    sliders: [
      { key: 'intensity', label: 'Wind', min: 10, max: 80, step: 5, fmt: (v) => `${v} mph`, hint: 'Santa Ana and Diablo winds gust past 60 mph.' },
      { key: 'extent', label: 'Fuel dryness', min: 40, max: 100, step: 5, fmt: (v) => `${v}%`, hint: 'Drought-cured fuels burn several times faster.' },
      { key: 'durationH', label: 'Burning period', min: 12, max: 120, step: 6, fmt: hours },
    ],
    presets: [
      { id: 'wf-santaana', name: 'Santa Ana firestorm', note: 'Inland Empire to Orange County: Riverside hub and the Irvine IV plant', track: [[-117.25, 34.15], [-117.86, 33.69]], intensity: 70, extent: 98, durationH: 72 },
      { id: 'wf-blueridge', name: 'Blue Ridge drought fire', note: 'Helene blowdown fuels near Marion and Lenoir', track: [[-82.25, 35.72], [-81.6, 35.95]], intensity: 40, extent: 90, durationH: 96 },
      { id: 'wf-texas', name: 'Hill Country grassfire', note: 'Wind-driven grass fire toward the Austin infusion plant', track: [[-98.25, 30.2], [-97.7, 30.44]], intensity: 50, extent: 90, durationH: 48 },
    ],
    field: {
      label: 'Fire impact', unit: 'smoke · evacuation · burned', levels: [0.25, 0.6, 0.9], source: 'Elliptical wind-driven spread with ember fringe and downwind power shutoffs',
      fmt: (v) => (v < 0.15 ? '' : v < 0.4 ? 'Smoke' : v < 0.75 ? 'Evac' : v <= 1 ? 'Burn' : ''),
      stops: [[0.05, '#d9a85b', 0], [0.2, '#e3b062', 0.35], [0.5, '#eb8a4a', 0.58], [0.8, '#e0553f', 0.74], [1.15, '#b8302f', 0.88]],
    },
    headline: (h) => `${h.intensity} mph wildfire`, site: (v) => (v >= 0.9 ? 'inside burn' : v >= 0.45 ? 'evacuation zone' : v >= 0.15 ? 'smoke / power shutoff' : 'clear'),
    clock: (t) => `Hour ${Math.round(t)}`, fragility: (v) => (v < 0.03 ? 0 : logistic(9 * (v - 0.45))), playRate: 7,
  },
  flood: {
    kind: 'flood', name: 'River flood', noun: 'river flood', draw: 'Trace the river from upstream to downstream.',
    sliders: [
      { key: 'intensity', label: 'Crest above flood stage', min: 2, max: 30, step: 1, fmt: (v) => `${v} ft`, hint: 'Helene crested the Swannanoa ~27 ft above normal.' },
      { key: 'durationH', label: 'Flood duration', min: 24, max: 336, step: 12, fmt: hours },
    ],
    presets: [
      { id: 'fl-appalachia', name: 'Appalachian flash flood', note: 'Helene-style: North Toe and Catawba rivers through North Cove and Lenoir', track: [[-82.35, 36.0], [-82.0, 35.84], [-81.55, 35.92], [-81.1, 35.72]], intensity: 26, extent: 0, durationH: 60 },
      { id: 'fl-mississippi', name: 'Mississippi great flood', note: 'Memphis hub, Delta plants and river freight shut down', track: [[-90.18, 38.62], [-89.5, 37.0], [-90.05, 35.15], [-90.75, 33.9], [-91.0, 32.3], [-91.2, 30.45]], intensity: 22, extent: 0, durationH: 240 },
      { id: 'fl-houston', name: 'Houston bayou flood', note: 'Harvey-style rains over the Gulf Coast reserve site', track: [[-95.9, 29.83], [-95.37, 29.76], [-95.0, 29.73], [-94.8, 29.6]], intensity: 18, extent: 0, durationH: 120 },
    ],
    field: {
      label: 'Flood depth', unit: 'ft of water', levels: [1, 3, 8], fmt: (v) => v.toFixed(v < 3 ? 1 : 0), source: 'Crest routed downstream with an exponential floodplain profile',
      stops: [[0.3, '#4a8fb4', 0], [1, '#4f9fc4', 0.42], [3, '#4fb39c', 0.55], [6, '#9fcb6c', 0.62], [10, '#ead074', 0.68], [16, '#ec9a58', 0.74], [26, '#dc5d58', 0.82]],
    },
    headline: (h) => `+${h.intensity} ft river flood`, site: (v) => (v < 0.2 ? 'dry' : `${v.toFixed(1)} ft of water`),
    clock: (t) => `Day ${(t / 24).toFixed(1)}`, fragility: (d) => (d < 0.2 ? 0 : logistic(1.6 * (d - 1.5))), playRate: 14,
  },
  tornado: {
    kind: 'tornado', name: 'Tornado outbreak', noun: 'tornado outbreak', draw: 'Draw the path of the strongest tornado; others spin up around it.',
    sliders: [
      { key: 'intensity', label: 'Strongest tornado', min: 1, max: 5, step: 1, fmt: (v) => `EF${v}`, hint: 'EF3+ tornadoes level warehouses (Rocky Mount 2023 was EF3).' },
      { key: 'extent', label: 'Tornadoes in outbreak', min: 3, max: 40, step: 1, fmt: (v) => `${v}` },
      { key: 'durationH', label: 'Outbreak window', min: 4, max: 24, step: 1, fmt: hours },
    ],
    presets: [
      { id: 'to-carolinas', name: 'Carolinas outbreak', note: 'Rocky Mount and Wilson injectables corridor (2023 EF3 repeat)', track: [[-78.62, 35.54], [-77.78, 36.045], [-77.05, 36.5]], intensity: 4, extent: 16, durationH: 10 },
      { id: 'to-dixie', name: 'Dixie Alley outbreak', note: 'Night tornadoes across the Delta toward Memphis', track: [[-91.4, 32.6], [-90.7, 33.76], [-89.6, 35.0]], intensity: 5, extent: 30, durationH: 14 },
      { id: 'to-midwest', name: 'Great Lakes outbreak', note: 'Chicago hub, Round Lake and Kalamazoo plants', track: [[-89.2, 41.6], [-88.13, 42.33], [-85.56, 42.21]], intensity: 4, extent: 20, durationH: 10 },
    ],
    field: { label: 'Tornado damage potential', unit: 'P(within 25 mi)', levels: [0.05, 0.15, 0.3], fmt: (v) => `${Math.round(v * 100)}%`, source: 'Outbreak tracks with EF-weighted 25-mile kernels, like SPC outlooks', stops: [[0.01, '#d9a85b', 0], [0.05, '#e3b062', 0.4], [0.15, '#e88a52', 0.55], [0.3, '#d9574f', 0.7], [0.6, '#b8404f', 0.82]] },
    headline: (h) => `EF${h.intensity} tornado outbreak`, site: (v) => (v >= 0 ? `EF${Math.round(v)} direct hit` : v > -1 ? 'within 4 km' : 'outside paths'),
    clock: (t) => `+${t.toFixed(1)} h`, fragility: (v) => Math.min(0.95, v * 1.6), playRate: 1.2,
  },
  winter: {
    kind: 'winter', name: 'Ice storm', noun: 'ice storm', draw: 'Draw the centerline of the freezing-rain band.',
    sliders: [
      { key: 'intensity', label: 'Ice accretion', min: 0.25, max: 2, step: 0.05, fmt: (v) => `${v.toFixed(2)} in`, hint: 'Above ~0.5 in, lines and towers fail; plants lose steam and purified water.' },
      { key: 'durationH', label: 'Duration', min: 24, max: 168, step: 12, fmt: hours },
    ],
    presets: [
      { id: 'wi-uri', name: 'Texas deep freeze', note: 'Uri-style grid collapse: Austin and Houston plants, Dallas hub', track: [[-101.5, 34.5], [-97.6, 31.6], [-95.3, 29.85], [-93.0, 30.4]], intensity: 1.1, extent: 0, durationH: 96 },
      { id: 'wi-ohio', name: 'Ohio Valley ice storm', note: 'Columbus and Cleveland injectables, Bloomington, Chicago lanes', track: [[-92.0, 36.3], [-86.5, 39.2], [-81.2, 41.4]], intensity: 1.25, extent: 0, durationH: 72 },
      { id: 'wi-noreaster', name: 'Northeast ice and blizzard', note: 'I-95 freight shutdown; New Jersey sterile plants and the Albany hub', track: [[-77.5, 38.4], [-74.6, 40.3], [-73.6, 42.6]], intensity: 0.85, extent: 0, durationH: 60 },
    ],
    field: { label: 'Ice accretion', unit: 'in, radial', levels: [0.25, 0.5, 1], fmt: (v) => v.toFixed(2), source: 'Freezing-rain band with a Gaussian cross-section, swept along the front', stops: [[0.05, '#9ad0f5', 0], [0.25, '#8cc6ef', 0.42], [0.5, '#7aa9e8', 0.56], [0.75, '#a58ce6', 0.66], [1, '#d07ad8', 0.74], [1.6, '#e85fb0', 0.84]] },
    headline: (h) => `${h.intensity.toFixed(2)}-in ice storm`, site: (v) => (v < 0.05 ? 'no ice' : `${v.toFixed(2)} in ice`),
    clock: (t) => `Hour ${Math.round(t)}`, fragility: (v) => (v < 0.05 ? 0 : logistic(4.5 * (v - 0.55))), playRate: 10,
  },
};

export const HAZARD_ORDER: HazardKind[] = ['hurricane', 'earthquake', 'wildfire', 'flood', 'tornado', 'winter'];

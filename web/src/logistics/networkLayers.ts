// Map layers for the supply network: curved lanes sized by volume, severed lanes, hubs, last-mile spokes,
// and the animated shipments / newly dispatched reroutes (cloned per frame by MapView).
import { LineLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { TripsLayer } from '@deck.gl/geo-layers';
import { PathStyleExtension } from '@deck.gl/extensions';
import type { Layer } from '@deck.gl/core';
import { useApp, type AppState } from '../store';
import { hubOfHospital, networkView, type Action, type Hub, type Lane, type LaneState } from './network';
import type { LngLat } from '../types';

type RGB = [number, number, number];
export const LANE_RGB: Record<LaneState, RGB> = { flowing: [84, 214, 228], 'at-risk': [242, 168, 64], down: [255, 77, 90] };
export const ACTION_RGB: RGB = [91, 228, 155];
export const HUB_RGB: Record<Hub['status'], RGB> = { normal: [84, 214, 228], strained: [242, 168, 64], critical: [255, 92, 70], down: [255, 45, 85] };

const curves = new Map<string, LngLat[]>();
/** Quadratic bezier between two places, bowed to the left of travel so parallel lanes separate. */
export function curve(a: LngLat, b: LngLat, bend = 0.17): LngLat[] {
  const key = `${a}|${b}|${bend}`;
  let c = curves.get(key);
  if (c) return c;
  const dx = b[0] - a[0], dy = b[1] - a[1], cx = (a[0] + b[0]) / 2 - dy * bend, cy = (a[1] + b[1]) / 2 + dx * bend;
  c = [];
  for (let i = 0; i <= 32; i++) { const t = i / 32, u = 1 - t; c.push([u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cy + t * t * b[1]]); }
  curves.set(key, c);
  return c;
}
const bendFor = (a: Action) => (a.kind === 'import' ? 0.12 : a.kind === 'transfer' ? -0.22 : 0.2);
const hash = (id: string) => { let h = 7; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h; };

let spokeKey: unknown[] = [], spokeCache: { from: LngLat; to: LngLat; hub: number }[] = [];
/** A thinned sample of hub → hospital deliveries. */
function spokes(s: AppState, zoom: number) {
  const per = zoom < 4.5 ? 16 : zoom < 6 ? 36 : 90, hub = hubOfHospital(s);
  if (spokeKey[0] === hub && spokeKey[1] === per) return spokeCache;
  const groups = s.distributors.map(() => [] as number[]);
  hub.forEach((k, i) => groups[k].push(i));
  spokeCache = groups.flatMap((idx, k) => {
    const step = Math.max(1, Math.floor(idx.length / per)), dc = s.distributors[k];
    return idx.filter((_, j) => j % step === 0).slice(0, per).map((i) => ({ from: [dc.lon, dc.lat] as LngLat, to: [s.hospitals[i].lon, s.hospitals[i].lat] as LngLat, hub: k }));
  });
  spokeKey = [hub, per];
  return spokeCache;
}

export type HubPick = { kind: 'hub'; hub: Hub };
export function networkLayers(s: AppState, zoom: number, onHover: (hub: Hub | null, x: number, y: number) => void): Layer[] {
  const net = networkView(s);
  if (!net) return [];
  const maxU = Math.max(1, ...net.lanes.map((l) => l.units)), maxH = Math.max(1, ...net.hubs.map((h) => h.hospitals));
  const width = (l: Lane) => 1 + 3.4 * Math.sqrt(l.units / maxU), path = (l: Lane) => curve(l.from, l.to);
  const live = net.lanes.filter((l) => l.state !== 'down'), down = net.lanes.filter((l) => l.state === 'down');
  const status = net.hubs.map((h) => h.status), trig = [net];
  const transitions = { getColor: { duration: 700 }, getWidth: { duration: 700 } };
  return [
    new LineLayer({ id: 'last-mile', data: spokes(s, zoom), getSourcePosition: (d) => d.from, getTargetPosition: (d) => d.to, widthUnits: 'pixels', getWidth: 0.6,
      getColor: (d) => { const st = status[d.hub]; return [...HUB_RGB[st], st === 'normal' ? 26 : st === 'strained' ? 55 : 80] as [number, number, number, number]; }, updateTriggers: { getColor: trig }, transitions }),
    new PathLayer<Lane>({ id: 'lane-glow', data: live, getPath: path, widthUnits: 'pixels', getWidth: (l) => width(l) * 2.6, getColor: (l) => [...LANE_RGB[l.state], l.state === 'flowing' ? 12 : 26],
      capRounded: true, jointRounded: true, updateTriggers: { getColor: trig }, transitions }),
    new PathLayer<Lane>({ id: 'lanes', data: live, getPath: path, widthUnits: 'pixels', getWidth: width, getColor: (l) => [...LANE_RGB[l.state], l.state === 'flowing' ? 110 : 190],
      capRounded: true, jointRounded: true, updateTriggers: { getColor: trig }, transitions }),
    new PathLayer<Lane>({ id: 'lanes-down', data: down, getPath: path, widthUnits: 'pixels', getWidth: (l: Lane) => Math.max(1.6, width(l) * 0.8), getColor: [255, 77, 90, 215],
      getDashArray: [3, 2.2], dashJustified: true, extensions: [new PathStyleExtension({ dash: true })] } as never),
    new TextLayer<Lane>({ id: 'lane-breaks', data: down, getPosition: (l) => path(l)[16], getText: () => '✕', getSize: 15, getColor: [255, 110, 110, 255], fontWeight: 800,
      fontFamily: 'Inter Variable, Inter, sans-serif', outlineWidth: 4, outlineColor: [8, 18, 26, 230], fontSettings: { sdf: true }, characterSet: ['✕'] }),
    new ScatterplotLayer<Hub>({ id: 'hub-halo', data: net.hubs, getPosition: (h) => [h.dc.lon, h.dc.lat], radiusUnits: 'pixels', getRadius: (h) => 11 + 9 * Math.sqrt(h.hospitals / maxH),
      getFillColor: (h) => [...HUB_RGB[h.status], h.status === 'normal' ? 22 : 48], updateTriggers: { getFillColor: trig }, transitions: { getFillColor: 700 } }),
    new ScatterplotLayer<Hub>({ id: 'hubs', data: net.hubs, pickable: true, getPosition: (h) => [h.dc.lon, h.dc.lat], radiusUnits: 'pixels', getRadius: (h) => 4.5 + 3.5 * Math.sqrt(h.hospitals / maxH),
      getFillColor: [8, 22, 30, 255], stroked: true, lineWidthUnits: 'pixels', getLineWidth: 2.2, getLineColor: (h) => [...HUB_RGB[h.status], 255],
      onHover: (info) => onHover(info.object ?? null, info.x, info.y), onClick: (info) => { if (info.object) useApp.getState().set({ rightPanel: 'logistics', equityOpen: false }); },
      updateTriggers: { getLineColor: trig }, transitions: { getLineColor: 700 } }),
  ];
}

interface Trip { path: [number, number, number][]; times: number[]; color: [number, number, number, number]; period?: number }
// Repeats one comet geometry per lane in the shader instead of drawing many copies.
class ShipmentLayer extends TripsLayer<Trip, { getPeriod: (p: Trip) => number }> {
  static layerName = 'ShipmentLayer';
  static defaultProps = { ...TripsLayer.defaultProps, getPeriod: { type: 'accessor' as const, value: 30 } };
  initializeState() {
    super.initializeState();
    this.getAttributeManager()!.addInstanced({ instancePeriod: { size: 1, accessor: 'getPeriod', defaultValue: 30 } });
  }
  getShaders() {
    const shaders = super.getShaders();
    shaders.inject = { ...shaders.inject,
      'vs:#decl': shaders.inject['vs:#decl'] + '\nin float instancePeriod; out float vPeriod;',
      'vs:#main-end': shaders.inject['vs:#main-end'] + '\nvPeriod = instancePeriod;',
      'fs:#decl': shaders.inject['fs:#decl'] + '\nin float vPeriod;',
      'fs:DECKGL_FILTER_COLOR': `float age = mod(trips.currentTime - vTime, vPeriod);
        if(age > trips.trailLength) discard;
        color.a *= 1.0 - age / trips.trailLength;`,
    };
    return shaders;
  }
}

const z0 = (p: LngLat[]): [number, number, number][] => p.map(([x, y]) => [x, y, 0]);
let motionNet: unknown = null, motionCache: Layer[] = [];
/** Moving shipments on live lanes, and the draw-in of newly dispatched reroutes. Ids starting 'grow' run on wall time. */
export function networkMotion(s: AppState): Layer[] {
  if (!s.layers.network) return [];
  const net = networkView(s);
  if (!net) return [];
  if (net === motionNet) return motionCache;
  const trips: Trip[] = [];
  for (const l of net.lanes) {
    if (l.state === 'down') continue;
    const path = z0(curve(l.from, l.to)), slow = l.state === 'at-risk' ? 2.2 : 1, phase = hash(l.id) % 60;
    trips.push({ path, times: path.map((_, i) => phase + i * 1.9 * slow), color: [...LANE_RGB[l.state], 255], period: l.state === 'at-risk' ? 80 : 26 });
  }
  const dispatched = net.executed.filter((a) => a.from && a.to);
  for (const a of dispatched) {
    const path = z0(curve(a.from!, a.to!, bendFor(a)));
    trips.push({ path, times: path.map((_, i) => (hash(a.id) % 40) + i * 1.2), color: [...ACTION_RGB, 255], period: 13 });
  }
  const grow = (id: string, w: number, alpha: number) => new TripsLayer<Action & { at: number }>({ id, data: dispatched, getPath: (a) => z0(curve(a.from!, a.to!, bendFor(a))),
    getTimestamps: (a) => Array.from({ length: 33 }, (_, i) => a.at / 1000 + (1.6 * i) / 32), getColor: [...ACTION_RGB, alpha], widthUnits: 'pixels', getWidth: w,
    trailLength: 1e6, fadeTrail: false, currentTime: 0, capRounded: true, jointRounded: true });
  motionNet = net;
  return (motionCache = [
    grow('grow-glow', 10, 46), grow('grow-core', 3.2, 235),
    new ShipmentLayer({ id: 'moving-shipments', data: trips, getPeriod: (p: Trip) => p.period ?? 30, getPath: (p) => p.path, getTimestamps: (p) => p.times, getColor: (p) => p.color,
      getWidth: 2.6, widthUnits: 'pixels', trailLength: 3.2, fadeTrail: true, currentTime: 0, capRounded: true }),
  ]);
}

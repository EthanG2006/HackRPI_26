// Supply network command: where supply stops, which hubs run dry, and the reroutes that fix it.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRightLeft, Check, Plane, Scale, ShieldCheck, Sparkles, Truck, Warehouse, X, LoaderCircle } from 'lucide-react';
import { useApp } from '../store';
import { networkView, type Action, type Hub } from './network';
import { HUB_RGB } from './networkLayers';
import { Tick } from '../panels/ImpactCounters';
import { fmtCompact, fmtUsd } from '../lib/format';
import { Prov } from '../ui/Prov';
import type { LngLat } from '../types';
import './logistics.css';

const ICON = { reroute: Truck, transfer: ArrowRightLeft, import: Plane, allocate: Scale, conserve: ShieldCheck } as const;
const KIND = { reroute: 'Reroute', transfer: 'Hub transfer', import: 'Emergency import', allocate: 'Allocation', conserve: 'Demand' } as const;
const rgb = (c: number[], a = 1) => `rgb(${c[0]} ${c[1]} ${c[2]} / ${a})`;
const eta = (h: number) => (h < 48 ? `${h} h` : `${Math.round(h / 24)} d`);
const pct = (v: number) => `${Math.round(v * 100)}%`;

function fit(a: LngLat, b: LngLat) {
  const span = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]) * 1.3, 3);
  useApp.getState().flyTo({ longitude: (a[0] + b[0]) / 2, latitude: (a[1] + b[1]) / 2, zoom: Math.max(2.6, Math.min(6.5, Math.log2(360 / span) - 0.2)), duration: 1300 });
}

export default function LogisticsPanel() {
  const show = useApp((s) => s.rightPanel === 'logistics' && s.introDone && !s.equityOpen);
  const net = useApp(networkView), executed = useApp((s) => s.executedActions), scenario = useApp((s) => s.scenarioId), hasRun = useApp((s) => !!s.whatif.result);
  const [planning, setPlanning] = useState<{ step: number; total: number } | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => { timers.current.forEach(clearTimeout); setPlanning(null); }, [scenario]);
  if (!show) return null;

  const done = new Set(executed.map((e) => e.id));
  const dispatch = (a: Action) => { const s = useApp.getState(); if (!s.executedActions.some((e) => e.id === a.id)) s.set({ executedActions: [...s.executedActions, { id: a.id, at: performance.now() }] }); };
  const undo = (a: Action) => useApp.getState().set({ executedActions: useApp.getState().executedActions.filter((e) => e.id !== a.id) });
  function autoPlan() {
    if (!net) return;
    const queue = net.actions.filter((a) => !done.has(a.id));
    useApp.getState().flyTo({ longitude: -86, latitude: 36.5, zoom: 3.9, duration: 1200 });
    setPlanning({ step: 0, total: queue.length });
    queue.forEach((a, i) => timers.current.push(window.setTimeout(() => { dispatch(a); setPlanning({ step: i + 1, total: queue.length }); }, 700 + i * 520)));
    timers.current.push(window.setTimeout(() => setPlanning(null), 900 + queue.length * 520));
  }

  const k = net?.kpi, empty = scenario === 'whatif' && !hasRun;
  const healthy = !!net && !net.actions.length;
  const hubs = net ? [...net.hubs].sort((a, b) => a.ratio - b.ratio) : [];
  return (
    <motion.aside className="right-rail lx-rail" aria-label="Supply network command" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 30 }}>
      <header className="lx-head">
        <span className="eyebrow"><span className="status-dot lx-live" />Supply network command</span>
        <h2>Reroute supply</h2>
        <p>{empty ? 'Run a disaster in the lab to see which lanes it cuts.' : net ? `${net.lanes.length} lanes · ${net.hubs.length} hubs · ${net.hubs.reduce((a, h) => a + h.hospitals, 0).toLocaleString()} hospitals · ${net.drugLabel}` : 'Loading the network…'}</p>
      </header>
      {k && !empty && <div className="lx-body">
        <section className="lx-gauge">
          <div className="lx-gauge-top">
            <div><small>National {net!.drugLabel} supply · inbound to hubs</small><b className="num" style={{ color: k.supplyPct < 0.6 ? '#ff6a5a' : k.supplyPct < 0.9 ? '#f2a840' : '#83e8da' }}><Tick value={k.supplyPct} format={pct} /></b></div>
            {k.restored > 0 && <span className="lx-restored num">+<Tick value={k.restoredPct} format={pct} /> restored</span>}
          </div>
          <div className="lx-bar" role="img" aria-label={`Supply at ${pct(k.supplyPct)} of normal`}>
            <i style={{ width: pct(Math.max(0, k.supplyPct - k.restoredPct)) }} /><em style={{ width: pct(Math.min(k.restoredPct, 1 - (k.supplyPct - k.restoredPct))) }} />
          </div>
          <div className="lx-kpis">
            <div><b className="num">{k.lanesDown}<small>/{net!.lanes.length}</small></b><span>lanes severed</span></div>
            <div><b className="num"><Tick value={Math.max(0, k.normal - k.current)} format={(v) => fmtCompact(v)} /></b><span>units/wk short</span></div>
            <div><b className="num">{k.hubsStrained}</b><span>hubs strained</span></div>
            <div><b className="num">{k.firstRunout === null ? '—' : `Day ${k.firstRunout}`}</b><span>first hub dry</span></div>
          </div>
        </section>

        {healthy ? <div className="lx-calm"><Check size={16} />Network nominal. Every hub is receiving at least 97% of normal flow.</div> : <section className="lx-section">
          <div className="lx-section-head">
            <h3>Recommended actions</h3>
            <button className="lx-auto" disabled={!!planning || net!.actions.every((a) => done.has(a.id))} onClick={autoPlan}>
              {planning ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}{planning ? `Dispatching ${planning.step}/${planning.total}` : 'Run optimal plan'}
            </button>
          </div>
          <p className="lx-solver num">Min-cost flow over {net!.hubs.length} hubs × {net!.lanes.length + net!.actions.length} candidate lanes · ranked by patients protected per hour of lead time</p>
          <AnimatePresence initial={false}>
            {net!.actions.map((a, i) => {
              const I = ICON[a.kind], on = done.has(a.id);
              return (
                <motion.article layout key={a.id} className={`lx-action${on ? ' on' : ''}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                  <button className="lx-action-main" onClick={() => a.from && a.to && fit(a.from, a.to)}>
                    <span className={`lx-icon lx-${a.kind}`}><I size={16} /></span>
                    <span className="lx-action-text">
                      <small>{KIND[a.kind]}{a.preemptive ? ' · pre-emptive' : ''}</small>
                      <b>{a.title}</b>
                      <span>{a.detail}</span>
                    </span>
                  </button>
                  <div className="lx-metrics num">
                    <span><b>+{fmtCompact(a.units)}</b>units/wk</span>
                    <span><b>{eta(a.etaH)}</b>ETA</span>
                    <span><b>{fmtCompact(a.patients)}</b>patients</span>
                    <span><b>{a.costUsd ? fmtUsd(a.costUsd) : '$0'}</b>cost</span>
                  </div>
                  {on ? <div className="lx-dispatched"><Check size={14} />Dispatched{a.from ? ` · arriving in ${eta(a.etaH)}` : ' · in effect'}<button aria-label={`Cancel ${a.title}`} onClick={() => undo(a)}><X size={13} /></button></div>
                    : <button className="lx-go" onClick={() => { dispatch(a); if (a.from && a.to) fit(a.from, a.to); }}>Dispatch</button>}
                </motion.article>
              );
            })}
          </AnimatePresence>
        </section>}

        {k.patients > 0 && <section className="lx-impact"><span className="eyebrow">Plan impact <Prov kind="SIMULATED" compact /></span>
          <div><b className="num"><Tick value={k.patients} format={(v) => fmtCompact(v)} /></b><span>patient encounters protected</span></div>
          <div><b className="num"><Tick value={k.dollars} format={fmtUsd} /></b><span>cancellations & premiums avoided</span></div>
        </section>}

        <section className="lx-section">
          <div className="lx-section-head"><h3>Distribution hubs</h3><Prov kind="SIMULATED" compact /></div>
          {hubs.map((h) => <HubRow key={h.dc.id} h={h} />)}
        </section>
        <div className="lx-legend">
          <span><i style={{ background: '#54d6e4' }} />Flowing</span><span><i style={{ background: '#f2a840' }} />At risk</span>
          <span><i className="dash" />Severed</span><span><i style={{ background: '#5be49b' }} />Dispatched</span>
        </div>
      </div>}
    </motion.aside>
  );
}

function HubRow({ h }: { h: Hub }) {
  const c = HUB_RGB[h.status], ratio = Math.min(1, h.ratio);
  return (
    <button className="lx-hub" onClick={() => useApp.getState().flyTo({ longitude: h.dc.lon, latitude: h.dc.lat, zoom: 6, duration: 1100 })}>
      <span className="lx-hub-dot" style={{ background: rgb(c), boxShadow: `0 0 0 4px ${rgb(c, 0.18)}` }} />
      <span className="lx-hub-name"><b>{h.dc.city}, {h.dc.state}</b><small>{h.hospitals.toLocaleString()} hospitals · {h.status === 'down' ? 'warehouse offline' : h.runoutDay !== null ? `dry by day ${h.runoutDay}` : `${Math.round(h.daysOnHand)} days on hand`}</small></span>
      <span className="lx-hub-bar"><i style={{ width: `${ratio * 100}%`, background: rgb(c) }} /></span>
      <span className="lx-hub-pct num" style={{ color: rgb(c) }}>{Math.round(h.ratio * 100)}%</span>
      <Warehouse size={13} className="lx-hub-icon" />
    </button>
  );
}

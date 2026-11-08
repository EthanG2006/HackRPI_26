// Storm Lab: a parametric hurricane hazard simulator wired to the medicine supply network.
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { LoaderCircle, Play } from 'lucide-react';
import { useApp } from '../store';
import { useLabRunner } from '../lab/useLabRunner';
import { loadPresets, type LabPreset } from '../lab/presets';
import { categoryLabel } from '../sim/lab/params';
import { HAZARDS } from '../sim/lab/hazardMeta';
import QuickStormSetup from '../lab/QuickStormSetup';
import LabResults from '../lab/LabResults';
import LabMethod from '../lab/LabMethod';
import LabOverlay from '../lab/LabOverlay';
import '../lab/lab.css';

const TABS = ['Scenario', 'Supply impact', 'How it works'] as const;
type Tab = (typeof TABS)[number];

export default function WhatIfPanel() {
  useLabRunner();
  const panel = useApp((s) => s.rightPanel), done = useApp((s) => s.introDone);
  const w = useApp((s) => s.whatif);
  const [tab, setTab] = useState<Tab>('Scenario');
  const [presets, setPresets] = useState<LabPreset[]>([]);
  useEffect(() => void loadPresets().then(setPresets), []);
  const show = done && panel === 'whatif';
  const r = w.result, preset = presets.find((p) => p.id === w.presetId), kind = w.hazard.kind, disaster = kind !== 'hurricane' ? HAZARDS[kind] : null;
  const hazardPreset = disaster?.presets.find((p) => p.id === w.presetId);
  const title = hazardPreset ? hazardPreset.name : preset ? (preset.kind === 'historical' ? `${preset.name} ${preset.year}` : preset.name) : w.track.length ? `Custom ${disaster?.noun ?? 'storm'}` : `New ${disaster?.noun ?? 'storm'}`;
  const peak = r?.series ? Math.max(...(r.series.ctrl ?? r.series.vmax.p50)) : 0;
  const flagged = r?.plantHazards?.filter((h) => h.windKt[1]>=34||h.rainIn[1]>=4||h.pDisrupt>=.2).length ?? 0;

  return (
    <>
      <LabOverlay />
      <AnimatePresence>
        {show && (
          <motion.aside key="lab" className="right-rail sl-rail" aria-label="Storm Lab" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}>
            <header className="sl-head">
              <span className="eyebrow"><span className={`status-dot${w.running ? ' sl-pulse' : ''}`} />Test a disaster</span>
              <h2>{title}</h2>
              <p className="sl-status num" aria-live="polite">
                {w.running ? <><LoaderCircle size={12} className="animate-spin" /> Running {w.lab.members.toLocaleString()} scenarios across {useApp.getState().plants.length} plants…</> : r ? `Supply forecast ready · ${r.members.toLocaleString()} members in ${Math.round(r.elapsedMs)} ms` : 'Pick a disaster or draw it on the map'}
              </p>
              {r?.series && (
                <button className="sl-peek" onClick={() => setTab('Supply impact')}>
                  <span>{disaster && r.hazardKind === kind ? disaster.headline(w.hazard) : `${categoryLabel(peak)} storm`}</span>
                  <span><b className="num">{flagged}</b> site{flagged === 1 ? '' : 's'} exposed</span>
                  {(() => { const n = r.drugRisk.filter((d) => d.hospitalsAtRisk > 0).length; return <span><b className="num">{n}</b> medicine{n === 1 ? '' : 's'} with projected stockouts</span>; })()}
                </button>
              )}
              <div className="sl-tabs" role="tablist">
                {TABS.map((t) => (
                  <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                    {tab === t && <motion.span layoutId="sl-tab" className="sl-tab-ind" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
                    <span>{t}</span>
                  </button>
                ))}
              </div>
            </header>
            <div className="sl-body">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}>
                  {tab === 'Scenario' ? <QuickStormSetup /> : tab === 'Supply impact' ? <LabResults /> : <LabMethod />}
                </motion.div>
              </AnimatePresence>
            </div>
            {w.error && <div className="sl-error" role="alert">{w.error}</div>}
            <footer className="sl-foot">
              <label className="sl-autorun"><input type="checkbox" checked={w.auto} onChange={(e) => useApp.getState().setWhatIf({ auto: e.target.checked })} />Update as I edit</label>
              <button className="sl-run" disabled={w.running || w.track.length < 2} onClick={() => {setTab('Supply impact');useApp.getState().set({ whatifRunAt: Date.now() });}}>
                {w.running ? <LoaderCircle size={15} className="animate-spin" /> : <Play size={14} fill="currentColor" />}See supply impact
              </button>
            </footer>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

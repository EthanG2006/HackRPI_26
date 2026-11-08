// Storm Lab: a parametric hurricane hazard simulator wired to the medicine supply network.
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { LoaderCircle, Play } from 'lucide-react';
import { useApp } from '../store';
import { useLabRunner } from '../lab/useLabRunner';
import { loadPresets, type LabPreset } from '../lab/presets';
import { categoryLabel } from '../sim/lab/params';
import LabSetup from '../lab/LabSetup';
import LabResults from '../lab/LabResults';
import LabMethod from '../lab/LabMethod';
import LabOverlay from '../lab/LabOverlay';
import '../lab/lab.css';

const TABS = ['Setup', 'Results', 'Method'] as const;
type Tab = (typeof TABS)[number];

export default function WhatIfPanel() {
  useLabRunner();
  const panel = useApp((s) => s.rightPanel), done = useApp((s) => s.introDone);
  const w = useApp((s) => s.whatif);
  const [tab, setTab] = useState<Tab>('Setup');
  const [presets, setPresets] = useState<LabPreset[]>([]);
  useEffect(() => void loadPresets().then(setPresets), []);
  const show = done && panel === 'whatif';
  const r = w.result, preset = presets.find((p) => p.id === w.presetId);
  const title = preset ? (preset.kind === 'historical' ? `${preset.name} ${preset.year}` : preset.name) : w.track.length ? 'Custom storm' : 'New storm';
  const peak = r?.series ? Math.max(...(r.series.ctrl ?? r.series.vmax.p50)) : 0;
  const flagged = r?.plantHazards?.filter((h) => h.pDisrupt >= w.lab.alertThreshold).length ?? 0;

  return (
    <>
      <LabOverlay />
      <AnimatePresence>
        {show && (
          <motion.aside key="lab" className="right-rail sl-rail" aria-label="Storm Lab" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}>
            <header className="sl-head">
              <span className="eyebrow"><span className={`status-dot${w.running ? ' sl-pulse' : ''}`} />Storm Lab</span>
              <h2>{title}</h2>
              <p className="sl-status num" aria-live="polite">
                {w.running ? <><LoaderCircle size={12} className="animate-spin" /> Running {w.lab.members.toLocaleString()} members…</> : r ? `${r.members.toLocaleString()} members · ${r.elapsedMs} ms · seed ${r.diagnostics?.seed ?? w.lab.seed}` : 'Pick a storm or draw a track'}
              </p>
              {r?.series && (
                <button className="sl-peek" onClick={() => setTab('Results')}>
                  <span><b className="num">{peak} kt</b> {categoryLabel(peak)}</span>
                  <span><b className="num">{flagged}</b> plant{flagged === 1 ? '' : 's'} at risk</span>
                  {(() => { const n = r.drugRisk.filter((d) => d.hospitalsAtRisk > 0).length; return <span><b className="num">{n}</b> medicine{n === 1 ? '' : 's'} short</span>; })()}
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
                  {tab === 'Setup' ? <LabSetup /> : tab === 'Results' ? <LabResults /> : <LabMethod />}
                </motion.div>
              </AnimatePresence>
            </div>
            {w.error && <div className="sl-error" role="alert">{w.error}</div>}
            <footer className="sl-foot">
              <label className="sl-autorun"><input type="checkbox" checked={w.auto} onChange={(e) => useApp.getState().setWhatIf({ auto: e.target.checked })} />Update as I edit</label>
              <button className="sl-run" disabled={w.running || w.track.length < 2} onClick={() => useApp.getState().set({ whatifRunAt: Date.now() })}>
                {w.running ? <LoaderCircle size={15} className="animate-spin" /> : <Play size={14} fill="currentColor" />}Run ensemble
              </button>
            </footer>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

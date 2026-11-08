// Storm Lab inputs. Every physical setting is exposed, grouped, with literature defaults.
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Dices, MousePointer2, PenLine, RotateCcw, Undo2 } from 'lucide-react';
import { useApp } from '../store';
import { categoryLabel, DEFAULT_LAB, DEFAULT_PHYS } from '../sim/lab/params';
import { hollandB, kmPerDegLon, KM_PER_DEG_LAT } from '../sim/lab/physics';
import { applyPreset, loadPresets, type LabPreset } from './presets';
import { Section, Segmented, Slider, Toggle } from './controls';
import type { LabConfig, LngLat } from '../types';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export default function LabSetup() {
  const w = useApp((s) => s.whatif);
  const [presets, setPresets] = useState<LabPreset[]>([]);
  useEffect(() => void loadPresets().then(setPresets), []);
  const lab = w.lab, r = w.result;
  const setLab = (patch: Partial<LabConfig>) => useApp.getState().setWhatIf({ lab: { ...useApp.getState().whatif.lab, ...patch } });
  const historical = !!w.fixes;
  const peakIdx = r?.series ? r.series.vmax.p50.indexOf(Math.max(...r.series.vmax.p50)) : -1;
  const autoPc = r?.diagnostics?.params.minPcHpa, autoRmw = peakIdx >= 0 ? r!.series!.rmwKm[peakIdx] : undefined;
  const autoB = autoPc && r?.diagnostics ? Math.round(hollandB(r.diagnostics.params.peakVmaxKt, autoPc, DEFAULT_PHYS) * 100) / 100 : undefined;

  function shift(dxKm: number, dyKm: number) {
    const s = useApp.getState().whatif;
    const move = ([lon, lat]: LngLat): LngLat => [lon + dxKm / kmPerDegLon(lat), lat + dyKm / KM_PER_DEG_LAT];
    const track = s.track.map(move);
    // Shifting keeps the historical record (and its original positions, which decide where it was over land).
    useApp.getState().setWhatIf({ track, fixes: s.fixes ? s.fixes.map((f, i) => ({ ...f, lon: track[i][0], lat: track[i][1] })) : null, result: s.result });
  }

  const historicalPresets = presets.filter((p) => p.kind === 'historical'), synthetic = presets.filter((p) => p.kind === 'synthetic');
  return (
    <div className="sl-setup">
      <Section title="Storm & track" open summary={w.presetId ? presets.find((p) => p.id === w.presetId)?.name : `${w.track.length} points`}>
        <div className="sl-field">
          <label className="sl-field-label" htmlFor="sl-preset">Start from</label>
          <select id="sl-preset" className="sl-select" value={w.presetId ?? ''} onChange={(e) => { const p = presets.find((x) => x.id === e.target.value); if (p) applyPreset(p); }}>
            <option value="" disabled>{w.track.length ? 'Custom track' : 'Choose a storm…'}</option>
            {historicalPresets.length > 0 && <optgroup label="Historical best tracks (NOAA HURDAT2)">{historicalPresets.map((p) => <option key={p.id} value={p.id}>{p.name} {p.year}</option>)}</optgroup>}
            <optgroup label="Synthetic scenarios">{synthetic.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
          </select>
          {w.presetId && <p className="sl-hint">{presets.find((p) => p.id === w.presetId)?.note}</p>}
        </div>
        <div className="sl-row">
          <button className={`sl-btn${w.drawing ? ' on' : ''}`} onClick={() => useApp.getState().setWhatIf(w.drawing ? { drawing: false } : { drawing: true, track: [], result: null })}>
            {w.drawing ? <MousePointer2 size={14} /> : <PenLine size={14} />}{w.drawing ? 'Finish drawing' : 'Draw new track'}
          </button>
          <button className="sl-icon" aria-label="Undo last point" title="Undo last point" disabled={!w.track.length} onClick={() => useApp.getState().setWhatIf({ track: w.track.slice(0, -1) })}><Undo2 size={14} /></button>
          <div className="sl-nudge" role="group" aria-label="Shift the whole track by 50 km">
            <button aria-label="Shift west 50 km" title="Shift west 50 km" onClick={() => shift(-50, 0)}><ArrowLeft size={13} /></button>
            <button aria-label="Shift north 50 km" title="Shift north 50 km" onClick={() => shift(0, 50)}><ArrowUp size={13} /></button>
            <button aria-label="Shift south 50 km" title="Shift south 50 km" onClick={() => shift(0, -50)}><ArrowDown size={13} /></button>
            <button aria-label="Shift east 50 km" title="Shift east 50 km" onClick={() => shift(50, 0)}><ArrowRight size={13} /></button>
          </div>
        </div>
        <p className="sl-hint">{w.drawing ? 'Click or drag on the map to place track points in order of travel.' : 'Drag any track point on the map to reshape the path. Arrows shift the whole track 50 km.'}</p>
        {!historical && (
          <Slider label="Forward speed" value={w.forwardSpeedKt} min={2} max={35} step={1} unit="kt" onChange={(v) => useApp.getState().setWhatIf({ forwardSpeedKt: v })}
            hint="Slow storms rain longer on the same basins (Harvey 2017 ≈ 2–5 kt; typical 10–15 kt)." />
        )}
        <Slider label="Stall" value={lab.stallHours} min={0} max={96} step={6} unit="h" onChange={(v) => setLab({ stallHours: v, stallAtFix: lab.stallAtFix < 0 ? Math.max(0, Math.floor(w.track.length / 2)) : lab.stallAtFix })}
          hint="Hold the storm in place, as Harvey (2017) and Florence (2018) did." />
        {lab.stallHours > 0 && (
          <div className="sl-field">
            <label className="sl-field-label" htmlFor="sl-stall">Stall at track point</label>
            <select id="sl-stall" className="sl-select" value={lab.stallAtFix} onChange={(e) => setLab({ stallAtFix: Number(e.target.value) })}>
              {w.track.map((_, i) => <option key={i} value={i}>Point {i + 1}{w.fixes?.[i]?.hour !== undefined ? ` · +${Math.round(w.fixes[i].hour!)} h` : ''}</option>)}
            </select>
          </div>
        )}
      </Section>

      <Section title="Intensity & structure" open summary={historical ? `record × ${lab.intensityScale.toFixed(2)}` : `${lab.vmaxKt} kt`}>
        {historical ? (
          <Slider label="Intensity vs. record" value={lab.intensityScale} min={0.6} max={1.4} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => setLab({ intensityScale: v })}
            hint="Scales the best-track winds over water. Inland decay is recomputed for the modified storm." />
        ) : (
          <Slider label="Maximum sustained wind" value={lab.vmaxKt} min={35} max={180} step={5} unit="kt" format={(v) => `${v} · ${categoryLabel(v)}`}
            onChange={(v) => useApp.getState().setWhatIf({ lab: { ...useApp.getState().whatif.lab, vmaxKt: v }, category: Math.min(5, Math.max(1, v >= 137 ? 5 : v >= 113 ? 4 : v >= 96 ? 3 : v >= 83 ? 2 : 1)) as 1 | 2 | 3 | 4 | 5 })}
            hint="1-minute sustained wind at 10 m over water." />
        )}
        <Slider label="Central pressure" value={lab.pcHpa ?? autoPc ?? 950} min={880} max={1005} step={1} unit="hPa" onChange={(v) => setLab({ pcHpa: v })}
          auto={{ on: lab.pcHpa === null, autoValue: autoPc, set: (on) => setLab({ pcHpa: on ? null : autoPc ?? 950 }), source: historical ? 'best-track pressure' : 'Atlantic wind–pressure relationship (Dvorak 1984 fit)' }} hint="Lower pressure at the same wind means a broader storm." />
        <Slider label="Radius of maximum wind" value={lab.rmwKm ?? autoRmw ?? 40} min={8} max={150} step={1} unit="km" onChange={(v) => setLab({ rmwKm: v })}
          auto={{ on: lab.rmwKm === null, autoValue: autoRmw, set: (on) => setLab({ rmwKm: on ? null : autoRmw ?? 40 }), source: historical ? 'best track, else Willoughby et al. (2006)' : 'Willoughby et al. (2006) climatology' }} hint="Size of the eyewall; larger storms spread damaging winds wider." />
        <Slider label="Profile peakedness (Holland B)" value={lab.hollandB ?? autoB ?? 1.6} min={1} max={2.5} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => setLab({ hollandB: v })}
          auto={{ on: lab.hollandB === null, autoValue: autoB, set: (on) => setLab({ hollandB: on ? null : autoB ?? 1.6 }), source: 'derived from Vmax and ΔP (Holland 1980)' }} hint="Higher B concentrates wind near the eyewall." />
        <Toggle label="Inland decay" hint="Kaplan & DeMaria (1995)" checked={lab.inlandDecay} onChange={(v) => setLab({ inlandDecay: v })} />
        <Slider label="Re-intensification after land" value={lab.intensifyKtPerDay} min={5} max={60} step={5} unit="kt/day" onChange={(v) => setLab({ intensifyKtPerDay: v })}
          hint="Limit on recovery when a storm re-emerges over water (rapid intensification ≥ 30 kt/day)." />
      </Section>

      <Section title="Environment" summary={`${lab.shearKt} kt shear · ${lab.soilMoisture} soil`}>
        <Slider label="Vertical wind shear" value={lab.shearKt} min={0} max={40} step={1} unit="kt" onChange={(v) => setLab({ shearKt: v })}
          hint="850–200 hPa shear tilts rain downshear-left (PHRaM, Lonfat et al. 2007) and favours tornadoes." />
        <Segmented label="Shear points toward" value={Math.round(lab.shearDirDeg / 45) % 8} onChange={(i) => setLab({ shearDirDeg: (i as number) * 45 })}
          options={COMPASS.map((c, i) => ({ value: i, label: c }))} />
        <Segmented label="Antecedent soil moisture" value={lab.soilMoisture} onChange={(v) => setLab({ soilMoisture: v })}
          options={[{ value: 'dry', label: 'Dry' }, { value: 'normal', label: 'Normal' }, { value: 'wet', label: 'Wet', title: 'e.g. after a predecessor rain event' }]} />
        <Toggle label="Mountain rain enhancement" hint="Upslope model (Smith 1979) on 0.1° terrain" checked={lab.orographic} onChange={(v) => setLab({ orographic: v })} />
      </Section>

      <Section title="Ensemble & uncertainty" summary={`${lab.members.toLocaleString()} members · seed ${lab.seed}`}>
        <Segmented label="Members" value={lab.members} onChange={(v) => setLab({ members: v })}
          options={[250, 500, 1000, 2000].map((n) => ({ value: n, label: n.toLocaleString() }))} />
        <Slider label="Track error" value={lab.trackErrorScale} min={0} max={2} step={0.1} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => setLab({ trackErrorScale: v })}
          hint="1.0× = NHC 2026 cone (2/3 of official track errors fall inside)." />
        <Slider label="Intensity error" value={lab.intensityErrorScale} min={0} max={2} step={0.1} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => setLab({ intensityErrorScale: v })}
          hint="1.0× = NHC 2021–25 mean official intensity error by lead time." />
        <Slider label="Size uncertainty" value={lab.sizeSpread} min={0} max={0.5} step={0.05} format={(v) => `σ ${v.toFixed(2)}`} onChange={(v) => setLab({ sizeSpread: v })}
          hint="Spread of ln(Rmax) across members." />
        <div className="sl-row">
          <label className="sl-field-label" htmlFor="sl-seed">Random seed</label>
          <input id="sl-seed" className="sl-input num" type="number" value={lab.seed} onChange={(e) => setLab({ seed: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
          <button className="sl-icon" aria-label="New random seed" title="New random seed" onClick={() => setLab({ seed: 1 + Math.floor(Math.random() * 99999) })}><Dices size={14} /></button>
        </div>
      </Section>

      <Section title="Plant response" summary={`alert ≥ ${Math.round(lab.alertThreshold * 100)}%`}>
        <Slider label="Backup power autonomy" value={lab.backupPowerDays} min={0} max={14} step={1} unit="days" onChange={(v) => setLab({ backupPowerDays: v })}
          hint="On-site generation shortens wind-driven grid outages." />
        <Slider label="Alert threshold" value={lab.alertThreshold} min={0.1} max={0.9} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setLab({ alertThreshold: v })}
          hint="P(disruption) at which pharmacy directors are alerted." />
      </Section>

      <button className="sl-reset" onClick={() => useApp.getState().setWhatIf({ lab: { ...DEFAULT_LAB, vmaxKt: lab.vmaxKt } })}><RotateCcw size={13} /> Reset physics to literature defaults</button>
    </div>
  );
}

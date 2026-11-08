// Map overlay in lab mode: hazard field picker + legend, and storm playback.
import { useEffect, useState } from 'react';
import { Pause, Play, Sigma } from 'lucide-react';
import { useApp } from '../store';
import { metaFor } from '../map/labLayers';
import { categoryLabel } from '../sim/lab/params';
import { HAZARDS } from '../sim/lab/hazardMeta';
import { labClock, seriesAt } from './labClock';
import { Prov } from '../ui/Prov';
import type { LabFieldId } from '../types';

const FIELDS: LabFieldId[] = ['p34', 'p64', 'wind', 'rain', 'pRain', 'tornado'];
const SHORT: Record<LabFieldId, string> = { p34: '≥34 kt', p50: '≥50 kt', p64: 'Strong wind', wind: 'Max wind', rain: 'Rain total', pRain: 'Heavy rain', tornado: 'Tornado', hazard: 'Footprint' };

export default function LabOverlay() {
  const [moreLayers,setMoreLayers]=useState(false);
  const active = useApp((s) => s.scenarioId === 'whatif' && s.introDone);
  const field = useApp((s) => s.whatif.field), hour = useApp((s) => s.whatif.hour), playing = useApp((s) => s.whatif.labPlaying);
  const series = useApp((s) => s.whatif.result?.series), running = useApp((s) => s.whatif.running), kind = useApp((s) => s.whatif.result?.hazardKind);
  const end = series?.hours[series.hours.length - 1] ?? 0;
  const disaster = kind && kind !== 'hurricane' ? HAZARDS[kind] : null, rate = disaster?.playRate ?? 9;

  useEffect(() => {
    labClock.playing = playing;
    if (!playing) return;
    let raf = 0, last = performance.now(), synced = 0;
    labClock.hour = hour ?? 0;
    const tick = (now: number) => {
      labClock.hour = Math.min(end, labClock.hour + ((now - last) / 1000) * rate);
      last = now;
      const done = labClock.hour >= end;
      // ~30 Hz store sync: the field image, isolines and paths advance smoothly between snapshots.
      if (now - synced > 33 || done) { synced = now; useApp.getState().setWhatIf({ hour: labClock.hour, ...(done ? { labPlaying: false } : {}) }); }
      if (!done) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); labClock.playing = false; };
  }, [playing, end, rate]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active) return null;
  const shownField: LabFieldId = disaster ? 'hazard' : field === 'hazard' ? 'p64' : field;
  const meta = metaFor(shownField, kind), st = series && hour !== null && !disaster ? seriesAt(series, hour) : null;
  const stops = meta.stops, lo = stops[0][0], hi = stops[stops.length - 1][0];
  const gradient = `linear-gradient(90deg, ${stops.map(([v, c, a]) => `color-mix(in oklab, ${c} ${Math.round(Math.max(a, 0.12) * 100 + 20)}%, transparent) ${((v - lo) / (hi - lo)) * 100}%`).join(', ')})`;
  const when = (h: number) => series?.startTime ? new Date(Date.parse(series.startTime) + h * 3.6e6).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }) + ' UTC' : `+${Math.round(h)} h`;

  return (
    <>
      <div className="sl-legend" role="group" aria-label="Hazard field">
        {!disaster && <>
          <div className="sl-legend-tabs" role="radiogroup">
            {FIELDS.filter(f=>moreLayers||['p64','rain','pRain',shownField].includes(f)).map((f) => <button key={f} role="radio" aria-checked={f === shownField} className={f === shownField ? 'on' : ''} onClick={() => useApp.getState().setWhatIf({ field: f })}>{SHORT[f]}</button>)}
          </div>
          <button className="legend-more" aria-expanded={moreLayers} onClick={()=>setMoreLayers(!moreLayers)}>{moreLayers?'Fewer weather layers':'More weather layers'}</button>
        </>}
        <div className="sl-legend-title"><b>{meta.label}</b><span>{meta.unit}</span><Prov kind="MODEL" compact /></div>
        <div className="sl-legend-bar" style={{ background: gradient }} />
        <div className="sl-legend-ticks num">{[lo, ...meta.levels, hi].filter((v, i, a) => a.indexOf(v) === i).map((v) => <span key={v} style={{ left: `${((v - lo) / (hi - lo)) * 100}%` }}>{meta.fmt(v)}</span>)}</div>
        <p className="sl-legend-source">{meta.source}. Lines mark {meta.levels.map(meta.fmt).join(' / ')}.</p>
      </div>
      {series && (
        <div className="sl-playback" role="group" aria-label="Disaster playback">
          <button className="sl-play" aria-label={playing ? 'Pause playback' : 'Play the event'} disabled={running}
            onClick={() => useApp.getState().setWhatIf(playing ? { labPlaying: false } : { labPlaying: true, hour: hour === null || hour >= end ? 0 : hour })}>
            {playing ? <Pause size={15} /> : <Play size={15} fill="currentColor" />}
          </button>
          <div className="sl-scrub">
            <input type="range" min={0} max={end} step={end / 240} value={hour ?? end} aria-label="Event time" style={{ ['--pct' as string]: `${((hour ?? end) / Math.max(1e-6, end)) * 100}%` }}
              onChange={(e) => { labClock.hour = Number(e.target.value); useApp.getState().setWhatIf({ hour: Number(e.target.value), labPlaying: false }); }} />
            <div className="sl-scrub-label num">
              {disaster && hour !== null ? <><b>{disaster.clock(hour)}</b><span>{disaster.name}</span></>
                : st ? <><b>{when(hour!)}</b><span>{Math.round(st.vmax)} kt · {categoryLabel(st.vmax)} · {Math.round(st.pc)} hPa</span></>
                : <><b>Event totals</b><span>press play to watch it unfold</span></>}
            </div>
          </div>
          <button className={`sl-totals${hour === null ? ' on' : ''}`} aria-pressed={hour === null} title="Show event totals" onClick={() => useApp.getState().setWhatIf({ hour: null, labPlaying: false })}><Sigma size={14} /> Totals</button>
        </div>
      )}
    </>
  );
}

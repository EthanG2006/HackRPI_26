// Map overlay in lab mode: hazard field picker + legend, and storm playback.
import { useEffect } from 'react';
import { Pause, Play, Sigma } from 'lucide-react';
import { useApp } from '../store';
import { FIELD_META } from '../map/labLayers';
import { categoryLabel } from '../sim/lab/params';
import { labClock, seriesAt } from './labClock';
import { Prov } from '../ui/Prov';
import type { LabFieldId } from '../types';

const FIELDS: LabFieldId[] = ['p34', 'p64', 'wind', 'rain', 'pRain', 'tornado'];
const SHORT: Record<LabFieldId, string> = { p34: '≥34 kt', p50: '≥50 kt', p64: '≥64 kt', wind: 'Max wind', rain: 'Rain total', pRain: 'Flood rain', tornado: 'Tornado' };
const HOURS_PER_SECOND = 9;

export default function LabOverlay() {
  const active = useApp((s) => s.scenarioId === 'whatif' && s.introDone);
  const field = useApp((s) => s.whatif.field), hour = useApp((s) => s.whatif.hour), playing = useApp((s) => s.whatif.labPlaying);
  const series = useApp((s) => s.whatif.result?.series), running = useApp((s) => s.whatif.running);
  const end = series?.hours[series.hours.length - 1] ?? 0;

  useEffect(() => {
    labClock.playing = playing;
    if (!playing) return;
    let raf = 0, last = performance.now(), synced = 0;
    labClock.hour = hour ?? 0;
    const tick = (now: number) => {
      labClock.hour = Math.min(end, labClock.hour + ((now - last) / 1000) * HOURS_PER_SECOND);
      last = now;
      const done = labClock.hour >= end;
      if (now - synced > 100 || done) { synced = now; useApp.getState().setWhatIf({ hour: labClock.hour, ...(done ? { labPlaying: false } : {}) }); }
      if (!done) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); labClock.playing = false; };
  }, [playing, end]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active) return null;
  const meta = FIELD_META[field], st = series && hour !== null ? seriesAt(series, hour) : null;
  const stops = meta.stops, lo = stops[0][0], hi = stops[stops.length - 1][0];
  const gradient = `linear-gradient(90deg, ${stops.map(([v, c, a]) => `color-mix(in oklab, ${c} ${Math.round(Math.max(a, 0.12) * 100 + 20)}%, transparent) ${((v - lo) / (hi - lo)) * 100}%`).join(', ')})`;
  const when = (h: number) => series?.startTime ? new Date(Date.parse(series.startTime) + h * 3.6e6).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }) + ' UTC' : `+${Math.round(h)} h`;

  return (
    <>
      <div className="sl-legend" role="group" aria-label="Hazard field">
        <div className="sl-legend-tabs" role="radiogroup">
          {FIELDS.map((f) => <button key={f} role="radio" aria-checked={f === field} className={f === field ? 'on' : ''} onClick={() => useApp.getState().setWhatIf({ field: f })}>{SHORT[f]}</button>)}
        </div>
        <div className="sl-legend-title"><b>{meta.label}</b><span>{meta.unit}</span><Prov kind="MODEL" compact /></div>
        <div className="sl-legend-bar" style={{ background: gradient }} />
        <div className="sl-legend-ticks num">{[lo, ...meta.levels, hi].filter((v, i, a) => a.indexOf(v) === i).map((v) => <span key={v} style={{ left: `${((v - lo) / (hi - lo)) * 100}%` }}>{meta.fmt(v)}</span>)}</div>
        <p className="sl-legend-source">{meta.source}. Lines mark {meta.levels.map(meta.fmt).join(' / ')}.</p>
      </div>
      {series && (
        <div className="sl-playback" role="group" aria-label="Storm playback">
          <button className="sl-play" aria-label={playing ? 'Pause storm playback' : 'Play storm'} disabled={running}
            onClick={() => useApp.getState().setWhatIf(playing ? { labPlaying: false } : { labPlaying: true, hour: hour === null || hour >= end ? 0 : hour })}>
            {playing ? <Pause size={15} /> : <Play size={15} fill="currentColor" />}
          </button>
          <div className="sl-scrub">
            <input type="range" min={0} max={end} step={0.5} value={hour ?? end} aria-label="Storm hour" style={{ ['--pct' as string]: `${((hour ?? end) / Math.max(1, end)) * 100}%` }}
              onChange={(e) => { labClock.hour = Number(e.target.value); useApp.getState().setWhatIf({ hour: Number(e.target.value), labPlaying: false }); }} />
            <div className="sl-scrub-label num">
              {st ? <><b>{when(hour!)}</b><span>{Math.round(st.vmax)} kt · {categoryLabel(st.vmax)} · {Math.round(st.pc)} hPa</span></> : <><b>Storm totals</b><span>drag to replay the storm hour by hour</span></>}
            </div>
          </div>
          <button className={`sl-totals${hour === null ? ' on' : ''}`} aria-pressed={hour === null} title="Show storm totals" onClick={() => useApp.getState().setWhatIf({ hour: null, labPlaying: false })}><Sigma size={14} /> Totals</button>
        </div>
      )}
    </>
  );
}

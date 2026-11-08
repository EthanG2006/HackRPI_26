// Storm Lab results: what the ensemble says, per plant and per medicine, with uncertainty.
import { CloudRain, Download, Tornado, Wind } from 'lucide-react';
import { useApp } from '../store';
import { categoryLabel } from '../sim/lab/params';
import { riskCss } from '../lib/colors';
import { Prov } from '../ui/Prov';
import IntensityChart from './IntensityChart';
import type { WhatIfResult } from '../types';

const ICON = { wind: Wind, flood: CloudRain, tornado: Tornado, none: Wind } as const;

function maxAt(r: WhatIfResult, key: 'rain' | 'wind') {
  const g = r.fields?.[key];
  if (!g) return null;
  let m = -1, i0 = 0;
  g.values.forEach((v, i) => { if (v > m) { m = v; i0 = i; } });
  const res = (g.east - g.west) / g.nx;
  return { v: m, lon: g.west + ((i0 % g.nx) + 0.5) * res, lat: g.north - (Math.floor(i0 / g.nx) + 0.5) * res };
}

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export default function LabResults() {
  const w = useApp((s) => s.whatif), plants = useApp((s) => s.plants), drugs = useApp((s) => s.drugs);
  const r = w.result;
  if (!r?.series) return <div className="sl-empty"><b>No run yet.</b><p>Pick a storm or draw a track. Results update automatically as you change settings.</p></div>;
  const s = r.series, ctrl = s.ctrl ?? s.vmax.p50, peak = Math.max(...ctrl), peakI = ctrl.indexOf(peak);
  const rain = maxAt(r, 'rain'), wind = maxAt(r, 'wind');
  const when = (h: number) => (s.startTime ? new Date(Date.parse(s.startTime) + h * 3.6e6).toUTCString().slice(5, 22) + ' UTC' : `+${Math.round(h)} h`);
  const hazards = [...(r.plantHazards ?? [])].sort((a, b) => b.pDisrupt - a.pDisrupt);
  const flagged = hazards.filter((h) => h.pDisrupt >= w.lab.alertThreshold).length;
  const meds = r.drugRisk.slice(0, 5);
  const ll = (p: { lat: number; lon: number }) => `${Math.abs(p.lat).toFixed(1)}°${p.lat >= 0 ? 'N' : 'S'} ${Math.abs(p.lon).toFixed(1)}°${p.lon >= 0 ? 'E' : 'W'}`;

  function exportCsv() {
    const rows = [['plant', 'city', 'state', 'p_disrupt', 'p10', 'p90', 'dominant', 'wind_p10_kt', 'wind_p50_kt', 'wind_p90_kt', 'rain_p50_in', 'tornado_p', 'outage_p50_days']];
    for (const h of hazards) {
      const p = plants.find((x) => x.id === h.plantId);
      rows.push([h.plantId, p?.city ?? '', p?.state ?? '', h.pDisrupt, h.ci[0], h.ci[1], h.dominant, ...h.windKt, h.rainIn[1], h.tornado, h.outageDays.p50].map(String));
    }
    download('storm-lab-plants.csv', rows.map((x) => x.join(',')).join('\n'), 'text/csv');
  }
  function exportJson() {
    const { fields: _f, rainSnapshots: _r, windSnapshots: _w, hospitalStockouts: _h, ...rest } = r!;
    download('storm-lab-run.json', JSON.stringify({ settings: { track: w.track, fixes: w.fixes, forwardSpeedKt: w.forwardSpeedKt, lab: w.lab, presetId: w.presetId }, result: rest }, null, 1), 'application/json');
  }

  return (
    <div className="sl-results">
      <div className="sl-kpis">
        <div><small>Peak intensity</small><b className="num">{peak} kt</b><span>{categoryLabel(peak)} · {r.diagnostics?.params.minPcHpa} hPa</span></div>
        <div><small>Landfall</small><b className="num">{s.landfalls.length ? `${s.landfalls[0].vmaxKt} kt` : 'None'}</b><span>{s.landfalls.length ? when(s.landfalls[0].hour) : 'stays over water'}</span></div>
        <div><small>Max sustained wind</small><b className="num">{wind ? Math.round(wind.v) : '—'} kt</b><span>{wind ? ll(wind) : ''}</span></div>
        <div><small>Max storm rain</small><b className="num">{rain ? rain.v.toFixed(1) : '—'} in</b><span>{rain ? ll(rain) : ''}</span></div>
      </div>

      <div className="sl-card">
        <div className="sl-card-head"><span>Intensity · control (dashed), ensemble median and 80% band</span><Prov kind="MODEL" compact /></div>
        <IntensityChart s={s} hour={w.hour} onScrub={(h) => useApp.getState().setWhatIf({ hour: h, labPlaying: false })} />
        <p className="sl-hint">Peak at {when(s.hours[peakI])}. Shaded: over land, where Kaplan–DeMaria decay applies.</p>
      </div>

      <div className="sl-card">
        <div className="sl-card-head"><span>Manufacturing sites</span><span className="sl-pill num">{flagged} ≥ {Math.round(w.lab.alertThreshold * 100)}%</span></div>
        <div className="sl-plants" role="table" aria-label="Plant disruption probability">
          {hazards.slice(0, 8).map((h) => {
            const p = plants.find((x) => x.id === h.plantId);
            if (!p) return null;
            const I = ICON[h.dominant];
            return (
              <button key={h.plantId} role="row" className="sl-plant" onClick={() => { useApp.getState().flyTo({ longitude: p.lon, latitude: p.lat, zoom: 7, duration: 1400 }); useApp.getState().setWhatIf({ hour: h.peakHour, labPlaying: false }); }}>
                <span className="sl-plant-name"><b>{p.name.replace(' Healthcare', '')}</b><small>{p.city}, {p.state} · <I size={11} aria-hidden /> {h.dominant === 'none' ? 'minimal exposure' : h.dominant}</small></span>
                <span className="sl-plant-meter" aria-label={`${Math.round(h.pDisrupt * 100)} percent`}>
                  <i style={{ left: `${h.ci[0] * 100}%`, width: `${Math.max(1, (h.ci[1] - h.ci[0]) * 100)}%`, background: riskCss(h.pDisrupt, 0.35) }} />
                  <em style={{ left: `${h.pDisrupt * 100}%`, background: riskCss(h.pDisrupt) }} />
                </span>
                <span className="sl-plant-num num"><b style={{ color: riskCss(Math.max(0.15, h.pDisrupt)) }}>{Math.round(h.pDisrupt * 100)}%</b><small>{h.windKt[1]} kt · {h.rainIn[1]} in</small></span>
              </button>
            );
          })}
        </div>
        <p className="sl-hint">Bar: mean P(disruption) with the 10th–90th percentile across members and model draws. Wind and rain are member medians at the site.</p>
      </div>

      <div className="sl-card">
        <div className="sl-card-head"><span>Medicines downstream</span><Prov kind="MODEL" compact /></div>
        {meds.map((d) => {
          const drug = drugs.find((x) => x.id === d.drugId);
          return (
            <button key={d.drugId} className="sl-med" onClick={() => useApp.getState().set({ rightPanel: 'drugs', selectedDrugId: d.drugId })}>
              <span>{drug?.shortName ?? drug?.name ?? d.drugId}</span>
              <span className="num">{d.hospitalsAtRisk ? `${d.hospitalsAtRisk.toLocaleString()} hosp.` : '—'}</span>
              <b className="num" style={{ color: riskCss(d.risk) }}>{Math.round(d.risk * 100)}%</b>
            </button>
          );
        })}
      </div>

      <div className="sl-exports">
        <button className="sl-btn" onClick={exportCsv}><Download size={13} /> Plants CSV</button>
        <button className="sl-btn" onClick={exportJson}><Download size={13} /> Run JSON</button>
      </div>
    </div>
  );
}

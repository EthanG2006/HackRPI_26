// Storm Lab results: what the ensemble says, per plant and per medicine, with uncertainty.
import { useMemo } from 'react';
import { supplyOutlook } from './supplyOutlook';
import { localHospital } from '../presenter/beats';
import { Activity, CloudRain, Download, Flame, Snowflake, Tornado, Truck, Wind } from 'lucide-react';
import { HAZARDS } from '../sim/lab/hazardMeta';
import { useApp } from '../store';
import { categoryLabel } from '../sim/lab/params';
import { riskCss } from '../lib/colors';
import { Prov } from '../ui/Prov';
import IntensityChart from './IntensityChart';
import type { WhatIfResult } from '../types';

const ICON = { wind: Wind, flood: CloudRain, tornado: Tornado, quake: Activity, fire: Flame, ice: Snowflake, none: Wind } as const;
const CAUSE = { wind: 'wind', flood: 'flood', tornado: 'tornado', quake: 'shaking', fire: 'fire', ice: 'ice & grid', none: 'minimal exposure' } as const;

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
  const w = useApp((s) => s.whatif), plants = useApp((s) => s.plants), drugs = useApp((s) => s.drugs), hospitals=useApp(s=>s.hospitals);
  const outlook=useMemo(()=>w.result?supplyOutlook(w.result,hospitals):null,[w.result,hospitals]);
  const r = w.result, disaster = r?.hazardKind && r.hazardKind !== 'hurricane' ? HAZARDS[r.hazardKind] : null;
  if (!r?.series) return <div className="sl-empty"><b>No run yet.</b><p>Choose a coast, or draw a track. Then select See supply impact.</p></div>;
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
      <section className="supply-headline"><span className="eyebrow">Medicine supply outlook <Prov kind="MODEL" compact/></span>
        <h3>{outlook!.hospitals>0?`${outlook!.hospitals.toLocaleString()} hospitals could run short`:outlook!.downsideHospitals>0?`${outlook!.downsideHospitals.toLocaleString()} hospitals exposed in the downside estimate`:'No hospital stockouts projected'}</h3>
        <p>{outlook!.exposed} manufacturing {outlook!.exposed===1?'site is':'sites are'} exposed to {disaster?`the ${disaster.noun}`:'damaging weather'}. {outlook!.medicines>0?`${outlook!.medicines} medicines need attention.`:'Check the exposed sites before changing orders.'}</p>
      </section>
      {outlook!.downsideHospitals>0&&<p className="downside-note">Central estimate: {outlook!.hospitals.toLocaleString()} hospitals run short. Downside estimate: {outlook!.downsideHospitals.toLocaleString()}, using the earlier end of the 80% stockout window.</p>}
      <div className="supply-next"><h3>Prepare before it arrives</h3>
        <p><b>1. Confirm supply</b>Contact {plants.find(p=>p.id===hazards[0]?.plantId)?.company??'the exposed manufacturer'} about production and shipping plans.</p>
        <p><b>2. Review the medicine plan</b>Check {drugs.find(d=>d.id===outlook!.priority?.drugId)?.shortName??'priority medicine'} inventory and alternatives with pharmacy teams.</p>
        <p><b>3. Reroute the network</b>Shift distributor lanes to unaffected plants before buffers drain.</p>
        <button className="primary wide" onClick={()=>useApp.getState().set({rightPanel:'logistics'})}><Truck size={15}/>Reroute supply</button>
        <button className="quiet wide-quiet" onClick={()=>{const h=localHospital()??outlook!.hospital;if(h)useApp.getState().openHospital(h.id);}}>Open {localHospital()?.city??outlook!.hospital?.city??'a'} hospital plan</button>
      </div>
      {disaster && r.hazardSummary && <div className="sl-kpis hz-kpis">{r.hazardSummary.map((k) => <div key={k.label}><small>{k.label}</small><b className="num">{k.value}</b><span>{k.note ?? ''}</span></div>)}</div>}
      {!disaster && <details className="extra-details"><summary>Storm strength and rainfall</summary><div className="sl-kpis">
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

      </details>}
      <div className="sl-card">
        <div className="sl-card-head"><span>Manufacturing sites</span><span className="sl-pill num">{flagged} ≥ {Math.round(w.lab.alertThreshold * 100)}%</span></div>
        <div className="sl-plants" role="table" aria-label="Plant disruption probability">
          {hazards.slice(0, 4).map((h) => {
            const p = plants.find((x) => x.id === h.plantId);
            if (!p) return null;
            const I = ICON[h.dominant];
            return (
              <button key={h.plantId} role="row" className="sl-plant" onClick={() => { useApp.getState().flyTo({ longitude: p.lon, latitude: p.lat, zoom: 7, duration: 1400 }); useApp.getState().setWhatIf({ hour: h.peakHour, labPlaying: false }); }}>
                <span className="sl-plant-name"><b>{p.name.replace(' Healthcare', '')}</b><small>{p.city}, {p.state} · <I size={11} aria-hidden /> {CAUSE[h.dominant]}</small></span>
                <span className="sl-plant-meter" aria-label={`${Math.round(h.pDisrupt * 100)} percent`}>
                  <i style={{ left: `${h.ci[0] * 100}%`, width: `${Math.max(1, (h.ci[1] - h.ci[0]) * 100)}%`, background: riskCss(h.pDisrupt, 0.35) }} />
                  <em style={{ left: `${h.pDisrupt * 100}%`, background: riskCss(h.pDisrupt) }} />
                </span>
                <span className="sl-plant-num num"><b style={{ color: riskCss(Math.max(0.15, h.pDisrupt)) }}>{Math.round(h.pDisrupt * 100)}%</b><small>{disaster ? disaster.site(h.intensity ?? 0) : `${h.windKt[1]} kt · ${h.rainIn[1]} in`}</small></span>
              </button>
            );
          })}
        </div>
        <p className="sl-hint">Bar: mean P(disruption) with the 10th–90th percentile across members and model draws. {disaster ? 'Hazard is the member median at the site.' : 'Wind and rain are member medians at the site.'}</p>
      </div>

      <div className="sl-card">
        <div className="sl-card-head"><span>Medicines downstream</span><Prov kind="MODEL" compact /></div>
        {meds.map((d) => {
          const drug = drugs.find((x) => x.id === d.drugId);
          return (
            <button key={d.drugId} className="sl-med" onClick={() => useApp.getState().selectDrug(d.drugId)}>
              <span>{drug?.shortName ?? drug?.name ?? d.drugId}</span>
              <span className="num">{d.hospitalsAtRisk ? `${d.hospitalsAtRisk.toLocaleString()} hosp.` : '—'}</span>
              <b className="num" style={{ color: riskCss(d.risk) }}>{Math.round(d.risk * 100)}%</b>
            </button>
          );
        })}
      </div>

      <details className="extra-details"><summary>Download forecast data</summary><div className="sl-exports">
        <button className="sl-btn" onClick={exportCsv}><Download size={13} /> Plants CSV</button>
        <button className="sl-btn" onClick={exportJson}><Download size={13} /> Run JSON</button>
      </div></details>
    </div>
  );
}

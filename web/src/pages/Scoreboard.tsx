// Impact scoreboard: one hero number, the with/without comparison, and totals across every replay.
import {ShieldCheck,AlarmClock,CircleDollarSign,Hospital,Cloud} from 'lucide-react';
import {useActiveScenario,useApp} from '../store';
import {networkView} from '../logistics/network';
import {acrossReplays,comparison,warningHours,type CompareRow} from '../impact/story';
import {impactFields,Tick} from '../panels/ImpactCounters';
import {fmtCompact,fmtInt,fmtUsd,fmtUtc} from '../lib/format';
import {Prov} from '../ui/Prov';
import {supplyOutlook} from '../lab/supplyOutlook';

const fmt=(row:CompareRow,v:number)=>row.fmt==='int'?fmtInt(v):row.fmt==='usd'?fmtUsd(v):row.fmt==='hours'?`${Math.round(v)} h`:fmtCompact(v);
function change(row:CompareRow){
 if(row.better==='higher')return row.without?`${Math.round(row.with/row.without)}× more`:'from none';
 if(!row.without)return '';
 const p=Math.round((1-row.with/row.without)*100);return p>=100?'eliminated':`−${p}%`;
}

export default function Scoreboard(){
 const sc=useActiveScenario(), net=useApp(networkView), hours=useApp(warningHours), s=useApp.getState();
 // Lab runs are compared against the Helene backtest, the replay with a verified lead time.
 const benchId=sc&&s.equity[sc.id]?sc.id:'helene', bench=comparison(s,benchId), all=acrossReplays(s);
 const patients=(sc?.impact.patientsProtected??0)+(net?.kpi.patients??0), dollars=(sc?.impact.dollarsSaved??0)+(net?.kpi.dollars??0);
 const lab=sc?.id==='whatif'&&s.whatif.result?supplyOutlook(s.whatif.result,s.hospitals):null;
 const facts=useApp(st=>st.facts).filter(f=>f.verified), helene=s.scenarios.helene;
 if(!sc)return <p>Run a disaster in the lab, or open a replay, to see its impact.</p>;
 return <div className="score">
  <section className="score-hero">
   <span className="eyebrow"><Cloud size={14}/>{sc.name} · {sc.id==='whatif'?'simulated':'historical replay'}<Prov kind="MODEL" compact/></span>
   <div className="score-hero-num"><Tick value={patients} format={v=>fmtCompact(v)} ms={1400}/></div>
   <p>patient encounters protected when hospitals act on Rx Radar{hours!==null?<> <b>{Math.round(hours)} hours before</b> the plant fails</>:' the moment the disaster strikes'}.</p>
   <div className="score-tiles">
    <div><CircleDollarSign size={18}/><b><Tick value={dollars} format={fmtUsd} ms={1400}/></b><span>cancellations, expediting and gray-market premiums avoided</span></div>
    <div><AlarmClock size={18}/><b>{hours===null?'Instant':`${Math.round(hours)} h`}</b><span>{hours===null?'damage mapped across every plant in under a second':'of warning, using only forecasts issued at the time'}</span></div>
    {lab?<><div><Hospital size={18}/><b><Tick value={Math.max(lab.hospitals,lab.downsideHospitals)} format={fmtInt} ms={1400}/></b><span>hospitals warned before they run short</span></div>
    <div><ShieldCheck size={18}/><b>{lab.exposed}</b><span>manufacturing sites flagged for the pharmacy team</span></div></>
    :<><div><Hospital size={18}/><b>{bench?<Tick value={bench.kept} format={fmtInt} ms={1400}/>:'—'}</b><span>hospitals kept supplied that would otherwise run out</span></div>
    <div><ShieldCheck size={18}/><b>{bench?`${fmtInt(bench.rows[1].without)} → ${fmtInt(bench.rows[1].with)}`:'—'}</b><span>vulnerable-county hospitals left without {bench?.drug??'supply'}</span></div></>}
   </div>
  </section>

  {bench&&<section className="score-compare">
   <div className="score-head"><h3>Without vs with Rx Radar</h3><span>{bench.name} · {bench.drug}{benchId!==sc.id?' · validated replay':''}</span></div>
   <div className="score-legend"><span><i className="without"/>Without: hospitals scramble after the plant fails</span><span><i className="with"/>With Rx Radar: early warning and fair allocation</span></div>
   {bench.rows.map(row=>{const max=Math.max(row.without,row.with)||1;return <div className="score-row" key={row.label}>
     <div className="score-row-label"><b>{row.label}</b><em className={row.better==='higher'?'up':''}>{change(row)}</em></div>
     <div className="score-bars" title={`${row.label}: ${fmt(row,row.without)} without, ${fmt(row,row.with)} with Rx Radar`}>
      <div><i className="without" style={{width:`${row.without/max*100}%`}}/><span>{fmt(row,row.without)}</span></div>
      <div><i className="with" style={{width:`${row.with/max*100}%`}}/><span>{fmt(row,row.with)}</span></div>
     </div>
   </div>})}
  </section>}

  <section className="score-all">
   <div className="score-head"><h3>Across {all.events} replayed disasters</h3><span>Helene 2024 · Maria 2017 · Rocky Mount 2023</span></div>
   <div className="score-tiles">
    <div><b>{fmtCompact(all.patients)}</b><span>patient encounters protected</span></div>
    <div><b>{fmtUsd(all.dollars)}</b><span>costs avoided</span></div>
    <div><b>{fmtInt(all.kept)}</b><span>hospitals kept supplied</span></div>
    <div><b>{Math.round(all.avgWarning)} h</b><span>average warning before plant failure</span></div>
   </div>
  </section>

  {facts.length>0&&<section className="score-record">
   <div className="score-head"><h3>Grounded in the record</h3><span>Verified events · click a badge for the source</span></div>
   {helene?.backtest&&<div className="score-fact lead"><b>Alert fired {fmtUtc(helene.backtest.alertT)}</b><span>using only forecasts issued by then. North Cove flooded {fmtUtc(helene.backtest.plantFailureT)}: <em>{Math.round(helene.backtest.leadTimeHours)} hours later</em>.</span><Prov kind="REPLAY" compact sourceIds={['nhc-gis','iem-outlooks']}/></div>}
   {facts.map(f=><div className="score-fact" key={f.id}><span>{f.text}</span><Prov kind="REAL" compact sourceIds={f.sourceIds}/></div>)}
  </section>}

  <details className="extra-details score-assumptions"><summary>How these numbers are built</summary>
   {impactFields.map(({key,name,icon:Icon})=><div className="impact-detail" key={key}><b><Icon size={13}/> {name}</b>
    {sc.impact.breakdown[key].map((r,i)=><div key={i}><b>{r.label} · {fmtCompact(r.value)} {r.unit}</b><Prov kind={r.provenance} compact sourceIds={r.sourceIds}/><p>{r.assumption}</p></div>)}</div>)}
   <p>The comparison uses the replay's allocation model: market ordering after the outage versus need-weighted fair allocation triggered by the alert. Lead times respect forecast issue timestamps. Figures are scenario estimates, not observed outcomes.</p>
  </details>
 </div>;
}

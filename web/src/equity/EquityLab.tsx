import { useEffect, useState } from 'react';
import { Scale, Play, Pause, X, Users, ShieldCheck } from 'lucide-react';
import { activeScenario, useApp } from '../store';
import type { EquityFile, PolicyId, PolicyMetrics, PolicyResult } from '../types';
import { Prov } from '../ui/Prov';
import './lab.css';

const names:Record<PolicyId,string>={market:'Market',proportional:'By volume',rxradar:'Rx Radar'};
const pct=(v:number)=>Math.round(100*v)+'%';
const fmt=(v:number)=>Math.round(v).toLocaleString();
const money=(v:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(v);
const rows:[string,keyof PolicyMetrics,(n:number)=>string][]=[
  ['Hospitals stocked out','pctStockedOut',pct],['High-SVI stockouts','highSviStockouts',fmt],
  ['Rural stockouts','ruralStockouts',fmt],['Delayed encounters','patientsDelayed',fmt],
  ['Coverage Gini','gini',n=>n.toFixed(2)],['Total cost','totalCostUsd',money]
];
export default function EquityLab(){
  const open=useApp(s=>s.equityOpen), policy=useApp(s=>s.policy),lambda=useApp(s=>s.lambda),day=useApp(s=>s.abmDay);
  const auto=useApp(s=>s.equityAutoplayAt),playing=useApp(s=>s.abmPlaying),id=useApp(s=>s.scenarioId);
  const eq=useApp(s=>s.equity[s.scenarioId]),ready=useApp(s=>s.ready),selected=useApp(s=>s.selectedDrugId);
  const scenarios=useApp(s=>s.scenarios), whatif=useApp(s=>s.whatif.result), drugs=useApp(s=>s.drugs);
  const [generationError,setError]=useState(false);
  useEffect(()=>{
    if(!open||!ready)return;
    const s=useApp.getState(),sc=activeScenario(s); if(!sc)return;
    const drugId=selected??sc.heroDrugIds[0], drug=drugs.find(d=>d.id===drugId);
    if(!drug || (s.equity[id]?.drugId===drugId && id!=='whatif' && id!=='live'))return;
    const risk=sc.drugRisk.find(r=>r.drugId===drugId);
    if(!risk)return;
    setError(false);
    const w=new Worker(new URL('./allocate.worker.ts',import.meta.url),{type:'module'});
    w.onmessage=(e:MessageEvent<EquityFile>)=>{
      useApp.setState(st=>({equity:{...st.equity,[id]:e.data}}));w.terminate();
    };
    w.onerror=()=>{setError(true);w.terminate();};
    w.postMessage({scenarioId:id,hospitals:s.hospitals,drug,opening:sc.inventoryDoh?.[drugId],fraction:Math.min(...risk.supplyCurve.p50.slice(0,14))});
    return ()=>w.terminate();
  },[open,ready,selected,id,drugs,scenarios,whatif]);
  useEffect(()=>{
    if(!open) return;
    useApp.setState({abmDay:auto?1:14,abmPlaying:!!auto});
    return ()=>{useApp.setState({abmPlaying:false});};
  },[open,auto]);
  useEffect(()=>{
    if(!open||!playing)return;
    const timer=setInterval(()=>{
      const s=useApp.getState();
      if(s.abmDay>=14)s.set({abmPlaying:false});
      else s.set({abmDay:s.abmDay+1});
    },650);
    return ()=>clearInterval(timer);
  },[open,playing]);
  if(!open)return null;
  const s=useApp.getState(),set=s.set, scenario=activeScenario(s), name=drugs.find(d=>d.id===(selected??scenario?.heroDrugIds[0]))?.shortName;
  const close=()=>set({equityOpen:false,rightPanel:'drugs',abmPlaying:false,equityAutoplayAt:null});
  const point=eq?.frontier.reduce((a,b)=>Math.abs(a.lambda-lambda)<=Math.abs(b.lambda-lambda)?a:b);
  const choose=(p:PolicyId)=>set({policy:p});
  const results=eq?{...eq.policies,rxradar:point??eq.policies.rxradar}:null;
  const chosen=results?.[policy] as PolicyResult|undefined;
  const timelineDay=Math.max(1,day);
  const daily=chosen?.daily?.[timelineDay-1] ?? {day:timelineDay,stockedOut:chosen?.stockoutDay.filter(n=>n<=timelineDay).length??0,ordersVsDemand:1};
  const baseline=eq?.policies.market.metrics.highSviStockouts??0,delta=baseline-(point?.metrics.highSviStockouts??0);
  return <aside className="lab-rail" aria-label="Equity allocation lab">
    <header className="lab-head"><div><span className="lab-eyebrow"><Scale size={13}/> Allocation simulator</span><h2>Equity lab</h2></div><button className="lab-icon" aria-label="Close equity lab" onClick={close}><X size={18}/></button></header>
    <div className="lab-body">{eq && chosen && results ? <>
      <div className="lab-sub"><span>{name??'Drug supply'} · {eq.horizonDays}-day horizon</span><Prov kind="SIMULATED"/></div>
      <div className="lab-policy" aria-label="Allocation policy">{(Object.keys(names) as PolicyId[]).map(p=><button key={p} onClick={()=>choose(p)} aria-pressed={p===policy}>{names[p]}</button>)}</div>
      <div className="lab-signal"><span className="lab-eyebrow">Hospitals out of stock</span><strong className="num">{fmt(daily.stockedOut)}</strong><span>by day {timelineDay} under {names[policy]} allocation</span></div>
      <div className="lab-run"><button className="lab-icon" aria-label={playing?'Pause hoarding simulation':'Play hoarding simulation'} onClick={()=>set({abmPlaying:!playing,abmDay:!playing&&day>=14?1:day})}>{playing?<Pause size={16}/>:<Play size={16}/>}</button>
        <input aria-label="Inventory simulation day" type="range" min="1" max="14" value={timelineDay} onChange={e=>set({abmDay:+e.target.value,abmPlaying:false})}/><span className="num">{timelineDay}/14</span></div>
      <div className="lab-note">Orders reach <b className="num">{daily.ordersVsDemand.toFixed(2)}×</b> daily demand. Available supply covers <b>{pct(eq.supplyFraction)}</b> of normal shipments.</div>
      <div className="lab-section-title"><Users size={14}/><h3>Policy comparison</h3></div>
      <table className="lab-table"><thead><tr><th>Day {eq.horizonDays}</th>{Object.entries(names).map(([k,v])=><th className={k===policy?'lab-active':''} key={k}>{v}</th>)}</tr></thead>
      <tbody>{rows.map(([label,key,format])=><tr key={key}><th>{label}</th>{(Object.keys(names) as PolicyId[]).map(k=><td className={k===policy?'lab-active num':'num'} key={k}>{format(results[k].metrics[key])}</td>)}</tr>)}</tbody></table>
      <div className="lab-section-title"><Scale size={14}/><h3>Efficiency vs. equity</h3></div>
      <svg className="lab-frontier" viewBox="0 0 286 70" role="img" aria-label="Each pair of points shows delivery efficiency and lowest group coverage at an optimized equity weight">
        {[14,37,60].map(y=><line key={y} x1="8" x2="278" y1={y} y2={y} stroke="#293344" strokeDasharray="3 4"/>)}
        {(['efficiency','equity'] as const).map((metric,i)=><g key={metric} stroke={i?'#63d3bf':'#edbc69'}><polyline fill="none" strokeWidth="2.3" points={eq.frontier.map(f=>(8+270*f.lambda)+','+(63-55*f.metrics[metric])).join(' ')}/>
          {eq.frontier.map(f=><circle key={f.lambda} cx={8+270*f.lambda} cy={63-55*f.metrics[metric]} r={f.lambda===point?.lambda?4:2} fill={i?'#63d3bf':'#edbc69'}/>)}</g>)}
      </svg>
      <div className="lab-legend"><span>● Efficiency {pct(point?.metrics.efficiency??0)}</span><span>● Group coverage {pct(point?.metrics.equity??0)}</span></div>
      <input aria-label="Equity weight" className="lab-slider" type="range" min="0" max="1" step=".25" value={lambda} onChange={e=>set({lambda:+e.target.value,policy:'rxradar'})}/>
      <div className="lab-ends"><span>Favor efficiency</span><span>Favor equity</span></div>
      <div className="lab-disclose"><ShieldCheck size={18}/><p><b>Simultaneous disclosure</b>Every hospital receives the same alert. The fair policy caps orders at unmet need. {delta>0?fmt(delta)+' fewer high-SVI hospitals stock out than under Market.':''}</p></div>
      <button className="lab-link" onClick={()=>set({page:'model-card'})}>Inspect model assumptions ↗</button>
    </>:<p className="lab-note">{generationError?'Allocation inputs are unavailable. Select another storm replay.':'Preparing hospital inventory and comparing allocation policies…'}</p>}</div>
  </aside>;
}

import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowRight,Check,LoaderCircle,MapPin,MousePointer2,Play,RotateCcw,Undo2,Wind,X} from 'lucide-react';
import {useApp} from '../store';
import {runWhatIfInBrowser} from '../sim/whatif';
import {Prov} from '../ui/Prov';
import {riskCss} from '../lib/colors';
import {PUERTO_RICO,GULF} from './cameras';
import type {LngLat,WhatIfRequest,WhatIfResult} from '../types';
import './map.css';

const PRESETS:{name:string;track:LngLat[];camera:typeof GULF}[]=[
  {name:'Puerto Rico',track:[[-60,15],[-64.5,16.8],[-66.7,18.3],[-69,20.4]],camera:{...PUERTO_RICO,zoom:4.7}},
  {name:'Gulf Coast',track:[[-87,21],[-87.3,25],[-89,29.8],[-88,33.8]],camera:GULF},
];
export default function WhatIfPanel(){
  const panel=useApp(s=>s.rightPanel),done=useApp(s=>s.introDone),state=useApp(s=>s.whatif),ready=useApp(s=>s.ready);
  const command=useApp(s=>s.whatifRunAt),plants=useApp(s=>s.plants),drugs=useApp(s=>s.drugs);
  const [elapsed,setElapsed]=useState<number|null>(null);
  const generation=useRef(0);
  const currentRun=useRef<AbortController|null>(null);
  const run=useCallback(async()=>{
    const s=useApp.getState(),w=s.whatif;
    if(w.track.length<2){s.setWhatIf({error:'Draw a path with at least two points.'});return;}
    currentRun.current?.abort();
    const controller=new AbortController();
    currentRun.current=controller;
    const ticket=++generation.current,start=performance.now();
    const req:WhatIfRequest={track:w.track,category:w.category,forwardSpeedKt:w.forwardSpeedKt,members:1000};
    s.set({scenarioId:'whatif',playing:false});
    s.setWhatIf({drawing:false,running:true,error:undefined});
    try {
      const result=await runWhatIfInBrowser(req,controller.signal);
      if(ticket!==generation.current)return;
      const current=useApp.getState().whatif;
      if(current.track!==req.track||current.category!==req.category||current.forwardSpeedKt!==req.forwardSpeedKt){
        s.setWhatIf({running:false});
        return;
      }
      setElapsed(performance.now()-start);
      s.setWhatIf({result,running:false});
      if(useApp.getState().scenarioId==='whatif')s.setLayers({plants:true,hospitals:true,storm:true,network:true});
    }catch(e){
      if(ticket===generation.current)s.setWhatIf({running:false,error:(e as Error).name==='AbortError'?undefined:(e as Error).message||'The ensemble could not finish. Run it again.'});
    }
  },[]);
  useEffect(()=>()=>{generation.current++;currentRun.current?.abort();},[]);
  useEffect(()=>{if(command!==null&&ready)void run()},[command,ready,run]);
  if(!done||panel!=='whatif')return null;
  const result=state.result,ranked=[...(result?.outages??[])].sort((a,b)=>b.pDisrupt-a.pDisrupt);
  const atRisk=result?.drugRisk.filter(d=>d.risk>=.4)??[];
  const affected=result?.hospitalStockouts;
  const hospitalsAtRisk=affected?new Set(Object.values(affected).flatMap(b=>b.p50.flatMap((d,i)=>d<90?[i]:[]))).size:0;
  function preset(p:typeof PRESETS[number]){
    useApp.getState().setWhatIf({track:p.track,result:null,drawing:false,error:undefined});
    useApp.getState().flyTo({...p.camera,duration:900});setElapsed(null);
  }
  return <aside className="right-rail whatif-rail" aria-label="What-if storm builder">
    <div className="rail-header"><span className="eyebrow">Scenario lab</span><h2>What if it hits here?</h2><p>Draw a storm path and explore its effect on the medicine supply network.</p></div>
    <div className="whatif-body">
      <div className="whatif-presets">{PRESETS.map(p=><button key={p.name} disabled={state.running} onClick={()=>preset(p)}><MapPin size={13}/>{p.name}</button>)}</div>
      <div className="track-editor">
        <button className={state.drawing?'draw-button active':'draw-button'} disabled={state.running} onClick={()=>useApp.getState().setWhatIf({drawing:!state.drawing})}>{state.drawing?<Check size={16}/>:<MousePointer2 size={16}/>} {state.drawing?'Finish drawing':'Draw on map'}</button>
        <button aria-label="Undo last track point" disabled={state.running||!state.track.length} onClick={()=>useApp.getState().setWhatIf({track:state.track.slice(0,-1),result:null})}><Undo2 size={16}/></button>
        <button aria-label="Clear storm track" disabled={state.running||!state.track.length} onClick={()=>{useApp.getState().setWhatIf({track:[],result:null,drawing:true});setElapsed(null)}}><RotateCcw size={16}/></button>
      </div>
      <small className="whatif-help">{state.drawing?'Click to add points, or drag across the map.':'Draw at least two points to set the direction of travel.'}</small>
      <label className="whatif-field"><span>Storm intensity<Prov kind="SIMULATED"/></span><div className="category-buttons">{[1,2,3,4,5].map(n=><button key={n} disabled={state.running} aria-pressed={state.category===n} className={state.category===n?'active':''} onClick={()=>useApp.getState().setWhatIf({category:n as 1|2|3|4|5,result:null})}>Cat {n}</button>)}</div></label>
      <label className="whatif-field"><span>Forward speed <b className="num">{state.forwardSpeedKt} kt</b></span><input aria-label="Storm forward speed" type="range" min="5" max="35" step="1" disabled={state.running} value={state.forwardSpeedKt} onChange={e=>useApp.getState().setWhatIf({forwardSpeedKt:Number(e.target.value),result:null})}/><div className="slider-endpoints"><small>Slow moving</small><small>Fast moving</small></div></label>
      <button className="run-ensemble" onClick={()=>void run()} disabled={state.running||state.track.length<2||!ready}>{state.running?<LoaderCircle size={16} className="animate-spin"/>:<Play size={15} fill="currentColor"/>}{state.running?'Running ensemble…':'Run 1,000 storm tracks'}{!state.running&&<ArrowRight size={16}/>}</button>
      {state.error&&<div className="whatif-error" role="alert">{state.error}</div>}
      {result&&<div className="ensemble-results" aria-live="polite">
        <div className="ensemble-result-head"><strong>Ensemble complete</strong><span className="num">{Math.round(elapsed??result.elapsedMs)} ms</span><Prov kind="MODEL"/></div>
        <div className="ensemble-stats"><div><b className="num">{atRisk.length}</b><span>medicines at risk</span></div><div><b className="num">{hospitalsAtRisk.toLocaleString()}</b><span>hospitals exposed</span></div></div>
        <div className="ensemble-caption">Plant disruption probability <small>80% interval</small></div>
        {ranked.slice(0,6).map(outage=>{
          const p=plants.find(p=>p.id===outage.plantId);if(!p)return null;
          return <button className="outage-row" key={p.id} onClick={()=>{useApp.getState().flyTo({longitude:p.lon,latitude:p.lat,zoom:6.3,duration:1000});useApp.getState().set({selectedPlantId:p.id})}}>
            <span><b>{p.name}</b><small>{p.city}, {p.state}</small></span><span className="num" style={{color:riskCss(outage.pDisrupt)}}><b>{Math.round(outage.pDisrupt*100)}%</b><small>{Math.round(outage.ci[0]*100)}–{Math.round(outage.ci[1]*100)}%</small></span>
          </button>;
        })}
        {atRisk.length>0&&<button className="whatif-watchlist" onClick={()=>useApp.getState().set({rightPanel:'drugs'})}>Explore medicine forecasts <ArrowRight size={14}/></button>}
        <p className="whatif-method">Track perturbations use correlated along-track and cross-track error. Disruption and hospital inventory are model estimates. <button onClick={()=>useApp.getState().set({page:'model-card'})}>View model assumptions</button></p>
      </div>}
      {!result&&<div className="ensemble-empty"><Wind size={24}/><b>Every path has a supply chain.</b><p>The ensemble follows plausible storm paths to estimate plant outages and hospital stockout intervals.</p><Prov kind="MODEL"/></div>}
    </div>
  </aside>;
}

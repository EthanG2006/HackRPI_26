import {useEffect,useRef,useState} from 'react';
import {Users,CircleDollarSign,Leaf,Scale,AlarmClock,ArrowUpRight,Cloud} from 'lucide-react';
import {useActiveScenario,useApp} from '../store';
import {fmtCompact,fmtUsd,fmtPct} from '../lib/format';
import {networkView} from '../logistics/network';
import {warningHours} from '../impact/story';
import {Prov} from '../ui/Prov';
export const impactFields = [
 {key:'patients',field:'patientsProtected',name:'Patients protected',icon:Users,format:fmtCompact},
 {key:'dollars',field:'dollarsSaved',name:'Costs avoided',icon:CircleDollarSign,format:fmtUsd},
 {key:'co2',field:'co2TonsAvoided',name:'CO₂ avoided',icon:Leaf,format:(v:number)=>fmtCompact(v)+' t'},
 {key:'equity',field:'highSviPreventedPct',name:'Protection in vulnerable counties',icon:Scale,format:fmtPct},
] as const;
/** Counts smoothly to a new value (ease-out), so changing figures glide instead of jumping. */
export function Tick({value,format,ms=850}:{value:number,format:(n:number)=>string,ms?:number}){
 const [n,setN]=useState(value), prev=useRef(value);
 useEffect(()=>{
 const start=performance.now(),base=prev.current;let id=0;
 const update=(now:number)=>{const p=Math.min(1,(now-start)/ms);prev.current=base+(value-base)*(1-(1-p)**3);setN(prev.current);if(p<1)id=requestAnimationFrame(update)};id=requestAnimationFrame(update);
 // Background or hidden pages may get no animation frames: always land on the final figure.
 const land=setTimeout(()=>{cancelAnimationFrame(id);prev.current=value;setN(value);},ms+150);
 return()=>{cancelAnimationFrame(id);clearTimeout(land);}},[value,ms]);
 return <>{format(n)}</>
}
export default function ImpactCounters(){
 const sc=useActiveScenario(), net=useApp(networkView), hours=useApp(warningHours);
 const open=()=>useApp.getState().set({page:'impact'});
 if(!sc)return <section className="impact-strip" aria-label="Projected impact"/>;
 // Dispatched reroutes add their protected encounters and avoided costs on top of the forecast.
 const metrics=[
  {name:'Patients protected',icon:Users,value:sc.impact.patientsProtected+(net?.kpi.patients??0),format:fmtCompact,hero:true},
  {name:'Costs avoided',icon:CircleDollarSign,value:sc.impact.dollarsSaved+(net?.kpi.dollars??0),format:fmtUsd},
  {name:hours===null?'Hours of warning · none possible':'Hours of warning before failure',icon:AlarmClock,value:hours??0,format:(v:number)=>hours===null?'—':`${Math.round(v)} h`},
  {name:'Protection in vulnerable counties',icon:Scale,value:sc.impact.highSviPreventedPct,format:fmtPct},
  {name:'CO₂ avoided',icon:Leaf,value:sc.impact.co2TonsAvoided,format:(v:number)=>fmtCompact(v)+' t'},
 ];
 return <section className="impact-strip" aria-label="Projected impact">
  <button className="impact-label" onClick={open}><span className="eyebrow"><Cloud size={13}/>Impact with Rx Radar</span><span className="impact-open">Open scoreboard<ArrowUpRight size={13}/></span><Prov kind="MODEL" compact/></button>
  {metrics.map(({name,icon:Icon,value,format,hero})=><button key={name} className={hero?'impact-hero':''} onClick={open}><Rise value={value}/><Icon className="metric-icon"/><span><strong><Tick value={value} format={format}/></strong><small>{name}</small></span></button>)}
 </section>
}
/** A soft glow behind a metric each time it grows by more than 1%. */
function Rise({value}:{value:number}){
 const last=useRef(value),[n,setN]=useState(0);
 useEffect(()=>{if(value>last.current*1.01&&last.current>0)setN(k=>k+1);last.current=value;},[value]);
 return n?<i key={n} className="impact-pulse" aria-hidden="true"/>:null;
}

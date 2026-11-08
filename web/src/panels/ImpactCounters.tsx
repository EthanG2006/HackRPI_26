import {useEffect,useRef,useState} from 'react';
import {Users, CircleDollarSign,Leaf,Scale,ArrowUpRight} from 'lucide-react';
import {useActiveScenario,useApp} from '../store';
import {fmtCompact,fmtUsd,fmtPct} from '../lib/format';
import {Prov} from '../ui/Prov';
export const impactFields = [
 {key:'patients',field:'patientsProtected',name:'Patients protected',icon:Users,format:fmtCompact},
 {key:'dollars',field:'dollarsSaved',name:'Projected savings',icon:CircleDollarSign,format:fmtUsd},
 {key:'co2',field:'co2TonsAvoided',name:'CO₂ avoided',icon:Leaf,format:(v:number)=>fmtCompact(v)+' t'},
 {key:'equity',field:'highSviPreventedPct',name:'High-SVI share of prevented stockouts',icon:Scale,format:fmtPct},
] as const;
export function Tick({value,format}:{value:number,format:(n:number)=>string}){
 const [n,setN]=useState(value), prev=useRef(value);
 useEffect(()=>{const start=performance.now(),base=prev.current;let id=0;
 const update=(now:number)=>{const p=Math.min(1,(now-start)/550);prev.current=base+(value-base)*(1-(1-p)**3);setN(prev.current);if(p<1)id=requestAnimationFrame(update)};id=requestAnimationFrame(update);return()=>cancelAnimationFrame(id)},[value]);
 return <>{format(n)}</>
}
export default function ImpactCounters(){
 const sc=useActiveScenario();
 return <section className="impact-strip" aria-label="Projected impact"><div className="impact-label"><span className="eyebrow">Projected impact</span><Prov kind="MODEL"/></div>
 {impactFields.map(({field,name,icon:Icon,format})=><button key={field} onClick={()=>useApp.getState().set({page:'impact'})}><Icon className="metric-icon"/><span><strong className="num">{sc?<Tick value={sc.impact[field]} format={format}/>: '—'}</strong><small>{name}</small></span><ArrowUpRight className="metric-arrow" size={12}/></button>)}</section>
}

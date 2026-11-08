import {useApp} from '../../store';
import type {Drug,DrugRisk} from '../../types';
import {fmtPct,fmtInt} from '../../lib/format';
import {Trend} from '../../ui/Trend';
import {Prov} from '../../ui/Prov';
import {Factory,ArrowDown,Truck} from 'lucide-react';
export default function DrugDetail({drug:d,risk:r}:{drug:Drug,risk:DrugRisk}){
 const net=useApp(s=>s.network), plants=useApp(s=>s.plants), hubs=useApp(s=>s.distributors);
 const linked=plants.filter(p=>p.drugIds.includes(d.id)), max=Math.max(.01,...r.shap.map(x=>Math.abs(x.value)));
 return <div className="rail-pad"><span className="eyebrow">{d.class}</span><h2>{d.shortName}</h2><p>{d.name}</p><Prov kind="MODEL" sourceIds={d.sourceIds}/>
 <div className="big-risk"><strong className="num">{fmtPct(r.risk)}</strong><span>Shortage risk<br/>80% interval {fmtPct(r.ci[0])}–{fmtPct(r.ci[1])}</span></div>
 <h3>Projected national supply</h3><div className="large-trend"><Trend band={r.supplyCurve} height={65}/></div><div className="axis-caption"><span>Day 0</span><span>P10–P90 band</span><span>Day 89</span></div>
 <p>{fmtInt(r.hospitalsAtRisk)} hospitals reach a modeled stockout within the horizon.</p>
 <h3>Why this drug is at risk</h3><small>Signed contributions · scenario model</small>{r.shap.map((v,i)=><div className="driver" key={i}><div><span>{v.label}</span><b className="num">{v.value>0?'+':''}{v.value.toFixed(2)}</b></div><div className="driver-track"><i style={{left:v.value<0?(50-48*Math.abs(v.value)/max)+'%':'50%',width:(48*Math.abs(v.value)/max)+'%',background:v.value<0?'#67d9c6':'#efaa6a'}}/></div></div>)}
 <h3>Supply links</h3><div className="supply-graph">{linked.slice(0,5).map(p=>{
 const edge=net?.edges.find(e=>e.target==='plant:'+p.id&&e.kind==='made-at');
 const flow=net?.flows.find(f=>f.plantId===p.id&&f.drugIds.includes(d.id));
 const hub=hubs.find(h=>h.id===flow?.dcId);
 return <div key={p.id}><p><Factory size={15}/><strong>{p.name}</strong></p><small>{p.company} · {fmtPct(edge?.confidence??p.linkConfidence)} link confidence</small><Prov kind={edge?.provenance??p.shareProvenance} compact/>{hub&&<p><ArrowDown size={12}/><Truck size={13}/>{hub.name}</p>}</div>})}{!linked.length&&<p>Manufacturer link unresolved in this scenario.</p>}</div>
 <h3>Pharmacy review</h3>{[...d.alternatives.map(x=>({title:x.name,note:x.note})),...d.conservation.map(x=>({title:x.strategy,note:x.note}))].map((x,i)=><p key={i}><strong>{x.title}</strong> {x.note}</p>)}
 <button className="link-button" onClick={()=>useApp.getState().set({page:'model-card'})}>Read the model card ↗</button></div>;
}

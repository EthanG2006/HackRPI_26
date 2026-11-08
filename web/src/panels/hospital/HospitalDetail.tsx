import {useMemo,useState} from 'react';
import {Check,FileDown,MapPin} from 'lucide-react';
import {useApp} from '../../store';
import type {Hospital,ScenarioFile} from '../../types';
import {fmtUsd,fmtPct} from '../../lib/format';
import {Prov} from '../../ui/Prov';
import {buildPlan,stockDate} from './plan';
export default function HospitalDetail({sc,h}:{sc:ScenarioFile,h:Hospital}){
 const equity=useApp(s=>s.equity[sc.id]), audit=useApp(s=>s.audit), s=useApp.getState();
 const plan=useMemo(()=>buildPlan(useApp.getState(),sc,h),[sc,h,equity]);
 const [reason,setReason]=useState(''),[review,setReview]=useState<number|null>(null);
 return <div className="rail-pad"><span className="eyebrow"><MapPin size={13}/>{h.city}, {h.state}</span>
 <h2>{h.name}</h2><p>{h.type.replace('_',' ')} hospital{h.rural?' · Rural':''}{h.safetyNet?' · Safety-net proxy':''}{h.pediatric?' · Pediatric':''}</p>
 <div className="hospital-stats"><div><strong className="num">{h.beds}</strong><span>Archived beds <Prov kind={h.imputed?.includes('beds')?'SIMULATED':'REAL'} compact/></span></div><div><strong className="num">{fmtPct(h.svi)}</strong><span>County SVI percentile <Prov kind={h.imputed?.includes('svi')?'SIMULATED':'REAL'} compact/></span></div></div>
 <button className="primary wide" onClick={()=>s.set({briefingFor:{hospitalId:h.id,at:performance.now()}})}><FileDown size={16}/>Generate CMO briefing</button>
 <div className="section-heading"><h3>Inventory outlook</h3><Prov kind="MODEL"/></div>
 {plan.drugs.slice(0,5).map(row=><div className="inventory" key={row.drug.id}><div><b>{row.drug.shortName}</b><strong className="num">{row.inventory===undefined?'—':Math.round(row.inventory)+' d'}</strong></div><div className="meter"><i style={{width:Math.min(100,(row.inventory??0)*100/30)+'%'}}/></div><p>Stockout · {stockDate(sc.day0,row.median)}</p><small>80% window · {stockDate(sc.day0,row.early)} – {stockDate(sc.day0,row.late)}</small></div>)}
 <h3>Pharmacist decisions</h3>{plan.actions.map((a,i)=>{const prior=audit.find(x=>x.action===a.action&&x.hospitalId===h.id&&x.scenarioId===sc.id);return <div className="action-row" key={a.action}><h4>{a.action}</h4><p>{a.reason}</p>{prior?<small className="approved"><Check size={13}/> {prior.decision} · {prior.reason}</small>:review===i?<form onSubmit={e=>{e.preventDefault();if(!reason.trim())return;s.addAudit({hospitalId:h.id,scenarioId:sc.id,user:'Pharmacist (demo)',action:a.action,reason:reason.trim(),decision:'approved'});setReview(null);setReason('')}}><label>Approval reason<input autoFocus required maxLength={240} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Record your rationale"/></label><button className="primary">Approve action</button></form>:<button className="quiet" onClick={()=>{setReview(i);setReason('')}}>Review & approve</button>}</div>})}
 <div className="section-heading"><h3>Purchasing scenario</h3><Prov kind="SIMULATED"/></div><dl className="data-list"><div><dt>Contract purchase</dt><dd>{fmtUsd(plan.contract)}</dd></div><div><dt>Emergency purchase</dt><dd>{fmtUsd(plan.crisis)}</dd></div><div><dt>Price exposure avoided</dt><dd>{fmtUsd(plan.crisis-plan.contract)}</dd></div><div><dt>Staff time saved (assumed)</dt><dd>{plan.staffHours} h</dd></div></dl><button className="link-button" onClick={()=>s.set({page:'audit'})}>Open decision log ↗</button></div>
}

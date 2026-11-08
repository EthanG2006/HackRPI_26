import {useEffect,useRef} from 'react';
import {X} from 'lucide-react';
import {useApp} from '../store';
import {Prov} from '../ui/Prov';
import {fmtUtc} from '../lib/format';
import {Sources,ModelCard} from './Evidence';
import Climate from './Climate';
import Scoreboard from './Scoreboard';
export const pageNames={'sources':'Sources','model-card':'Model card','under-the-hood':'Under the hood','audit':'Decision log','climate':'Climate exposure','impact':'Impact scoreboard'};
export default function PageModal(){
 const page=useApp(s=>s.page),log=useApp(s=>s.audit),body=useRef<HTMLDivElement>(null),close=useRef<HTMLButtonElement>(null);
 useEffect(()=>{body.current?.scrollTo(0,0);if(page)close.current?.focus()},[page]);
 if(!page)return null;
 const s=useApp.getState();
 return <div className="modal-back" onMouseDown={e=>{if(e.target===e.currentTarget)s.set({page:null})}}><section className="page-dialog" role="dialog" aria-modal="true" aria-label={pageNames[page]}><header><div><span className="eyebrow">Rx Radar / Intelligence desk</span><h2>{pageNames[page]}</h2></div><button ref={close} aria-label="Close page" className="icon-button" onClick={()=>s.set({page:null})}><X/></button></header>
 <nav>{Object.entries(pageNames).map(([id,name])=><button key={id} className={id===page?'active':''} onClick={()=>s.set({page:id as keyof typeof pageNames})}>{name}</button>)}</nav>
 <div className="page-body" ref={body}>{page==='sources'?<Sources/>:page==='model-card'?<ModelCard/>:page==='climate'?<Climate/>:page==='under-the-hood'?<><img className="architecture" alt="Weather and facility sources feed dated risk estimates, an inventory cascade and allocations reviewed by pharmacists" src="/architecture.svg"/><h3>Offline replay</h3><p>Local snapshots supply the map, timeline, source register and model evidence. Archived advisories enter the replay at their publication timestamps.</p><h3>Interactive computation</h3><p>The storm builder samples uncertain tracks, estimates plant exposure and projects inventory across hospitals. Allocation compares purchasing behavior with need-weighted coverage. Browser workers support disconnected operation.</p><h3>Human review</h3><p>The copilot uses the same map selections and scenario results as the interface. A pharmacist records a reason before approving an action. Decisions stay in this browser.</p></>:page==='audit'?<><p>Pharmacist decisions stored in this browser.</p>{!log.length?<div className="text-callout">No decisions recorded yet. Open a hospital, review a recommended action, and enter the approval reason.</div>:log.map(e=><div className="source" key={e.id}><span className="eyebrow">{e.decision} · {e.scenarioId}</span><h4>{e.action}</h4><p>{e.reason}</p><small>{s.hospitals.find(h=>h.id===e.hospitalId)?.name??e.hospitalId} · {fmtUtc(e.at,true)} · {e.user}</small></div>)}</>:<Scoreboard/>}</div></section></div>
}

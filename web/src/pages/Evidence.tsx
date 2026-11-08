import {useState} from 'react';
import {useApp} from '../store';
import {Prov} from '../ui/Prov';
import {fmtInt,fmtUtc,fmtPct} from '../lib/format';
import {Search,ExternalLink} from 'lucide-react';

export function Sources(){
 const sources=useApp(s=>s.sources),facts=useApp(s=>s.facts),[q,setQ]=useState('');
 return <><h3>Historical record</h3>{facts.filter(f=>f.verified).map(f=><div className="fact" key={f.id}><p>{f.text}</p>{f.sourceIds.map(id=>{const src=sources.find(s=>s.id===id);return src?<a key={id} href={src.url} target="_blank" rel="noreferrer">{src.publisher} ↗</a>:null})}</div>)}
 <div className="section-heading"><h3>Dataset register</h3><label className="search-box"><Search size={14}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Filter sources"/></label></div>
 {sources.filter(x=>(x.name+' '+x.publisher+' '+x.usedFor).toLowerCase().includes(q.toLowerCase())).map(x=><div className="source" key={x.id}><span className="eyebrow">{x.publisher} · {x.status}</span><h4>{/^https?:/.test(x.url)?<a href={x.url} target="_blank" rel="noreferrer">{x.name} <ExternalLink size={12}/></a>:x.name}</h4><p>{x.usedFor}</p>{x.notes&&<small>{x.notes}</small>}<footer>{x.retrieved} · {x.license}</footer></div>)}</>
}

export function ModelCard(){
 const m=useApp(s=>s.riskModel),hazard=useApp(s=>s.hazardModel),sc=useApp(s=>s.scenarios);
 return <><div className="text-callout"><b>Hospital pharmacy planning</b><p>Estimate facility exposure, compare inventory scenarios and examine how a limited supply could be shared. Patient-level allocation and individual treatment decisions are outside scope. A pharmacist reviews each proposed action.</p></div>
 {m&&<><div className="section-heading"><h3>{m.name}</h3><Prov kind={m.provenance}/></div><p>{m.split}</p><small>{fmtInt(m.nTrain)} training records · {fmtInt(m.nTest)} held out · {m.version}</small>
 <div className="metric-grid">{[['ROC AUC',m.metrics.rocAuc],['PR AUC',m.metrics.prAuc],['Brier score',m.metrics.brier],['Base rate',m.metrics.baseRate]].map(([name,value])=><div key={String(name)}><b>{typeof value==='number'?value.toFixed(3):'N/A'}</b><small>{name}</small></div>)}</div>
 <h3>Held-out calibration</h3><p>Each circle is a probability bin. The diagonal represents perfect agreement between predicted and observed rates.</p><svg className="calibration" viewBox="0 0 370 172" role="img" aria-label="Calibration plot, predicted probability on horizontal axis, observed rate on vertical axis"><path d="M40 12 V140 H350 M40 140 L350 12" stroke="#476271" fill="none"/>{[0,.5,1].map(v=><g key={v}><text x={40+v*310} y="155">{v}</text><text x="17" y={141-v*128}>{v}</text></g>)}{m.calibration.map((b,i)=><circle key={i} cx={40+310*b.predicted} cy={140-128*b.observed} r={Math.min(8,3+Math.log1p(b.n)/1.5)} fill="#73e3ce"><title>{b.n} records · predicted {fmtPct(b.predicted)} · observed {fmtPct(b.observed)}</title></circle>)}</svg>
 <h3>Fairness audit</h3><p>Drug-level labels cannot validate hospital stockout accuracy. The available subgroup evidence and gaps are listed below.</p><div className="table-wrap"><table><thead><tr><th>Group</th><th>Slice</th><th>Records</th><th>Finding</th></tr></thead><tbody>{m.fairness.map((g,i)=><tr key={i}><td>{g.group}</td><td>{g.slice}</td><td>{g.n}</td><td>{g.flag??(g.rocAuc!=null?'ROC AUC '+g.rocAuc.toFixed(2):'Unvalidated')}</td></tr>)}</tbody></table></div>
 <h3>Limitations</h3><ul>{m.limitations.map(x=><li key={x}>{x}</li>)}</ul></>}
 {hazard&&<><h3>{hazard.name}</h3>{hazard.notes.map(x=><p key={x}>{x}</p>)}<details><summary>Hazard features & priors</summary>{hazard.features.map(f=><p key={f.feature}><b>{f.label}</b> · prior {f.priorMean} ± {f.priorSd} · posterior {f.postMean.toFixed(2)} ± {f.postSd.toFixed(2)}. {f.rationale}</p>)}</details></>}
 <h3>Historical backtests</h3>{Object.values(sc).filter(x=>x.backtest||['helene','maria','rocky-mount'].includes(x.id)).map(x=><div className="source" key={x.id}><h4>{x.name}</h4>{x.backtest?<><p>Information cutoff · {fmtUtc(x.alert?.cutoff??x.backtest.alertT,true)}</p><b className="num">{x.backtest.leadTimeHours.toFixed(1)} h</b> before disruption reference<p>{x.backtest.notes}</p></>:<p>{x.notes?.join(' ')||'No validated pre-event alert in the bundled record.'}</p>}</div>)}</>
}

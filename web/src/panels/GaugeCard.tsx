import {useApp} from '../store';
import {fmtUtc} from '../lib/format';
import {Prov} from '../ui/Prov';
import {Waves} from 'lucide-react';
export default function GaugeCard(){
 const gauge=useApp(s=>s.storms[s.scenarioId]?.gauges?.[0]), time=useApp(s=>Math.trunc(s.time/900000)*900000);
 if(!gauge)return null;
 const points=gauge.points.filter(p=>Date.parse(p.t)<=time).slice(-96),last=points.at(-1);
 const max=Math.max(1,...points.map(p=>p.v)),min=Math.min(0,...points.map(p=>p.v));
 return <section className="gauge-card"><div className="section-heading"><span className="eyebrow"><Waves size={14}/> River gauge</span><Prov kind={gauge.provenance} sourceIds={gauge.sourceIds}/></div><h4>{gauge.name}</h4>
 {last?<><b className="num">{last.v.toFixed(1)} {gauge.unit}</b><svg viewBox="0 0 260 44" preserveAspectRatio="none" role="img" aria-label="River gauge readings up to the replay time"><polyline fill="none" stroke="#69dfea" strokeWidth="2" points={points.map((p,i)=>[i*260/Math.max(1,points.length-1),42-40*(p.v-min)/(max-min)].join(',')).join(' ')}/></svg><small>{fmtUtc(last.t)}</small></>:<p>First archived reading · {gauge.points[0]?fmtUtc(gauge.points[0].t):'unavailable'}</p>}
 </section>
}

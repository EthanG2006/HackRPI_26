import {useApp} from '../store';
import {fmtPct} from '../lib/format';
import {Prov} from '../ui/Prov';
import {Leaf} from 'lucide-react';
export default function Climate(){
 const plants=useApp(s=>s.plants),trends=useApp(s=>s.trends);
 const rows=plants.filter(p=>p.sterileInjectable&&p.nri&&(p.nri.hurricane!==undefined||p.nri.riverine!==undefined)).map(p=>({p,score:Math.max(p.nri?.hurricane??0,p.nri?.riverine??0),share:Object.values(p.share).reduce((a,b)=>a+b,0)}));
 const total=rows.reduce((a,r)=>a+r.share,0),high=rows.filter(r=>r.score>=75).reduce((a,r)=>a+r.share,0);
 const years=Array.from(new Set([...(trends?.disasters.map(d=>d.year)??[]),...(trends?.shortages.map(d=>d.year)??[])])).sort((a,b)=>a-b);
 const data=years.map(year=>{const d=trends?.disasters.find(x=>x.year===year),s=trends?.shortages.filter(x=>x.year===year);return {year,d:d?.count,s:s?.length?Math.max(...s.map(x=>x.active)):undefined}});
 return <><div className="section-heading"><h3><Leaf size={18}/> Climate exposure</h3><Prov kind="MODEL"/></div><div className="headline-stat">{total?fmtPct(high/total):'N/A'}</div><p>Share of product-weighted capacity in this plant sample with a county hurricane or riverine flood score of at least 75/100. A site’s weight is the sum of its estimated product shares. National capacity and unrepresented manufacturers are outside this denominator.</p>
 <h3>Backup capacity priorities</h3><p>Prioritize facilities by modeled product weight × county hazard score. Select a site to inspect its location and risk layer.</p>{rows.sort((a,b)=>b.score*b.share-a.score*a.share).map(({p,score})=><button className="facility" key={p.id} onClick={()=>{const s=useApp.getState();s.set({page:null,selectedPlantId:p.id});s.setLayers({nri:true,plants:true});s.flyTo({longitude:p.lon,latitude:p.lat,zoom:6,duration:1000})}}><span><strong>{p.name}</strong><small>{p.city}, {p.state}</small></span><b>{score.toFixed(0)} / 100</b></button>)}
 <h3>Disasters and shortages</h3><p>Annual billion-dollar disaster counts alongside the highest active-shortage count in the available periods. Separate scales show the recorded series. Association does not establish causation.</p>
 <table><thead><tr><th>Year</th><th>Disasters</th><th>Active shortages</th></tr></thead><tbody>{data.map(x=><tr key={x.year}><td>{x.year}</td><td>{x.d??'—'}</td><td>{x.s??'—'}</td></tr>)}</tbody></table><Prov kind="REAL" sourceIds={trends?.sourceIds}/></>
}

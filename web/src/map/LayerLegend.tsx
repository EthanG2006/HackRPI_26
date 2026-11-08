import type { LayerId } from '../store';
import { useApp } from '../store';
import { Layers, Check, ChevronDown, ChevronUp, X } from 'lucide-react';
import {useState} from 'react';
import { Prov } from '../ui/Prov';
import type { Provenance } from '../types';
import './map.css';

const layers:[LayerId,string,Provenance][]=[
  ['storm','Storm track & forecast cone','REPLAY'],['wind','Holland wind field','MODEL'],['radar','NEXRAD reflectivity','REPLAY'],
  ['satellite','Terra satellite imagery','REPLAY'],['rain','Rainfall outlook','REPLAY'],['gauges','River gauges','REAL'],
  ['flood','Flood hazard zones','REAL'],['tornado','Tornado outlook & track','REPLAY'],['plants','Drug manufacturing sites','REAL'],
  ['network','Distributor routes','SIMULATED'],['hospitals','Hospital stockout forecast','MODEL'],['svi','Social vulnerability','REAL'],['nri','Climate risk index','REAL']
];
export default function LayerLegend(){
  const introDone=useApp(s=>s.introDone),active=useApp(s=>s.layers),id=useApp(s=>s.scenarioId);
  const weather=useApp(s=>s.storms[s.scenarioId]),counties=useApp(s=>s.counties);
  const [open,setOpen]=useState(false);
  if(!introDone) return null;
  return <div className="rx-layer-control">
    <button className="map-switch" aria-expanded={open} onClick={()=>setOpen(!open)}><Layers size={15}/> Map layers {open?<ChevronUp size={13}/>:<ChevronDown size={13}/>}</button>
    {open&&<div className="map-layer-list"><div className="map-layer-heading"><b>Visible layers</b><button aria-label="Close layer settings" onClick={()=>setOpen(false)}><X size={15}/></button></div>
      {layers.map(([key,label,kind])=>{
        const missing=(key==='flood'&&!weather?.floodZones?.some(z=>z.polygons?.length))||(key==='tornado'&&!weather?.spc?.length&&!weather?.tornado&&id!=='live')
          ||(key==='nri'&&!Object.values(counties?.counties??{}).some(c=>c.nriHurricane!==undefined||c.nriRiverine!==undefined)) || (['radar','satellite','rain','gauges'].includes(key)&&!weather&&id!=='live');
        const k=key==='plants'?'SIMULATED':key==='svi'&&counties?.sourceIds.some(x=>x.includes('simulat'))?'SIMULATED':kind;
        return <div className={'layer-row'+(missing?' unavailable':'')} key={key}><button disabled={missing} role="switch" aria-checked={!missing&&active[key]} onClick={()=>useApp.getState().toggleLayer(key)} title={missing?'No geometry available for this scenario':label}><i className={!missing&&active[key]?'is-on':''}>{!missing&&active[key]&&<Check size={10}/>}</i>{label}</button><Prov kind={k} compact/></div>;
      })}</div>}
  </div>;
}

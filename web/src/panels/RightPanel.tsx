import {useEffect,useMemo,useState} from 'react';
import {Pill,ChevronRight,ArrowLeft,Hospital as HospitalIcon,Search,MapPin} from 'lucide-react';
import {useApp,useActiveScenario} from '../store';
import {fmtPct,fmtInt} from '../lib/format';
import {riskCss} from '../lib/colors';
import {Prov} from '../ui/Prov';
import {Trend} from '../ui/Trend';
import HospitalDetail from './hospital/HospitalDetail';
import DrugDetail from './drug/DrugDetail';
import GaugeCard from './GaugeCard';
import {goBeat, localHospital} from '../presenter/beats';

export default function RightPanel(){
 const sc=useActiveScenario(), drugs=useApp(s=>s.drugs), hospitals=useApp(s=>s.hospitals), id=useApp(s=>s.selectedDrugId), hid=useApp(s=>s.selectedHospitalId);
 const panel=useApp(s=>s.rightPanel), eq=useApp(s=>s.equityOpen), briefing=useApp(s=>s.briefingFor), plants=useApp(s=>s.plants), pid=useApp(s=>s.selectedPlantId), showIntro=useApp(s=>!s.introDone);
 const [filter,setFilter]=useState(''),[tab,setTab]=useState('meds'),[notice,setNotice]=useState(''),[expanded,setExpanded]=useState(false);const s=useApp.getState();
 useEffect(()=>{if(!briefing)return;let alive=true;import('../briefing/generate').then(m=>m.generateBriefing(briefing.hospitalId)).then(()=>{if(alive)setNotice('CMO briefing downloaded.')}).catch(()=>{if(alive)setNotice('Briefing unavailable. Select a hospital and retry.')});return()=>{alive=false}},[briefing]);
 useEffect(()=>{setNotice('');setFilter('');setTab('meds');setExpanded(false)},[sc?.id,hid]);
 const ranked=useMemo(()=>[...(sc?.drugRisk??[])].sort((a,b)=>b.risk-a.risk),[sc]);
 const drug=drugs.find(x=>x.id===id),r=ranked.find(x=>x.drugId===id),hospital=hospitals.find(x=>x.id===hid);
 const local=useMemo(()=>hospitals.filter(h=>h.name.toLowerCase().includes(filter.toLowerCase())||h.city.toLowerCase().includes(filter.toLowerCase())).sort((a,b)=>Number(/troy|albany/i.test(b.city)&&b.state==='NY')-Number(/troy|albany/i.test(a.city)&&a.state==='NY')).slice(0,50),[hospitals,filter]);
 const visible=expanded?ranked:ranked.slice(0,5);
 const warned=!!sc?.alert && s.time>=Date.parse(sc.alert.t);
 const plant=plants.find(p=>p.id===pid), detail=(panel==='drug'&&drug&&r)||(panel==='hospital'&&hospital);
 if(eq||panel==='whatif'||showIntro)return null;
 return <aside className="right-rail default-rail">
 {detail&&sc?<><button className="rail-back" onClick={()=>{s.selectDrug(null);s.set({selectedHospitalId:null})}}><ArrowLeft size={15}/>Back to watchlist</button>{notice&&<div className="download-notice" role="status">{notice}</div>}
 {panel==='hospital'&&hospital?<HospitalDetail key={hospital.id+sc.id} sc={sc} h={hospital}/>:drug&&r?<DrugDetail drug={drug} risk={r}/>:null}</>:
 <><div className="rail-header"><span className="eyebrow">Pharmacy operations</span><h2>Medicines to protect</h2><p className="focus-copy">A factory outage can reach hospitals weeks later. See what needs attention first.</p><div className="rail-tabs"><button className={tab==='meds'?'active':''} onClick={()=>{setTab('meds');setFilter('')}}><Pill size={15}/>Medicines</button><button className={tab==='hospitals'?'active':''} onClick={()=>{setTab('hospitals');setFilter('')}}><HospitalIcon size={15}/>Hospitals</button></div></div>
 {tab==='meds'?<><div className="story-prompt"><b>{warned?'The warning is in. What happens in Troy?':'Follow the storm before supplies run low.'}</b><button className="primary wide" onClick={()=>{if(sc?.id==='helene')goBeat(warned?4:3);else {const h=localHospital();if(h)s.openHospital(h.id);}}}>{sc?.id==='helene'&&!warned?'See the early warning':'Open a hospital plan'}<ChevronRight size={15}/></button></div><div className="rank-caption"><span>Shortage forecast · 90 days</span><Prov kind="MODEL"/></div>
 {plant&&<div className="selected-plant"><MapPin size={14}/><span>{plant.name}<small>{plant.city}, {plant.state}</small></span><button onClick={()=>s.set({selectedPlantId:null})} aria-label="Clear plant selection">×</button></div>}
 {visible.map((x,i)=>{const d=drugs.find(y=>y.id===x.drugId);if(!d)return null;const color=riskCss(x.risk);return <button className="risk-row" key={d.id} onClick={()=>s.selectDrug(d.id)}><div className="risk-first"><span className="risk-rank num">{String(i+1).padStart(2,'0')}</span><b>{d.shortName}</b><strong className="num" style={{color}}>{fmtPct(x.risk)}</strong></div><div className="risk-second"><span>{d.class}{d.whoEssential?' · WHO essential':d.pediatric?' · Pediatric':''}</span><small className="num">{fmtPct(x.ci[0])}–{fmtPct(x.ci[1])}</small></div><div className="risk-bottom"><span>{fmtInt(x.hospitalsAtRisk)} hospitals could run short</span><Trend band={x.supplyCurve} color={color} height={21}/><ChevronRight size={13}/></div></button>})}
 {ranked.length>5&&<button className="show-more" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'Show priority medicines':`Show all ${ranked.length} medicines`}</button>}
 {!ranked.length&&<p className="rail-pad">Preparing the supply outlook for this scenario.</p>}
 <div className="rail-pad"><details className="extra-details"><summary>River conditions near the factory</summary><GaugeCard/></details><button className="link-button" onClick={()=>s.set({page:'model-card'})}>Explore model & evidence ↗</button></div>
 </>:<div className="rail-pad"><label className="search-box"><Search size={14}/><input placeholder="Hospital name or city" value={filter} onChange={e=>setFilter(e.target.value)}/></label><p>{filter?'Matching facilities':'Capital Region & national network'}</p>{local.map(h=><button className="facility" key={h.id} onClick={()=>s.openHospital(h.id)}><span><strong>{h.name}</strong><small>{h.city}, {h.state}</small></span><ChevronRight size={14}/></button>)}{!local.length&&<p>No matching hospital.</p>}</div>}</>}
 </aside>
}

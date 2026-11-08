import {useEffect,useState} from 'react';
import {Activity,CloudRainWind,Flame,Snowflake,Tornado,Waves} from 'lucide-react';
import {useApp} from '../store';
import {loadPresets,applyPreset,cameraFor,type LabPreset} from './presets';
import {Segmented,Slider} from './controls';
import {CATEGORY_VMAX} from '../sim/lab/params';
import {HAZARDS,HAZARD_ORDER,type HazardPreset} from '../sim/lab/hazardMeta';
import type {HazardKind} from '../types';
import LabSetup from './LabSetup';
const LOCATIONS=[['syn-pr','Puerto Rico','Medicine manufacturing corridor'],['syn-gulf','Gulf Coast','Coastal factories and transport'],['syn-carolina','Carolinas','Heavy rain reaching inland']] as const;
const ICONS:Record<HazardKind,typeof Flame>={hurricane:CloudRainWind,earthquake:Activity,wildfire:Flame,flood:Waves,tornado:Tornado,winter:Snowflake};
const DRAW:Record<HazardKind,string>={hurricane:'Draw my own track',earthquake:'Place my own epicenter',wildfire:'Set my own ignition',flood:'Trace my own river',tornado:'Draw my own tornado path',winter:'Draw my own ice band'};

/** Load a non-hurricane disaster preset: geometry, settings and camera. */
export function applyHazard(kind:HazardKind,p:HazardPreset){
 const s=useApp.getState();
 s.setWhatIf({hazard:{kind,intensity:p.intensity,extent:p.extent,durationH:p.durationH},track:p.track,fixes:null,presetId:p.id,startTime:undefined,field:'hazard',result:null,hour:null,labPlaying:false,drawing:false,error:undefined});
 s.set({scenarioId:'whatif',rightPanel:'whatif',playing:false,equityOpen:false});
 const c=cameraFor(p.track);s.flyTo(kind==='earthquake'?{...c,zoom:Math.min(c.zoom,5.4)}:kind==='wildfire'?{...c,zoom:7.4}:c);
}

export default function QuickStormSetup(){
 const w=useApp(s=>s.whatif),[presets,setPresets]=useState<LabPreset[]>([]);
 useEffect(()=>{void loadPresets().then(setPresets);},[]);
 const kind=w.hazard.kind,meta=HAZARDS[kind],Icon=ICONS[kind];
 const setLab=(patch:Partial<typeof w.lab>)=>useApp.getState().setWhatIf({lab:{...useApp.getState().whatif.lab,...patch}});
 function pick(k:HazardKind){
   if(k===kind)return;
   if(k==='hurricane'){const p=presets.find(x=>x.id==='syn-pr');useApp.getState().setWhatIf({hazard:{...w.hazard,kind:'hurricane'},field:'p64'});if(p)applyPreset(p);return;}
   applyHazard(k,HAZARDS[k].presets[0]);
 }
 return <div className="quick-storm">
   <h3>What kind of disaster?</h3>
   <div className="hazard-kinds" role="radiogroup" aria-label="Disaster type">{HAZARD_ORDER.map(k=>{const I=ICONS[k];return <button key={k} role="radio" aria-checked={k===kind} disabled={w.running} onClick={()=>pick(k)}><I size={18}/><span>{HAZARDS[k].name}</span></button>})}</div>
   <h3>Where does it hit?</h3><p>{kind==='hurricane'?'Choose a coast, then drag the track to change its path.':meta.draw}</p>
   {kind==='hurricane'?<div className="storm-locations">{LOCATIONS.map(([id,name,note])=><button key={id} aria-pressed={w.presetId===id} disabled={!presets.length||w.running} onClick={()=>{const p=presets.find(x=>x.id===id);if(p)applyPreset(p);}}><b>{name}</b><span>{note}</span></button>)}</div>
   :<div className="storm-locations">{meta.presets.map(p=><button key={p.id} aria-pressed={w.presetId===p.id} disabled={w.running} onClick={()=>applyHazard(kind,p)}><b><Icon size={13}/> {p.name}</b><span>{p.note}</span></button>)}</div>}
   {kind!=='hurricane'?meta.sliders.map(sl=><Slider key={sl.key} label={sl.label} value={w.hazard[sl.key]} min={sl.min} max={sl.max} step={sl.step} format={sl.fmt} hint={sl.hint}
      onChange={v=>useApp.getState().setWhatIf({hazard:{...useApp.getState().whatif.hazard,[sl.key]:v}})}/>)
   :w.fixes?<p className="storm-record-note">Historical storm selected. Open advanced settings to change its recorded intensity.</p>:<>
   <Segmented label="Storm strength" value={w.category} options={[1,2,3,4,5].map(n=>({value:n,label:`Cat ${n}`}))} onChange={v=>useApp.getState().setWhatIf({category:v as 1|2|3|4|5,lab:{...useApp.getState().whatif.lab,vmaxKt:CATEGORY_VMAX[Number(v) as 1|2|3|4|5]}})}/>
   <Slider label="Travel speed" value={w.forwardSpeedKt} min={2} max={30} step={1} format={v=>`${Math.round(v*1.15078)} mph`} onChange={v=>useApp.getState().setWhatIf({forwardSpeedKt:v})} hint="Slower storms leave more rain in one place."/>
   <Slider label="Time stalled" value={w.lab.stallHours} min={0} max={48} step={6} format={v=>v===0?'No stall':`${v} hours`} onChange={v=>setLab({stallHours:v,stallAtFix:Math.max(0,Math.floor(w.track.length/2))})}/>
   </>}
   <button className="sl-btn" onClick={()=>useApp.getState().setWhatIf(w.drawing?{drawing:false}:{drawing:true,track:[],fixes:null,presetId:null,result:null})}>{w.drawing?'Finish drawing':DRAW[kind]}</button>
   {kind==='hurricane'&&<details className="extra-details"><summary>Advanced storm settings</summary><LabSetup/></details>}
 </div>;
}

import {useEffect,useState} from 'react';
import {useApp} from '../store';
import {loadPresets,applyPreset,type LabPreset} from './presets';
import {Segmented,Slider} from './controls';
import {CATEGORY_VMAX} from '../sim/lab/params';
import LabSetup from './LabSetup';
const LOCATIONS=[['syn-pr','Puerto Rico','Medicine manufacturing corridor'],['syn-gulf','Gulf Coast','Coastal factories and transport'],['syn-carolina','Carolinas','Heavy rain reaching inland']] as const;
export default function QuickStormSetup(){
 const w=useApp(s=>s.whatif),[presets,setPresets]=useState<LabPreset[]>([]);
 useEffect(()=>{void loadPresets().then(setPresets);},[]);
 const setLab=(patch:Partial<typeof w.lab>)=>useApp.getState().setWhatIf({lab:{...useApp.getState().whatif.lab,...patch}});
 return <div className="quick-storm">
   <h3>Where does it hit?</h3><p>Choose a coast, then drag the track to change its path.</p>
   <div className="storm-locations">{LOCATIONS.map(([id,name,note])=><button key={id} aria-pressed={w.presetId===id} disabled={!presets.length||w.running} onClick={()=>{const p=presets.find(x=>x.id===id);if(p)applyPreset(p);}}><b>{name}</b><span>{note}</span></button>)}</div>
   {w.fixes?<p className="storm-record-note">Historical storm selected. Open advanced settings to change its recorded intensity.</p>:<>
   <Segmented label="Storm strength" value={w.category} options={[1,2,3,4,5].map(n=>({value:n,label:`Cat ${n}`}))} onChange={v=>useApp.getState().setWhatIf({category:v as 1|2|3|4|5,lab:{...useApp.getState().whatif.lab,vmaxKt:CATEGORY_VMAX[Number(v) as 1|2|3|4|5]}})}/>
   <Slider label="Travel speed" value={w.forwardSpeedKt} min={2} max={30} step={1} format={v=>`${Math.round(v*1.15078)} mph`} onChange={v=>useApp.getState().setWhatIf({forwardSpeedKt:v})} hint="Slower storms leave more rain in one place."/>
   <Slider label="Time stalled" value={w.lab.stallHours} min={0} max={48} step={6} format={v=>v===0?'No stall':`${v} hours`} onChange={v=>setLab({stallHours:v,stallAtFix:Math.max(0,Math.floor(w.track.length/2))})}/>
   </>}
   <button className="sl-btn" onClick={()=>useApp.getState().setWhatIf(w.drawing?{drawing:false}:{drawing:true,track:[],fixes:null,presetId:null,result:null})}>{w.drawing?'Finish drawing':'Draw my own track'}</button>
   <details className="extra-details"><summary>Advanced storm settings</summary><LabSetup/></details>
 </div>;
}

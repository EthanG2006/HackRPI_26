import {useState} from 'react';
import {Radar, Command, AudioLines, PanelTopOpen, ChevronDown, Volume2, VolumeX, BookOpen, SlidersHorizontal, Waypoints, Radio, Activity, Truck} from 'lucide-react';
import {useApp, useActiveScenario} from '../store';
import type {ScenarioId} from '../types';
import {goBeat,switchScenario} from '../presenter/beats';

export const scenes: [ScenarioId,string][]=[['helene','Hurricane Helene'],['rocky-mount','Rocky Mount tornado'],['maria','Hurricane Maria'],['live','Live weather'],['whatif','What-if disaster']];
export default function TopBar() {
  const id=useApp(s=>s.scenarioId), muted=useApp(s=>s.muted), equity=useApp(s=>s.equityOpen), logistics=useApp(s=>s.rightPanel==='logistics');
  const sc=useActiveScenario(), [menu,setMenu]=useState(false);
  const s=useApp.getState();
  return <>
    <header className="masthead">
      <button className="brand" onClick={()=>goBeat(1)} title="Title screen"><Radar/><span>Rx<span className="rx-accent">Radar</span></span></button>
      <span className="mast-divider"/><span className="product-name">Storms to medicine shortages</span>
      <div className="head-actions">
        <button className="head-text" onClick={()=>s.set({page:'sources'})}><BookOpen size={16}/>Sources</button>
        <button className="icon-button" title="Presenter menu" aria-label="Presenter menu" onClick={()=>s.set({paletteOpen:true})}><Command size={17}/></button>
        <button className="icon-button" title={muted?'Unmute sound':'Mute sound'} aria-label={muted?'Unmute sound':'Mute sound'} onClick={()=>s.set({muted:!muted})}>{muted?<VolumeX size={17}/>:<Volume2 size={17}/>}</button>
        <button className="copilot-trigger" onClick={()=>s.set({copilotOpen:!s.copilotOpen})}><AudioLines size={17}/>Ask Rx Radar</button>
      </div>
    </header>
    <section className="map-heading">
      <div className="scenario-picker"><span className="eyebrow"><span className="status-dot"/>{id==='live'?'Weather watch':id==='whatif'?'Scenario builder':'Historical replay'}</span>
        <button aria-label="Choose scenario" aria-expanded={menu} onClick={()=>setMenu(!menu)}>{scenes.find(x=>x[0]===id)?.[1]}<ChevronDown size={19}/></button>
        {menu&&<><button className="dismiss-area" aria-label="Close scenarios" onClick={()=>setMenu(false)}/><div className="scenario-menu">{scenes.map(([key,title])=><button key={key} onClick={()=>{switchScenario(key);setMenu(false)}}><span>{title}</span><small>{key==='helene'?'2024':key==='maria'?'2017':key==='rocky-mount'?'2023':key==='live'?'NOW':'DRAW'}</small></button>)}</div></>}
      </div>
      <nav className="map-tabs" aria-label="Workspace"><button className={!equity&&!logistics&&id!=='whatif'?'active':''} onClick={()=>{if(id==='whatif')switchScenario('helene');s.set({equityOpen:false,rightPanel:'drugs',abmPlaying:false});s.setLayers({storm:true,wind:true,radar:true,rain:true,network:true,hospitals:true,svi:false})}}><Activity/>Storm watch</button><button className={equity?'active':''} onClick={()=>{if(id==='whatif'&&!s.whatif.result)goBeat(5);else {s.set({equityOpen:true,rightPanel:'equity',abmDay:14,copilotOpen:false,selectedHospitalId:null,highlight:null});s.flyTo({longitude:-88,latitude:36,zoom:4.15,duration:1200});s.setLayers({storm:false,wind:false,radar:false,rain:false,network:false,hospitals:true,svi:true})}}}><SlidersHorizontal/>Share supply</button><button className={logistics&&!equity?'active':''} onClick={()=>{s.set({rightPanel:'logistics',equityOpen:false,abmPlaying:false,copilotOpen:false,selectedHospitalId:null});s.setLayers({network:true,hospitals:true,plants:true,svi:false});s.flyTo({longitude:-87,latitude:36.5,zoom:3.95,duration:1200});}}><Truck/>Reroute supply</button><button className={id==='whatif'&&!equity&&!logistics?'active':''} onClick={()=>{if(id==='whatif')s.set({rightPanel:'whatif',equityOpen:false});else switchScenario('whatif');s.setLayers({storm:true,wind:true,radar:false,rain:false,network:true,hospitals:true,svi:false});}}><Waypoints/>Test a disaster</button></nav>
    </section>
    {id==='live'&&<LiveStatus/>}
    <button className="mobile-panel" title="Toggle detail panel" aria-label="Toggle detail panel" onClick={()=>document.documentElement.classList.toggle('show-rail')}><PanelTopOpen size={19}/></button>
  </>;
}
function LiveStatus(){
 const live=useApp(s=>s.live);
 return <div className="live-status"><Radio size={16}/><div><b>{live?.fromCache?'Archived weather snapshot':'Current weather snapshot'}</b><p>{live?.headline??'Loading latest weather products…'}</p><small>{live?.fetchedAt}</small></div></div>
}

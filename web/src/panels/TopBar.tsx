import {useState} from 'react';
import {Radar, Command, AudioLines, PanelTopOpen, ChevronDown, Volume2, VolumeX, BookOpen, SlidersHorizontal, Waypoints, Radio, Activity} from 'lucide-react';
import {useApp, useActiveScenario} from '../store';
import type {ScenarioId} from '../types';
import {goBeat,switchScenario} from '../presenter/beats';

export const scenes: [ScenarioId,string][]=[['helene','Hurricane Helene'],['rocky-mount','Rocky Mount tornado'],['maria','Hurricane Maria'],['live','Live weather'],['whatif','What-if storm']];
export default function TopBar() {
  const id=useApp(s=>s.scenarioId), muted=useApp(s=>s.muted), equity=useApp(s=>s.equityOpen);
  const sc=useActiveScenario(), [menu,setMenu]=useState(false);
  const s=useApp.getState();
  return <>
    <header className="masthead">
      <button className="brand" onClick={()=>goBeat(1)} title="Title screen"><Radar/><span>Rx<span className="rx-accent">Radar</span></span></button>
      <span className="mast-divider"/><span className="product-name">Supply intelligence</span>
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
      <nav className="map-tabs" aria-label="Workspace"><button className={!equity&&id!=='whatif'?'active':''} onClick={()=>{if(id==='whatif')switchScenario('helene');s.set({equityOpen:false,rightPanel:'drugs',abmPlaying:false})}}><Activity/>Monitor</button><button className={equity?'active':''} onClick={()=>s.set({equityOpen:true,rightPanel:'equity',abmDay:0,copilotOpen:false})}><SlidersHorizontal/>Equity lab</button><button className={id==='whatif'&&!equity?'active':''} onClick={()=>switchScenario('whatif')}><Waypoints/>What-if</button></nav>
    </section>
    {id==='live'&&<LiveStatus/>}
    <button className="mobile-panel" title="Toggle detail panel" aria-label="Toggle detail panel" onClick={()=>document.documentElement.classList.toggle('show-rail')}><PanelTopOpen size={19}/></button>
  </>;
}
function LiveStatus(){
 const live=useApp(s=>s.live);
 return <div className="live-status"><Radio size={16}/><div><b>{live?.fromCache?'Archived weather snapshot':'Current weather snapshot'}</b><p>{live?.headline??'Loading latest weather products…'}</p><small>{live?.fetchedAt}</small></div></div>
}

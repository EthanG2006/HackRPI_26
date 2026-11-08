import {useState} from 'react';
import {Pause,Play,SkipBack,Flag,ChevronRight} from 'lucide-react';
import {useActiveScenario,useApp,SPEEDS} from '../store';
import {fmtUtc} from '../lib/format';
import {Prov} from '../ui/Prov';
import {goBeat} from '../presenter/beats';
export default function Timeline(){
 const sc=useActiveScenario(), t=useApp(s=>s.time), playing=useApp(s=>s.playing), speed=useApp(s=>s.speed), beat=useApp(s=>s.beat);
 const [events,setEvents]=useState(false);
 const s=useApp.getState(), start=sc?Date.parse(sc.start):0, end=sc?Date.parse(sc.end):1;
 const replay=!!sc&&['helene','rocky-mount','maria'].includes(sc.id);
 const pct=Math.min(100,Math.max(0,(t-start)/Math.max(1,end-start)*100));
 function seek(next:number){
   s.setTime(next); s.setPlaying(false);
   if(sc?.alert){const cutoff=Date.parse(sc.alert.t);if(next<cutoff)s.resetAlert();else if(t<cutoff)s.fireAlert();}
 }
 const pins=sc?.events.filter(e=>e.pin||['landfall','plant-hit','alert','fda-listing','allocation'].includes(e.kind))??[];
 return <footer className="timeline">
  <div className="play-controls"><button className="play" aria-label={playing?'Pause replay':'Play replay'} disabled={!replay} onClick={()=>{if(t>=end)seek(start);s.setPlaying(!playing)}}>{playing?<Pause size={18}/>:<Play size={18}/>}</button>
    <button className="icon-button" aria-label="Rewind replay" disabled={!replay} onClick={()=>seek(start)}><SkipBack size={15}/></button>
    <select title="Replay speed" aria-label="Replay speed" value={speed} onChange={e=>s.setSpeed(Number(e.target.value))}>{SPEEDS.map(n=><option key={n} value={n}>{n}×</option>)}</select></div>
  <div className="scrub-area"><div className="scrub-caption"><span>{replay?'REPLAY CLOCK':sc?.id==='live'?'WEATHER SNAPSHOT':'SIMULATION CLOCK'}</span><b>{replay?fmtUtc(t,true):sc?.id==='live'?fmtUtc(s.live?.fetchedAt??t,true):'Scenario horizon · 90 days'}</b></div>
   <div className="scrub-track"><div className="scrub-pins">{pins.map((e,i)=><i key={i} title={e.label} style={{left:Math.min(100,Math.max(0,(Date.parse(e.t)-start)/(end-start)*100))+'%'}}/>)}</div><input aria-label="Replay position" disabled={!replay} type="range" min={start} max={end} step={60000} value={start+(end-start)*pct/100} style={{background:'linear-gradient(to right,#70e2ed '+pct+'%, #263d49 '+pct+'%)'}} onChange={e=>seek(+e.target.value)}/></div></div>
  <div className="timeline-end"><button className="quiet" onClick={()=>setEvents(!events)} disabled={!replay}><Flag size={14}/>Events</button><button className="quiet" onClick={()=>goBeat(beat>=8?1:Math.max(1,beat)+1)}>Next beat<ChevronRight size={15}/></button></div>
  {events&&replay&&<div className="event-list"><div className="section-heading"><h3>Replay events</h3><button onClick={()=>setEvents(false)}>Close</button></div>{sc.events.map((e,i)=><div key={i}><button onClick={()=>{seek(Date.parse(e.t));setEvents(false)}}><small>{fmtUtc(e.t)}</small><strong>{e.label}</strong></button><Prov kind={e.provenance} compact sourceIds={e.sourceIds}/></div>)}</div>}
 </footer>;
}

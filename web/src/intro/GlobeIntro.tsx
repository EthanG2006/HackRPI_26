import { useEffect, useRef, useState } from 'react';
import { ArrowRight, AudioLines, ChevronRight, Cloud, Play, Radar, VolumeX, Wind, Waves, Tornado } from 'lucide-react';
import CloudSky from '../ui/CloudSky';
import { goBeat, switchScenario } from '../presenter/beats';
import { useApp } from '../store';
import type { ScenarioId } from '../types';
import OrbitalGlobe from './OrbitalGlobe';
import './intro.css';

const cases = [
  {id:'helene', title:'Hurricane Helene', location:'North Carolina', year:'2024', icon:Wind},
  {id:'rocky-mount', title:'Rocky Mount tornado', location:'North Carolina', year:'2023', icon:Tornado},
  {id:'maria', title:'Hurricane Maria', location:'Puerto Rico', year:'2017', icon:Waves},
] as const;

export default function GlobeIntro() {
  const done=useApp(s=>s.introDone);
  const ready=useApp(s=>s.ready);
  const muted=useApp(s=>s.muted);
  const [leaving,setLeaving]=useState(false);
  const timer=useRef<ReturnType<typeof setTimeout> | null>(null);
  const seen=useRef(false);
  useEffect(()=>{
    if (done) { seen.current=true; setLeaving(false); }
    return ()=>{ if(timer.current) clearTimeout(timer.current); };
  },[done]);
  useEffect(()=>{
    if (done || !seen.current) return;
    const skip=(e:KeyboardEvent)=>{
      if(e.ctrlKey||e.metaKey||e.altKey||e.key.length!==1||/^[1-8rRnN ]$/.test(e.key))return;
      goBeat(2);
    };
    window.addEventListener('keydown',skip);
    return ()=>window.removeEventListener('keydown',skip);
  },[done]);
  if(done) return null;
  function begin(id:ScenarioId='helene') {
    if(leaving) return;
    setLeaving(true);
    timer.current=setTimeout(()=>{
      if(id==='helene') {goBeat(2);useApp.getState().set({time:Date.parse('2024-09-25T12:00:00Z'),speed:16});}
      else {switchScenario(id);useApp.getState().setPlaying(true);}
    },matchMedia('(prefers-reduced-motion: reduce)').matches?0:480);
  }
  return <section className={'rx-intro'+(leaving?' entering':'')} aria-label="Rx Radar introduction">
    <div className="orbital-stars" aria-hidden="true"/>
    <CloudSky variant="intro"/>
    <header className="intro-head">
      <div className="intro-brand"><span className="intro-brand-icon"><Radar size={28} strokeWidth={1.7}/></span><strong>Rx Radar</strong><span className="intro-brand-sep"/><span className="intro-head-label">Operations center</span></div>
      <span className="hack-badge"><Cloud size={14}/>HackRPI 2026 · In the Clouds</span>
      <button className="intro-audio" onClick={()=>useApp.getState().set({muted:!muted})}>{muted?<VolumeX size={16}/>:<AudioLines size={16}/>}<span>Sound {muted?'off':'on'}</span></button>
    </header>
    <div className="intro-main">
      <div className="orbital-stage">
        <div className="orbit-ring ring-a"/><div className="orbit-ring ring-b"/>
        <OrbitalGlobe/>
        <div className="earth-locator" aria-hidden="true"><i/><span>North Cove<span>Marion, NC</span></span></div>
      </div>
      <div className="intro-hero">
        <div className="intro-eyebrow"><span/> Pharmaceutical supply intelligence</div>
        <h1>Rx Radar<span>.</span></h1>
        <p>The sky already caused some of the worst drug shortages of the decade. <strong>Rx Radar reads the clouds before they reach the medicine cabinet.</strong></p>
        <div className="intro-cta-row"><button className="intro-begin" onClick={()=>begin()}><Play size={16} fill="currentColor"/> Watch Helene unfold <ArrowRight size={17}/></button><span className="intro-shortcut">or press <kbd>Space</kbd></span></div>
      </div>
    </div>
    <div className="intro-bottom">
      <div className="intro-archive-head"><span>Replay archive</span><span className="archive-line"/><span className="intro-ready"><i/> {ready?'Offline ready':'Loading archive'}</span></div>
      <div className="intro-cases">{cases.map(({id,title,year,location,icon:Icon})=><button key={id} onClick={()=>begin(id)}><span className="case-icon"><Icon size={23} strokeWidth={1.4}/></span><span className="case-descr"><strong>{title}</strong><small>{location} <b>·</b> {year}</small></span><ChevronRight className="case-arrow" size={16}/></button>)}</div>
    </div>
  </section>;
}

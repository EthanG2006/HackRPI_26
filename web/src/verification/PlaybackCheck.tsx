import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import { switchScenario, goBeat } from '../presenter/beats';
import { beginFrames, endFrames, frameSummary, recordFrame, workSummary } from './frameMetrics';

type Report = { scenario: string; valid: boolean; reason: string; target60fps: boolean; capturedAt: string;
  durationMs: number; work: ReturnType<typeof workSummary>; viewport: number[]; dpr: number; userAgent: string; layers: unknown;
  clockStart: number; clockEnd: number; frames: Record<string, ReturnType<typeof frameSummary>> };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const REPORT_KEY = 'rxradar.playback-check.v1';
export default function PlaybackCheck() {
  const [reports,setReports] = useState<Report[]>(() => { try { return JSON.parse(localStorage.getItem(REPORT_KEY) ?? '[]'); } catch { return []; } });
  const [status,setStatus] = useState('Keep this window in front during each 12-second capture.');
  const [running,setRunning] = useState(false), alive = useRef(true);
  const ready = useApp(s=>s.ready);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;endFrames();};},[]);
  async function measure(scenario: 'helene' | 'whatif') {
    setRunning(true); let raf=0, invalid=false;
    const lostFocus = () => { invalid = true; };
    try {
      if(scenario==='helene') {
        switchScenario('helene'); const s=useApp.getState();
        s.set({time:Date.parse('2024-09-25T12:00:00Z'), playing:true, speed:16});
      } else {
        goBeat(6);
        const start=performance.now();
        while(!useApp.getState().whatif.result || useApp.getState().whatif.running) {
          if(performance.now()-start>30000) throw Error('The storm did not finish computing.');
          await wait(100);
        }
        useApp.getState().setWhatIf({hour:0,labPlaying:true,field:'rain'});
      }
      setStatus('Warming up for 2 seconds.'); await wait(2000);
      invalid = document.hidden || !document.hasFocus();
      document.addEventListener('visibilitychange',lostFocus); window.addEventListener('blur',lostFocus);
      const state=useApp.getState(), clockStart=scenario==='helene'?state.time:state.whatif.hour??0;
      setStatus('Measuring 10 seconds. Keep this window visible and focused.');
      beginFrames(); const start=performance.now();
      const tick=(now:number)=>{recordFrame('raf',now);if(alive.current)raf=requestAnimationFrame(tick);};
      raf=requestAnimationFrame(tick); await wait(10000); cancelAnimationFrame(raf);
      const durationMs=performance.now()-start, samples=endFrames()??{};
      const after=useApp.getState(), clockEnd=scenario==='helene'?after.time:after.whatif.hour??0;
      const frames=Object.fromEntries(Object.entries(samples).map(([key,value])=>[key,frameSummary(value!,durationMs)]));
      const valid=!invalid && !document.hidden && document.hasFocus() && clockEnd>clockStart && (frames.map?.frames??0)>100;
      const result:Report={scenario,valid,reason:invalid?'Window lost focus or visibility':clockEnd<=clockStart?'Playback did not advance':valid?'Visible, focused playback advanced':'Insufficient rendered map frames',
        target60fps:valid && ['raf','map','effects'].every(key=>(frames[key]?.fps??0)>=55 && (frames[key]?.p95Ms??Infinity)<=25),
        capturedAt:new Date().toISOString(),durationMs:Math.round(durationMs),work:workSummary(),viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,
        userAgent:navigator.userAgent,layers:state.layers,clockStart,clockEnd,frames};
      if(alive.current) { setReports(old=>{const next=[result,...old].slice(0,8);localStorage.setItem(REPORT_KEY,JSON.stringify(next));return next;});setStatus(result.reason); }
    } catch(e) { if(alive.current)setStatus((e as Error).message); }
    finally { cancelAnimationFrame(raf);endFrames();document.removeEventListener('visibilitychange',lostFocus);window.removeEventListener('blur',lostFocus);useApp.getState().setPlaying(false);useApp.getState().setWhatIf({labPlaying:false});if(alive.current)setRunning(false); }
  }
  return <aside aria-label="Playback verification" style={{position:'fixed',left:16,top:150,zIndex:1000,width:390,background:'#10232c',padding:18,border:'1px solid #7fadaf',borderRadius:6,color:'#e7f0f1',fontSize:13}}>
    <b>Playback verification</b><p role="status" style={{margin:'12px 0'}}>{status}</p>
    <div style={{display:'flex',gap:12,marginBottom:12}}>{(['helene','whatif'] as const).map(s=><button disabled={running||!ready} key={s} onClick={()=>void measure(s)} style={{border:'1px solid #72989b',padding:8,cursor:'pointer'}}>Measure {s==='helene'?'Helene':'Storm Lab'}</button>)}</div>
    <button disabled={!reports.length||running} onClick={()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(reports,null,2)],{type:'application/json'}));a.download='rx-radar-playback.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}}>Download results</button>
    <p style={{margin:'10px 0'}}>60 fps target: at least 55 rendered fps with p95 at most 25 ms. Hidden or unfocused samples are invalid.</p>
    {reports.slice(0,2).map(r=><section key={r.capturedAt} style={{marginTop:12,borderTop:'1px solid #45616b',paddingTop:8}}><b>{r.scenario}: {!r.valid?'INVALID':r.target60fps?'PASS':'BELOW TARGET'}</b><p>{Object.entries(r.frames).map(([k,v])=>`${k}: ${v.fps} fps, p95 ${v.p95Ms} ms`).join(' / ')}</p><p>{Object.entries(r.work??{}).map(([k,v])=>`${k}: ${v.totalMs} ms total, max ${v.maxMs}`).join(' / ')}</p><small>{r.viewport.join(' x ')} / {r.capturedAt}</small></section>)}
  </aside>;
}

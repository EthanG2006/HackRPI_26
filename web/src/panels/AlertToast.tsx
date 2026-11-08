import {useEffect,useState} from 'react';
import {BellRing,X} from 'lucide-react';
import {useActiveScenario,useApp} from '../store';
import {fmtUtc,fmtPct} from '../lib/format';
import {Prov} from '../ui/Prov';

let audio: AudioContext | undefined;
function unlock() {
  try { audio ??= new AudioContext(); if(audio.state==='suspended') void audio.resume().catch(()=>{}); } catch { /* sound is optional */ }
}
function signal(){
 if(!audio||audio.state!=='running')return;
 const now=audio.currentTime;
 for(const [delay,frequency] of [[0,540],[0.21,720],[0.65,85]]){
   const osc=audio.createOscillator(), gain=audio.createGain(); osc.frequency.value=frequency;
   gain.gain.setValueAtTime(0.001,now+delay);gain.gain.exponentialRampToValueAtTime(0.045,now+delay+0.025);
   gain.gain.exponentialRampToValueAtTime(0.001,now+delay+0.32);osc.connect(gain);gain.connect(audio.destination);
   osc.start(now+delay);osc.stop(now+delay+.34);
 }
}
export default function AlertToast(){
 const fired=useApp(s=>s.alertFiredAt), sc=useActiveScenario(), [show,setShow]=useState(false);
 useEffect(()=>{window.addEventListener('pointerdown',unlock,{once:true});window.addEventListener('keydown',unlock,{once:true});return()=>{window.removeEventListener('pointerdown',unlock);window.removeEventListener('keydown',unlock)}},[]);
 useEffect(()=>{if(fired===null){setShow(false);return}setShow(true);if(!useApp.getState().muted)signal();const timer=setTimeout(()=>setShow(false),18000);return()=>clearTimeout(timer)},[fired]);
 if(!show||!sc?.alert)return null;
 return <aside className="alert-toast" role="status"><div className="alert-icon"><BellRing size={21}/></div><div><span className="eyebrow">Pharmacy director alert</span><h3>{sc.alert.message}</h3><p>Information cutoff · {fmtUtc(sc.alert.cutoff)}</p><div><b className="num">{fmtPct(sc.alert.prob)}</b> disruption risk　<Prov kind="MODEL"/></div></div><button className="icon-button" aria-label="Dismiss alert" onClick={()=>setShow(false)}><X size={14}/></button></aside>;
}

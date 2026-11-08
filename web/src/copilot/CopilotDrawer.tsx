import { useEffect, useRef, useState } from 'react';
import { ArrowUp, AudioLines, Mic, MicOff, Square, Volume2, VolumeX, X, MapPin, Check } from 'lucide-react';
import { useApp } from '../store';
import { Prov } from '../ui/Prov';
import { cachedAnswer, clinicalQuestion, copilotContext, executeTool, type ToolCall } from './actions';
import './copilot.css';

type ChatMessage={role:'user'|'assistant';text:string;sourceIds?:string[];tools?:string[];hospitals?:{id:string;name:string;day:number}[];mode?:string};
type Recognition={
 lang:string;interimResults:boolean;continuous:boolean;
 onresult:((e:{results:ArrayLike<ArrayLike<{transcript:string}>>})=>void)|null;
 onerror:((e:{error:string})=>void)|null;onend:(()=>void)|null;start:()=>void;stop:()=>void;abort:()=>void;
};
type SpeechWindow=Window&{SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition};
const suggestions=['Which children’s hospitals in the Southeast run out of IV fluids first?','Compare Market and fair allocation','Generate a briefing for Samaritan Hospital'];
const pause=(ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
 const onAbort=()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));};
 const timer=setTimeout(()=>{signal.removeEventListener('abort',onAbort);resolve();},ms);
 signal.addEventListener('abort',onAbort,{once:true});
});
export default function CopilotDrawer(){
 const open=useApp(s=>s.copilotOpen),ask=useApp(s=>s.copilotAsk),sources=useApp(s=>s.sources);
 const [messages,setMessages]=useState<ChatMessage[]>([]),[input,setInput]=useState(''),[busy,setBusy]=useState(false);
 const [listening,setListening]=useState(false),[voiceError,setVoiceError]=useState(''),[speak,setSpeak]=useState(false);
 const scroll=useRef<HTMLDivElement>(null),controller=useRef<AbortController|null>(null),recognition=useRef<Recognition|null>(null);
 const history=useRef(messages),speakRef=useRef(speak),lastAsk=useRef<number|null>(null);
 history.current=messages;speakRef.current=speak;
 const stop=()=>{controller.current?.abort();recognition.current?.abort();window.speechSynthesis?.cancel();setBusy(false);setListening(false);};
 useEffect(()=>()=>{controller.current?.abort();recognition.current?.abort();window.speechSynthesis?.cancel();},[]);
 useEffect(()=>{scroll.current?.scrollTo({top:scroll.current.scrollHeight,behavior:'smooth'});},[messages,busy]);
 function patch(patch:Partial<ChatMessage>){
  setMessages(ms=>ms.length?ms.map((m,i)=>i===ms.length-1?{...m,...patch}:m):ms);
 }
 async function submit(text:string){
  if(!text.trim())return;
  controller.current?.abort();
  const ctrl=new AbortController(); controller.current=ctrl;
  const previous=history.current.slice(-8),question=text.trim();
  const conversation=[...previous,{role:'user' as const,text:question},{role:'assistant' as const,text:'',tools:[]}];
  history.current=conversation;setMessages(conversation);setInput('');setBusy(true);setVoiceError('');
  let answer='',executed:string[]=[],fallback=true,mode='Cached analysis';
  const commandKeys=new Set<string>();
  const update=(p:Partial<ChatMessage>)=>{if(controller.current===ctrl&&!ctrl.signal.aborted)patch(p);};
  function append(text:string){answer+=text;update({text:answer});}
  const tools=(tool:ToolCall)=>{
   if(ctrl.signal.aborted)return;
   const key=JSON.stringify(tool);if(commandKeys.has(key))return;commandKeys.add(key);
   executed=[...executed,executeTool(tool)];update({tools:executed});
  };
  try{
   const api=useApp.getState().api;
   if(api.online&&api.anthropic&&!clinicalQuestion(question)){
    let firstTokenTimer:ReturnType<typeof setTimeout>|undefined;
    const network=new AbortController();
    try{
     firstTokenTimer=setTimeout(()=>network.abort(),850);
     const result=await fetch('/api/copilot',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.any([ctrl.signal,network.signal,AbortSignal.timeout(20000)]),
       body:JSON.stringify({messages:[...previous,{role:'user',text:question}].map(m=>({role:m.role,content:m.text||'Continue'})),context:copilotContext()})});
     if(!result.ok||!result.body)throw Error('Service unavailable');
     const reader=result.body.getReader(),decoder=new TextDecoder();let buffer='';
     while(true){
      const chunk=await reader.read();if(chunk.done)break;
      buffer+=decoder.decode(chunk.value,{stream:true});
      const events=buffer.split('\n\n');buffer=events.pop()??'';
      for(const event of events){
       const raw=event.split('\n').find(line=>line.startsWith('data: '));if(!raw)continue;
       const e=JSON.parse(raw.slice(6));
       if(e.type==='fallback')throw Error(e.reason);
       if(e.type==='mode'){mode='Live · '+e.model;update({mode});}
       if(e.type==='token'){clearTimeout(firstTokenTimer);append(e.text);fallback=false;}
       if(e.type==='tool')tools(e);
       if(e.type==='citations')update({sourceIds:e.sourceIds});
       if(e.type==='done')fallback=false;
      }
     }
    }catch(err){
     if(ctrl.signal.aborted)throw err;
     fallback=true;answer='';
    }finally{clearTimeout(firstTokenTimer);network.abort();}
   }
   if(fallback){
    const cached=cachedAnswer(question);mode='Cached analysis';
    update({text:'',mode,sourceIds:cached.sourceIds,hospitals:cached.hospitals,tools:executed});
    for(const tool of cached.tools)tools(tool);
    const chunks=cached.text.match(/.{1,32}(?:\s|$)|\S+/gs)??[cached.text];
    for(const chunk of chunks){if(ctrl.signal.aborted)break;append(chunk);await pause(14,ctrl.signal);}
   }
   if(!ctrl.signal.aborted&&speakRef.current&&'speechSynthesis' in window){
    const utterance=new SpeechSynthesisUtterance(answer);utterance.rate=1.05;window.speechSynthesis.speak(utterance);
   }
  }catch(err){
   if(!ctrl.signal.aborted)update({text:'The response could not complete. Try one of the cached demo questions below.',mode:'Cached analysis'});
  }finally{
   if(controller.current===ctrl){setBusy(false);controller.current=null;}
  }
 }
 useEffect(()=>{
  if(ask&&ask.at!==lastAsk.current){lastAsk.current=ask.at;useApp.setState({copilotOpen:true});void submit(ask.text);}
 },[ask]);
 function voice(){
  if(listening){recognition.current?.stop();return;}
  const WindowSpeech=window as SpeechWindow, Ctor=WindowSpeech.SpeechRecognition??WindowSpeech.webkitSpeechRecognition;
  if(!Ctor){setVoiceError('Speech input is unavailable in this browser. Type a question or use a demo prompt.');return;}
  try{
   const rec=new Ctor();recognition.current=rec;rec.lang='en-US';rec.interimResults=false;rec.continuous=false;
   rec.onresult=e=>{const text=e.results[0]?.[0]?.transcript;if(text){setInput(text);void submit(text);}};
   rec.onerror=e=>{setVoiceError(e.error==='not-allowed'?'Microphone access was declined. Type your question or use a demo prompt.':'Speech input could not connect. Type your question or use a demo prompt.');setListening(false);};
   rec.onend=()=>setListening(false);rec.start();setListening(true);setVoiceError('');
  }catch{setVoiceError('Microphone input is unavailable. Type your question or use a demo prompt.');}
 }
 if(!open)return null;
 return <aside className="copilot-rail" aria-label="Ask Rx Radar">
  <header className="lab-head"><div><span className="lab-eyebrow"><AudioLines size={13}/> Supply copilot</span><h2>Ask Rx Radar</h2></div><button className="lab-icon" aria-label="Close copilot" onClick={()=>{stop();useApp.setState({copilotOpen:false});}}><X size={18}/></button></header>
  <div className="copilot-intro"><span className="copilot-dot"/><span>{useApp.getState().api.anthropic?'Claude connected':'Offline answers ready'}</span><Prov kind="MODEL" compact/></div>
  <div className="copilot-messages" ref={scroll} role="log" aria-label="Copilot conversation">
   {!messages.length&&<div className="copilot-welcome"><AudioLines size={31}/><h3>Follow a question<br/>through the network.</h3><p>Ask about a drug, a region or a hospital. Your map follows the answer.</p></div>}
   {messages.map((m,i)=><article className={'copilot-message '+m.role} key={i}>
    <div className="copilot-message-label">{m.role==='user'?'You':m.mode??'Rx Radar'}{m.role==='assistant'&&<Prov kind="SIMULATED" compact/>}</div>
    <p>{m.text||<span className="copilot-thinking">Reading the supply network<span>…</span></span>}</p>
    {!!m.tools?.length&&<div className="copilot-tools">{m.tools.map((t,n)=><span key={n}><Check size={12}/>{t}</span>)}</div>}
    {!!m.hospitals?.length&&<div className="copilot-hospitals">{m.hospitals.map(h=><button key={h.id} onClick={()=>{useApp.getState().openHospital(h.id);useApp.setState({copilotOpen:false});}}><MapPin size={12}/><span>{h.name}</span><b className="num">D{h.day}</b></button>)}</div>}
    {!!m.sourceIds?.length&&<div className="copilot-sources">{m.sourceIds.map(id=>{const source=sources.find(s=>s.id===id);return source?<a key={id} href={source.url} target="_blank" rel="noreferrer">{source.name}</a>:null;})}<button onClick={()=>useApp.setState({page:'model-card'})}>Model assumptions</button></div>}
   </article>)}
  </div>
  <div className="copilot-bottom">
   <div className="copilot-prompts">{suggestions.map((q,i)=><button disabled={busy} key={q} onClick={()=>void submit(q)}>{i===0?'Children’s hospitals in the Southeast':i===1?'Market vs. fair allocation':'Samaritan CMO briefing'} ↗</button>)}</div>
   {voiceError&&<p className="copilot-error" role="status">{voiceError}</p>}
   <form onSubmit={e=>{e.preventDefault();void submit(input);}} className="copilot-form">
    <textarea aria-label="Ask a supply question" placeholder={listening?'Listening…':'Ask a supply question…'} value={input} rows={2} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void submit(input);}}}/>
    <div className="copilot-form-actions">
     <button type="button" className={listening?'listening':''} onClick={voice} aria-label={listening?'Stop listening':'Use microphone'} title={listening?'Stop listening':'Use microphone'}>{listening?<MicOff size={17}/>:<Mic size={17}/>}</button>
     <button type="button" onClick={()=>{setSpeak(!speak);if(speak)window.speechSynthesis?.cancel();}} aria-label={speak?'Disable spoken answers':'Enable spoken answers'} title="Spoken answers">{speak?<Volume2 size={17}/>:<VolumeX size={17}/>}</button>
     <span>{listening?'Listening':'Aggregate planning only'}</span>
     {busy?<button type="button" aria-label="Stop answer" onClick={stop}><Square size={15}/></button>:<button type="submit" className="copilot-send" aria-label="Send question" disabled={!input.trim()}><ArrowUp size={17}/></button>}
    </div>
   </form>
  </div>
 </aside>;
}

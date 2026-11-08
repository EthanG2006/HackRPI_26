import {useEffect,useRef} from 'react';
import {Command} from 'cmdk';
import {Search} from 'lucide-react';
import {useApp} from '../store';
import {beats,goBeat,switchScenario} from './beats';
import {scenes} from '../panels/TopBar';
import {pageNames} from '../pages/PageModal';
export default function CommandPalette(){
 const open=useApp(s=>s.paletteOpen), hospitals=useApp(s=>s.hospitals), ref=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(open)ref.current?.focus()},[open]);
 if(!open)return null;
 const s=useApp.getState(), act=(f:()=>void)=>{s.set({paletteOpen:false});f()};
 return <div className="modal-back palette-back" onMouseDown={e=>{if(e.target===e.currentTarget)s.set({paletteOpen:false})}}>
 <Command label="Command menu" className="palette"><div className="palette-input"><Search size={20}/><Command.Input ref={ref} placeholder="Find a beat, hospital, scenario or page…" autoFocus/><kbd>ESC</kbd></div><Command.List>
 <Command.Empty>No matching commands</Command.Empty>
 <Command.Group heading="Presenter beats">{beats.map(([title],i)=><Command.Item key={title} onSelect={()=>act(()=>goBeat(i+1))}>{title}<kbd>{i+1}</kbd></Command.Item>)}</Command.Group>
 <Command.Group heading="Scenarios">{scenes.map(([id,title])=><Command.Item key={id} value={'scenario '+title} onSelect={()=>act(()=>switchScenario(id))}>{title}</Command.Item>)}</Command.Group>
 <Command.Group heading="Workspace">{Object.entries(pageNames).map(([id,title])=><Command.Item key={id} onSelect={()=>act(()=>s.set({introDone:true,page:id as keyof typeof pageNames}))}>{title}</Command.Item>)}<Command.Item onSelect={()=>act(()=>s.set({introDone:true,copilotOpen:true}))}>Ask Rx Radar</Command.Item></Command.Group>
 <Command.Group heading="Capital Region">{hospitals.filter(h=>/samaritan hospital|albany medical center/i.test(h.name)&&h.state==='NY').map(h=><Command.Item key={h.id} onSelect={()=>act(()=>{s.set({introDone:true,equityOpen:false});s.openHospital(h.id)})}>{h.name} · {h.city}</Command.Item>)}</Command.Group>
 </Command.List></Command></div>
}

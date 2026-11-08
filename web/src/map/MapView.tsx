import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as LibreMap, type StyleSpecification } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { Layer } from '@deck.gl/core';
import { windLayer, networkMotion, motionTime } from './motion';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import { Minus, Plus, LocateFixed, Navigation, Maximize2, X } from 'lucide-react';
import { activeScenario, useApp } from '../store';
import { buildLayers, type GeoCollection, type Picked } from './layers';
import { paintMapEffects } from './effects';
import { frameAt, latest } from './geometry';
import { stormState } from './storm';
import { smoothTime } from '../lib/clock';
import { Prov } from '../ui/Prov';
import type { LngLat } from '../types';
import './map.css';

declare global {interface Window {rxMapSnapshot?:()=>string|undefined}}
const STYLE:StyleSpecification={
  version:8,sources:{
    land:{type:'geojson',data:'/basemap/land.json'},
    states:{type:'geojson',data:'/basemap/states.json'},
  },
  layers:[
    {id:'ocean',type:'background',paint:{'background-color':'#091a27'}},
    {id:'land',source:'land',type:'fill',paint:{'fill-color':'#172b32'}},
    {id:'coast-halo',source:'land',type:'line',paint:{'line-color':'#438398','line-width':3,'line-opacity':.13}},
    {id:'coast',source:'land',type:'line',paint:{'line-color':'#4b7180','line-width':.8,'line-opacity':.65}},
    {id:'state-lines',source:'states',type:'line',paint:{'line-color':'#50636d','line-width':.7,'line-opacity':.55}},
  ]
};
export default function MapView(){
  const host=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),mapRef=useRef<LibreMap|null>(null);
  const overlay=useRef<MapboxOverlay|null>(null),counties=useRef<GeoCollection|null>(null),refresh=useRef<()=>void>(()=>{});
  const [tip,setTip]=useState<(Picked&{x:number;y:number})|null>(null),[error,setError]=useState(false);
  const scenarioId=useApp(s=>s.scenarioId),time=useApp(s=>s.time),drawing=useApp(s=>s.whatif.drawing);
  const storm=useApp(s=>s.storms[s.scenarioId]),shownLayers=useApp(s=>s.layers),highlight=useApp(s=>s.highlight);
  const equityOpen=useApp(s=>s.equityOpen),policy=useApp(s=>s.policy),abmDay=useApp(s=>s.abmDay);
  const camera=useApp(s=>s.camera),introDone=useApp(s=>s.introDone),ready=useApp(s=>s.ready);
  const live=useApp(s=>s.live);
  function fittedZoom(zoom:number){
    return zoom-Math.max(0,Math.log2(760/Math.max(280,host.current?.clientHeight??760)));
  }
  useEffect(()=>{
    if(!host.current) return;
    let frame=0,alive=true,last=0;
    let staticLayers:Layer[]=[],wind:ReturnType<typeof windLayer>|null=null,flow:ReturnType<typeof networkMotion>=null,windKey='';
    const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const map=new maplibregl.Map({container:host.current,style:STYLE,center:[-83,31],zoom:4.3,
      minZoom:2.1,maxZoom:11,pitch:0,maxPitch:50,attributionControl:false,
      canvasContextAttributes:{antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'},dragRotate:false,touchPitch:false});
    mapRef.current=map;
    if(import.meta.env.DEV)Object.assign(window,{rxMap:map});
    const deck=new MapboxOverlay({interleaved:true,layers:[],getCursor:()=>useApp.getState().whatif.drawing?'crosshair':'grab'});
    overlay.current=deck;map.addControl(deck);
    const onHover=(item:Picked|null,x:number,y:number)=>{if(!useApp.getState().whatif.drawing)setTip(item?{...item,x,y}:null)};
    refresh.current=()=>{
      if(!alive||!map.isStyleLoaded())return;
      const s=useApp.getState();
      staticLayers=buildLayers(s,map.getZoom(),counties.current,onHover);
      // Rebuild particles only when the storm's structure changes; position moves per frame below.
      const st=s.layers.wind?stormState(s,smoothTime()):null;
      const key=st?[s.scenarioId,Math.round(st.vmax/5),Math.round(st.rmwKm/4),Math.round(st.pressure/4),Math.round(st.lat)].join('|'):'';
      if(key!==windKey){windKey=key;wind=st?windLayer(st):null;}
      flow=networkMotion(s,map.getZoom());
      deck.setProps({layers:[...staticLayers,wind,flow]});
    };
    map.on('load',()=>{
      refresh.current();
      const s=useApp.getState(),c=s.camera??activeScenario(s)?.camera;
      if(c){map.jumpTo({center:[c.longitude,c.latitude],zoom:fittedZoom(c.zoom),pitch:0,bearing:0});s.set({camera:null});}
    });
    map.on('zoomend',()=>refresh.current());
    map.on('error',e=>{console.warn('[rx-map]',e.error.message);if(!map.isStyleLoaded())setError(true)});
    const unsubscribe=useApp.subscribe((s,old)=>{
      if(s.time!==old.time||s.layers!==old.layers||s.hospitals!==old.hospitals||s.scenarios!==old.scenarios||s.whatif!==old.whatif||
        s.policy!==old.policy||s.lambda!==old.lambda||s.abmDay!==old.abmDay||s.equityOpen!==old.equityOpen||
        s.selectedDrugId!==old.selectedDrugId||s.selectedHospitalId!==old.selectedHospitalId||s.highlight!==old.highlight||s.scenarioId!==old.scenarioId||s.live!==old.live)refresh.current();
    });
    fetch('/basemap/counties.json').then(r=>r.json()).then((topology:Topology)=>{
      if(!alive)return;counties.current=feature(topology,topology.objects.counties) as GeoCollection;refresh.current();
    }).catch(()=>{});
    const resize=()=>{map.resize();if(canvas.current){
      const ratio=Math.min(2,devicePixelRatio),w=host.current!.clientWidth,h=host.current!.clientHeight;
      canvas.current.width=Math.round(w*ratio);canvas.current.height=Math.round(h*ratio);
      canvas.current.getContext('2d')?.setTransform(ratio,0,0,ratio,0,0);
    }};
    const observer=new ResizeObserver(resize);observer.observe(host.current);resize();
    const draw=(now:number)=>{
      const ctx=canvas.current?.getContext('2d'),s=useApp.getState();
      if(ctx&&s.introDone&&!document.hidden&&now-last>=16){
        const t=reducedMotion?60:motionTime(now);
        if(wind||flow){
          const st=wind?stormState(s,smoothTime()):null;
          deck.setProps({layers:[...staticLayers,wind&&st?wind.clone({currentTime:t,coordinateOrigin:[st.lon,st.lat,0]}):null,flow?.clone({currentTime:t})]});
        }
        paintMapEffects(ctx,map,s,reducedMotion?1000:now,host.current!.clientWidth,host.current!.clientHeight);last=now;
      }
      frame=requestAnimationFrame(draw);
    };
    frame=requestAnimationFrame(draw);
    window.rxMapSnapshot=()=>{
      if(!canvas.current)return;
      const base=map.getCanvas(),copy=document.createElement('canvas');
      copy.width=base.width;copy.height=base.height;
      const ctx=copy.getContext('2d');if(!ctx)return;
      try{ctx.drawImage(base,0,0);ctx.drawImage(canvas.current,0,0,copy.width,copy.height);return copy.toDataURL('image/png');}catch{return;}
    };
    return()=>{alive=false;unsubscribe();observer.disconnect();cancelAnimationFrame(frame);delete window.rxMapSnapshot;map.remove();mapRef.current=null;};
  },[]);
  useEffect(()=>{
    const map=mapRef.current;if(!camera||!map?.isStyleLoaded())return;
    map.flyTo({center:[camera.longitude,camera.latitude],zoom:fittedZoom(camera.zoom),pitch:0,bearing:0,
      duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:camera.duration??1500,essential:true});
    useApp.getState().set({camera:null});setTip(null);
  },[camera]);
  useEffect(()=>{
    const map=mapRef.current;if(!map)return;
    if(drawing){map.dragPan.disable();map.doubleClickZoom.disable();map.getCanvas().style.cursor='crosshair';}
    else{map.dragPan.enable();map.doubleClickZoom.enable();map.getCanvas().style.cursor='';}
    setTip(null);
    const element=map.getCanvasContainer();
    let dragging=false,last:[number,number]|null=null,track:LngLat[]=[];
    const append=(x:number,y:number)=>{
      if(last&&Math.hypot(last[0]-x,last[1]-y)<14)return;
      last=[x,y];const p=map.unproject([x,y]);track.push([p.lng,p.lat]);
      useApp.getState().setWhatIf({track:[...track],result:null});
    };
    const down=(e:PointerEvent)=>{
      if(!useApp.getState().whatif.drawing||e.button!==0)return;
      e.preventDefault();e.stopPropagation();element.setPointerCapture(e.pointerId);
      dragging=true;last=null;track=[...useApp.getState().whatif.track];
      const rect=element.getBoundingClientRect();append(e.clientX-rect.left,e.clientY-rect.top);
    };
    const move=(e:PointerEvent)=>{if(!dragging)return;const rect=element.getBoundingClientRect();if(track.length<64)append(e.clientX-rect.left,e.clientY-rect.top);};
    const up=()=>{dragging=false;};
    element.addEventListener('pointerdown',down,true);element.addEventListener('pointermove',move,true);element.addEventListener('pointerup',up,true);element.addEventListener('pointercancel',up,true);
    return()=>{element.removeEventListener('pointerdown',down,true);element.removeEventListener('pointermove',move,true);element.removeEventListener('pointerup',up,true);element.removeEventListener('pointercancel',up,true);};
  },[drawing]);
  // Storm Lab: drag any track point to reshape the storm (presets keep their observed record at that point).
  useEffect(()=>{
    const map=mapRef.current;if(!map||scenarioId!=='whatif')return;
    const el=map.getCanvasContainer();let idx=-1,raf=0,pending:LngLat|null=null;
    const near=(x:number,y:number)=>{let best=-1,bd=12;useApp.getState().whatif.track.forEach((p,i)=>{const q=map.project(p);const d=Math.hypot(q.x-x,q.y-y);if(d<bd){bd=d;best=i;}});return best;};
    const local=(e:PointerEvent)=>{const r=el.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top] as const;};
    const down=(e:PointerEvent)=>{
      if(useApp.getState().whatif.drawing||e.button!==0)return;
      const i=near(...local(e));if(i<0)return;
      e.preventDefault();e.stopImmediatePropagation();idx=i;map.dragPan.disable();setTip(null);
      try{el.setPointerCapture(e.pointerId);}catch{/* pointer already released */}
    };
    const apply=()=>{
      if(!pending||idx<0)return;
      const w=useApp.getState().whatif,p=pending,i=idx,track=w.track.slice();track[i]=p;pending=null;
      useApp.getState().setWhatIf({track,fixes:w.fixes?w.fixes.map((f,k)=>k===i?{...f,lon:p[0],lat:p[1]}:f):null});
    };
    const move=(e:PointerEvent)=>{
      if(idx<0){if(!useApp.getState().whatif.drawing)map.getCanvas().style.cursor=near(...local(e))>=0?'grab':'';return;}
      const ll=map.unproject([...local(e)]);pending=[ll.lng,ll.lat];
      raf||=requestAnimationFrame(()=>{raf=0;apply();});
    };
    // Flush on release so a quick drag never loses its final position.
    const up=()=>{if(idx>=0){apply();idx=-1;map.dragPan.enable();map.getCanvas().style.cursor='';}};
    el.addEventListener('pointerdown',down,true);el.addEventListener('pointermove',move,true);el.addEventListener('pointerup',up,true);el.addEventListener('pointercancel',up,true);
    return()=>{el.removeEventListener('pointerdown',down,true);el.removeEventListener('pointermove',move,true);el.removeEventListener('pointerup',up,true);el.removeEventListener('pointercancel',up,true);cancelAnimationFrame(raf);map.dragPan.enable();};
  },[scenarioId]);
  const advisory=latest(storm?.storm?.advisories,a=>a.issued,time);
  const radar=frameAt(storm?.radar?.frames,time,7),satellite=frameAt(storm?.satellite?.frames,time,40);
  const clock=(t:string)=>new Date(t).toLocaleString('en-US',{month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'UTC'})+' UTC';
  function fit(){const s=useApp.getState();s.flyTo(activeScenario(s)?.camera??{longitude:-83,latitude:31,zoom:4.3,duration:1000});}
  return <section className="rx-map" aria-label="Interactive weather and pharmaceutical supply map">
    <div id="rx-map-canvas" ref={host} className="map-surface"/>
    <canvas ref={canvas} className="map-effects" aria-hidden="true"/>
    {introDone&&<>
      <div className="map-top-status">
        {scenarioId==='whatif'?<><span className="status-dot"/>Storm sandbox<Prov kind="MODEL"/></>:
          scenarioId==='live'?<><span className="status-dot"/>{live?.fromCache?'Cached weather snapshot':'Live weather'}<Prov kind="REAL"/></>:
          <><span className="status-dot"/>{storm?.storm?.name??'Rocky Mount'} {advisory?'· Advisory '+advisory.num:'· Historical replay'}<Prov kind="REPLAY"/></>}
      </div>
      <div className="map-controls">
        <button aria-label="Zoom in" onClick={()=>mapRef.current?.zoomIn()}><Plus size={17}/></button>
        <button aria-label="Zoom out" onClick={()=>mapRef.current?.zoomOut()}><Minus size={17}/></button>
        <button aria-label="Fit scenario to map" onClick={fit}><LocateFixed size={17}/></button>
        <span title="North up"><Navigation size={14}/><small>N</small></span>
      </div>
      {drawing&&<div className="drawing-hint"><span className="status-dot"/>Click points or drag to draw a storm track.<button onClick={()=>useApp.getState().setWhatIf({drawing:false})}>Finish drawing</button></div>}
      {highlight&&<div className="highlight-banner"><span>{highlight.label}</span><button onClick={()=>useApp.getState().clearHighlight()} aria-label="Clear highlighted hospitals"><X size={14}/></button></div>}
      {tip&&<div className="map-tooltip" style={{left:Math.min(tip.x+18,(host.current?.clientWidth??800)-240),top:Math.max(62,tip.y-70)}}><b>{tip.name}</b>{tip.detail&&<span>{tip.detail}</span>}<small>{tip.kind==='hospital'?'Click for inventory and actions':tip.kind==='plant'?'Click for manufacturing exposure':'USGS river observation'}</small><Prov kind={tip.provenance}/></div>}
      {scenarioId!=='whatif'&&<div className="map-bottom-left"><div className="stockout-legend"><span>{equityOpen?`Day ${abmDay} · ${policy==='rxradar'?'Fair allocation':policy}`:'Projected days to stockout'}</span><Prov kind="MODEL"/><div className="legend-swatches"><i/><span>60+</span><i/><span>30</span><i/><span>14</span><i/><span>7</span><i/><span>≤3</span></div></div>
        <div className="map-data-stamp">{advisory&&shownLayers.storm?<span>Forecast issued {clock(advisory.issued)}{radar&&shownLayers.radar?` · radar ${clock(radar.t).slice(-9)}`:''}</span>:satellite&&shownLayers.satellite?<span>Terra daily composite · {new Date(Date.parse(satellite.t)-86400000).toISOString().slice(0,10)}</span>:null}</div>
      </div>}
      <div className="map-attribution"><button onClick={()=>useApp.getState().set({page:'sources'})}>Natural Earth · U.S. Census · NOAA</button><span>Local basemap</span><span>Routes &amp; transit buffers · SIMULATED</span></div>
      {error&&<div className="map-load-note">Map graphics unavailable. Reload this view to retry.</div>}
      {!ready&&<div className="map-load-note">Loading the replay archive…</div>}
    </>}
  </section>;
}


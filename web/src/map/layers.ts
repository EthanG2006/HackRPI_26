import { ArcLayer, BitmapLayer, GeoJsonLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { activeScenario, useApp, type AppState } from '../store';
import { hospitalDays } from '../lib/selectors';
import { daysToRisk, riskColor } from '../lib/colors';
import { frameAt, latest, polys } from './geometry';
import { labFieldLayers, labTrackLayers } from './labLayers';
import { stormState } from './storm';
import type { Advisory, Hospital, LngLat, MultiPolygonCoords, Plant, PolygonCoords } from '../types';

type Color=[number,number,number,number];
export type GeoCollection=FeatureCollection;
export interface Flow {from:LngLat;to:LngLat;plantId:string;risk:number;id:number;stage:'upstream'|'downstream'}
export interface Picked {kind:'hospital'|'plant'|'gauge';id:string;name:string;detail:string;provenance:'REAL'|'REPLAY'|'MODEL'|'SIMULATED'}
const CYAN:Color=[85,220,244,255];
const derived = new WeakMap<object, unknown>();
function memoData<T>(key: object, build: () => T): T {
  if (!derived.has(key)) derived.set(key, build());
  return derived.get(key) as T;
}
const polygonFeature=(p:PolygonCoords|MultiPolygonCoords,properties:Record<string,unknown>={}):Feature=>memoData(p,()=>({
  type:'Feature',properties,geometry:{type:'MultiPolygon',coordinates:polys(p)}
}));

export function plantRisk(s:AppState,id:string):number{
  const sc=activeScenario(s);
  if(s.scenarioId==='whatif'||s.scenarioId==='live') return sc?.outages.find(x=>x.plantId===id)?.pDisrupt??0;
  return latest(sc?.hazard.filter(h=>h.plantId===id),h=>h.t,s.time)?.p??0;
}
let routeKey='',routeCache:Omit<Flow,'risk'>[]=[],flowRiskKey='',flowResult:Flow[]=[];
let routeNetwork:AppState['network'],routeHospitals:Hospital[],routePlants:Plant[];
let coneShown:Advisory|undefined,conePrev:Advisory|undefined,coneSwitchAt=0;
export function supplyFlows(s:AppState,zoom=5):Flow[] {
  const sc=activeScenario(s),heroes=sc?.heroPlantIds??[];
  const maxRoutes=zoom<4.5?12:zoom<6?24:45;
  // Route geometry depends only on the network and zoom band; risk is re-applied each call (cheap).
  const key=[heroes.join(','),maxRoutes,s.network?.flows.length,s.hospitals.length,s.plants.length,s.distributors.length].join('|');
  if(key!==routeKey||s.network!==routeNetwork||s.hospitals!==routeHospitals||s.plants!==routePlants){
    routeNetwork=s.network;routeHospitals=s.hospitals;routePlants=s.plants;flowRiskKey='';
    routeKey=key;routeCache=[];
    for(const f of s.network?.flows??[]){
      const plant=s.plants.find(p=>p.id===f.plantId),dc=s.distributors.find(d=>d.id===f.dcId);
      if(!plant||!dc||!heroes.includes(plant.id))continue;
      routeCache.push({from:[plant.lon,plant.lat],to:[dc.lon,dc.lat],plantId:plant.id,id:routeCache.length,stage:'upstream'});
      const targets=s.hospitals.filter(h=>Math.hypot(h.lon-dc.lon,h.lat-dc.lat)<13);
      for(let i=0;i<targets.length;i+=Math.max(1,Math.floor(targets.length/maxRoutes))){
        const h=targets[i];routeCache.push({from:[dc.lon,dc.lat],to:[h.lon,h.lat],plantId:plant.id,id:routeCache.length,stage:'downstream'});
      }
    }
  }
  const risk=new Map(heroes.map(id=>[id,plantRisk(s,id)]));
  const rk=routeKey+'|'+heroes.map(id=>risk.get(id)).join(',');
  if(rk!==flowRiskKey){flowRiskKey=rk;flowResult=routeCache.map(f=>({...f,risk:risk.get(f.plantId)??0}));}
  return flowResult;
}
export function buildLayers(s:AppState,zoom:number,counties:GeoCollection|null,onHover:(x:Picked|null,px:number,py:number)=>void):Layer[]{
  const out:Layer[]=[],weather=s.storms[s.scenarioId],sc=activeScenario(s),layers=s.layers;
  const selected=new Set([...(s.highlight?.ids??[]),s.selectedHospitalId??'']);
  const pick=(kind:Picked['kind'],object:Hospital|Plant|{siteId:string;name:string},x:number,y:number)=>{
    if(!object)return onHover(null,x,y);
    const h=object as Hospital;
    const index=kind==='hospital'?s.hospitalIndex.get(h.id):undefined;
    const days=index!==undefined?hospitalDays(s)?.[index]:undefined;
    const inventory=days===undefined?'':days>=999?' · Covered for 90 days':' · '+Math.round(days)+' days to stockout';
    onHover({kind,id:'id'in object?object.id:object.siteId,name:object.name,detail:kind==='hospital'?[h.city,h.state].join(', ')+inventory:'',provenance:kind==='hospital'?'MODEL':kind==='plant'?(object as Plant).provenance:'REAL'},x,y);
  };
  if(counties&&(layers.svi||layers.nri))out.push(new GeoJsonLayer({
    id:'county-vulnerability',data:counties,stroked:zoom>6,filled:true,lineWidthMinPixels:.4,getLineColor:[40,70,82,75],
    getFillColor:(f:Feature)=>{
      const attr=s.counties?.counties[String(f.id).padStart(5,'0')];
      if(!attr)return [0,0,0,0];
      const v=layers.nri?Math.max(attr.nriHurricane??0,attr.nriRiverine??0)/100:attr.svi;
      return layers.nri?riskColor(v,90):[31+v*35,83+v*45,98+v*48,80+v*55];
    }
  }));
  out.push(...labFieldLayers(s));
  for(const [kind,maxAge]of [['satellite',40],['radar',7]] as const){
    const frames=weather?.[kind]?.frames,a=frameAt(frames,s.time,maxAge);
    if(!layers[kind]||!a||!frames)continue;
    // Crossfade toward the next frame; ids follow frame times so textures are reused across the swap.
    const ta=Date.parse(a.t),b=frames.find(f=>Date.parse(f.t)>ta),tb=b?Date.parse(b.t):0;
    // Calmer than raw NEXRAD colours: lower opacity and partial desaturation keep the storm readable, not loud.
    const u=b&&tb-ta<=maxAge*3600000?Math.max(0,Math.min(1,(s.time-ta)/(tb-ta))):0,base=kind==='radar'?.26:.4,desaturate=kind==='radar'?.35:0;
    const url=(f:{url:string})=>f.url.startsWith('/')?f.url:'/'+f.url;
    out.push(new BitmapLayer({id:kind+'-'+a.t,image:url(a),bounds:a.bounds,opacity:base*(1-u),desaturate}));
    if(b&&u>.02)out.push(new BitmapLayer({id:kind+'-'+b.t,image:url(b),bounds:b.bounds,opacity:base*u,desaturate}));
  }
  if(layers.rain){
    const outlook=latest(weather?.rainfall,r=>r.issued,s.time);
    if(outlook&&s.time<=Date.parse(outlook.validEnd))out.push(new GeoJsonLayer({id:'rain-outlook',data:memoData(outlook.areas,()=>outlook.areas.map(a=>polygonFeature(a.polygon,{category:a.category}))),
      filled:true,stroked:true,lineWidthMinPixels:1.3,
      getFillColor:(f:Feature)=>f.properties?.category==='HIGH'?[248,94,45,49]:f.properties?.category==='MDT'?[240,177,46,26]:[61,216,188,15],
      getLineColor:(f:Feature)=>f.properties?.category==='HIGH'?[255,140,88,210]:f.properties?.category==='MDT'?[240,177,64,160]:[74,162,131,80]}));
  }
  if(layers.flood) for(const zone of weather?.floodZones??[]) if(zone.polygons?.length) out.push(new GeoJsonLayer({id:'flood-'+zone.plantId,data:memoData(zone.polygons,()=>zone.polygons!.map(p=>polygonFeature(p))),filled:true,stroked:true,getFillColor:[55,189,229,65],getLineColor:[83,217,240,150],lineWidthMinPixels:1}));
  if(layers.tornado){
    const spc=latest(weather?.spc,r=>r.issued,s.time);
    if(spc)out.push(new GeoJsonLayer({id:'spc',data:memoData(spc.areas,()=>spc.areas.map(a=>polygonFeature(a.polygon))),getFillColor:[217,161,61,30],getLineColor:[217,161,61,160],lineWidthMinPixels:1}));
    if(weather?.tornado&&Date.parse(weather.tornado.t)<=s.time)out.push(new PathLayer({id:'tornado-damage-track',data:[weather.tornado.path],getPath:p=>p,getColor:[255,126,93,255],getWidth:weather.tornado.widthYd??600,widthMinPixels:7}));
  }
  if(s.scenarioId==='live'){
    if(layers.storm)out.push(new GeoJsonLayer({id:'live-storm-cones',data:s.live?.activeStorms.filter(x=>x.cone).map(x=>polygonFeature(x.cone!))??[],getFillColor:[58,200,232,40],getLineColor:CYAN,lineWidthMinPixels:1}));
    out.push(new GeoJsonLayer({id:'live-alerts',data:s.live?.alerts.filter(a=>a.polygon).map(a=>polygonFeature(a.polygon!))??[],getFillColor:[232,169,42,22],getLineColor:[232,169,42,180],lineWidthMinPixels:1}));
  }
  const advisory=latest(weather?.storm?.advisories,a=>a.issued,s.time);
  if(layers.storm&&advisory){
    // Crossfade from the previous advisory's cone while playing, instead of swapping it instantly.
    if(coneShown?.num!==advisory.num){conePrev=coneShown;coneShown=advisory;coneSwitchAt=performance.now();}
    const k=s.playing?Math.min(1,(performance.now()-coneSwitchAt)/900):1;
    if(conePrev?.cone&&k<1)out.push(new GeoJsonLayer({id:'forecast-cone-prev',data:polygonFeature(conePrev.cone),filled:true,stroked:true,opacity:1-k,getFillColor:[74,211,238,33],getLineColor:[119,232,250,155],lineWidthMinPixels:1.2}));
    if(advisory.cone)out.push(new GeoJsonLayer({id:'forecast-cone',data:polygonFeature(advisory.cone),filled:true,stroked:true,opacity:k,getFillColor:[74,211,238,33],getLineColor:[119,232,250,155],lineWidthMinPixels:1.2}));
    out.push(new PathLayer({id:'forecast-track',data:memoData(advisory.forecast,()=>[advisory.forecast.map(p=>[p.lon,p.lat] as LngLat)]),getPath:x=>x,getWidth:1.5,widthUnits:'pixels',getColor:[157,240,250,190]}));
    out.push(new ScatterplotLayer({id:'forecast-positions',data:advisory.forecast,getPosition:p=>[p.lon,p.lat],getRadius:2,radiusUnits:'pixels',getFillColor:CYAN}));
    const track=(weather?.storm?.bestTrack.filter(p=>Date.parse(p.t)<=s.time)??[]).map(p=>[p.lon,p.lat] as LngLat);
    const now=stormState(s,s.time);
    if(now&&track.length)track.push([now.lon,now.lat]); // grow continuously, not in 6-hour jumps
    out.push(new PathLayer({id:'observed-track',data:[track],getPath:x=>x,getWidth:3,widthUnits:'pixels',getColor:CYAN,jointRounded:true,capRounded:true}));
  }
  out.push(...labTrackLayers(s));
  if(layers.network){
    out.push(new ArcLayer({id:'supply-arcs',data:supplyFlows(s,zoom),getSourcePosition:f=>f.from,getTargetPosition:f=>f.to,
      getSourceColor:f=>riskColor(f.risk,110),getTargetColor:f=>riskColor(f.risk,30),getWidth:1.05,widthUnits:'pixels',getHeight:.15}));
    out.push(new ScatterplotLayer({id:'distribution-hubs',data:s.distributors,getPosition:p=>[p.lon,p.lat],getRadius:3,radiusUnits:'pixels',getFillColor:[130,160,173,255],stroked:true,getLineColor:[209,230,233,170],getLineWidth:1,lineWidthUnits:'pixels'}));
  }
  const days=hospitalDays(s);
  if(layers.hospitals)out.push(new ScatterplotLayer<Hospital>({
    id:'hospitals',data:s.hospitals,pickable:!s.whatif.drawing,getPosition:h=>[h.lon,h.lat],
    getRadius:h=>selected.has(h.id)?6:zoom<3.8?1:zoom<4.5?1.4:zoom<5.5?1.9:zoom<7?2.8:4,radiusUnits:'pixels',stroked:zoom>=5.5,getLineWidth:.5,lineWidthUnits:'pixels',
    getLineColor:h=>selected.has(h.id)?[220,255,255,255]:[2,15,23,100],
    getFillColor:(_h,{index})=>{
      const d=days?.[index]??999,risk=s.equityOpen?(d<=s.abmDay?.99:d<999?.35:.04):daysToRisk(d);
      // Prominence follows risk: calm hospitals recede, the ones running out stand forward.
      const alpha=selected.size>1&&!selected.has(_h.id)?45:Math.round(70+170*risk);
      return riskColor(risk,s.scenarioId==='whatif'&&risk<.1?40:alpha);
    },
    onHover:info=>pick('hospital',info.object,info.x,info.y),
    onClick:info=>{if(info.object)useApp.getState().openHospital(info.object.id);},
    transitions:{getFillColor:{duration:900,easing:(t:number)=>t*t*(3-2*t)},getRadius:400},
    updateTriggers:{getFillColor:[days,s.equityOpen,s.abmDay,s.highlight,s.selectedHospitalId],getRadius:[zoom,s.highlight,s.selectedHospitalId],getLineColor:[s.selectedHospitalId,s.highlight]}
  }));
  if(layers.plants)out.push(new ScatterplotLayer<Plant>({
    id:'plants',data:s.plants,pickable:!s.whatif.drawing,getPosition:p=>[p.lon,p.lat],getRadius:p=>sc?.heroPlantIds.includes(p.id)?7:4.5,radiusUnits:'pixels',
    stroked:true,getFillColor:p=>riskColor(plantRisk(s,p.id)),getLineColor:[222,238,236,240],getLineWidth:1.5,lineWidthUnits:'pixels',
    onHover:info=>pick('plant',info.object,info.x,info.y),onClick:info=>{if(info.object)useApp.getState().set({selectedPlantId:info.object.id,rightPanel:s.scenarioId==='whatif'?'whatif':'drugs'});},
    transitions:{getFillColor:700},
    updateTriggers:{getFillColor:[s.time,s.scenarioId,s.whatif.result]}
  }));
  if(layers.gauges)out.push(new ScatterplotLayer({id:'river-gauges',data:weather?.gauges??[],pickable:true,getPosition:g=>[g.lon,g.lat],getRadius:3.5,radiusUnits:'pixels',getFillColor:[71,207,240,240],
    onHover:info=>pick('gauge',info.object,info.x,info.y),onClick:info=>{if(info.object?.nearPlantId)useApp.getState().set({selectedPlantId:info.object.nearPlantId,rightPanel:'drugs'});}}));
  return out;
}



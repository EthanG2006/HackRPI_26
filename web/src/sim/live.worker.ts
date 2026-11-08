import { cascade, type Catalog } from './ensemble';
import type { LiveSnapshot, LngLat, PolygonCoords, MultiPolygonCoords, ScenarioFile } from '../types';

function inside(point:LngLat, geometry:PolygonCoords|MultiPolygonCoords|undefined) {
  if(!geometry?.length) return false;
  const polygons = typeof geometry[0][0]?.[0]==='number' ? [geometry as PolygonCoords] : geometry as MultiPolygonCoords;
  const ringContains=(ring:LngLat[])=>{
    let hit=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const [x,y]=ring[i],[xx,yy]=ring[j];
      if((y>point[1])!==(yy>point[1]) && point[0]<(xx-x)*(point[1]-y)/(yy-y)+x) hit=!hit;
    }
    return hit;
  };
  return polygons.some(poly=>poly.length && ringContains(poly[0])&&!poly.slice(1).some(ringContains));
}
self.onmessage=(e:MessageEvent<Catalog & {snapshot:LiveSnapshot}>)=>{
  const {snapshot, ...catalog}=e.data;
  const probabilities=catalog.plants.map(p=>{
    let probability=0;
    for(const s of snapshot.activeStorms){
      const km=111*Math.hypot((p.lon-s.lon)*Math.cos(p.lat*Math.PI/180),p.lat-s.lat);
      probability=Math.max(probability,Math.min(.95,s.intensityKt/145)*Math.exp(-km/200));
    }
    for(const a of snapshot.alerts){
      if(!/tornado|flood|hurricane|wind|storm/i.test(a.event)) continue;
      if(inside([p.lon,p.lat],a.polygon)) probability=Math.max(probability,{Extreme:.65,Severe:.4,Moderate:.18,Minor:.08}[a.severity]??.04);
    }
    for(const a of snapshot.spc?.areas??[]) if(inside([p.lon,p.lat],a.polygon))
      probability=Math.max(probability,({TSTM:.015,MRGL:.035,SLGT:.08,ENH:.16,MDT:.25,HIGH:.4} as Record<string,number>)[a.label]??.02);
    return probability;
  });
  const losses=probabilities.map((p,i)=>Float64Array.from({length:512},(_,j)=>(((j*137+i*59)%512)/512)<p?1:0));
  const outages=catalog.plants.map((p,i)=>({plantId:p.id,pDisrupt:probabilities[i],
    ci:[Math.max(0,probabilities[i]*.65),Math.min(1,probabilities[i]*1.35)] as [number,number],outageDays:{p10:0,p50:probabilities[i]>.5?9:0,p90:probabilities[i]>.1?18:0}}));
  const result=cascade(catalog,losses,outages,14);
  const day=snapshot.fetchedAt, storm=snapshot.activeStorms[0];
  const sc:ScenarioFile={id:'live',name:'Live weather surveillance',subtitle:snapshot.headline,start:day,day0:day,
    end:new Date(Date.parse(day)+24*3600_000).toISOString(),camera:storm?{longitude:storm.lon,latitude:storm.lat,zoom:4}:{longitude:-96,latitude:38,zoom:3.5},
    heroPlantIds:[...outages].sort((a,b)=>b.pDisrupt-a.pDisrupt).slice(0,3).map(o=>o.plantId),
    heroDrugIds:result.drugRisk.slice(0,3).map(d=>d.drugId), events:[],hazard:[],provenance:'MODEL',notes:[
    'Experimental exposure screen uses cyclone distance, warning polygons and the SPC categorical outlook. Zone-only alerts appear in the summary.',
    'Supply and inventory are simulated.'],...result};
  self.postMessage(sc);
};

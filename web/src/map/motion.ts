import { TripsLayer } from '@deck.gl/geo-layers';
import { activeScenario, type AppState } from '../store';
import { latest } from './geometry';
import { supplyFlows, type Flow } from './layers';
import { riskColor } from '../lib/colors';
import type { LngLat } from '../types';

interface ParticlePath {path:[number,number,number][];times:number[];color:[number,number,number,number]}
const rho=1.15;
const backgroundPressure=1010;
const LOOP=240;

/** Holland (1980) gradient wind, with B calibrated to the archived intensity.
 * Pressure and RMW are archived inputs. Where absent, the displayed field uses the documented
 * 970 hPa / 35 nmi fallback. This visualization never supplies inputs to the warning model.
 */
export function hollandWind(radiusKm:number,rmwKm:number,maxWindKt:number,pressureMb:number,latitude:number){
  const r=Math.max(1000,radiusKm*1000),rmw=Math.max(5000,rmwKm*1000),v=maxWindKt*.514444;
  const dp=Math.max(400,(backgroundPressure-pressureMb)*100);
  const b=Math.min(2.5,Math.max(.7,Math.E*rho*v*v/dp));
  const q=(rmw/r)**b,coriolis=2*7.2921e-5*Math.sin(latitude*Math.PI/180),fr=coriolis*r/2;
  return Math.max(0,Math.sqrt(b*dp/rho*q*Math.exp(-q)+fr*fr)-fr);
}
export function windLayer(s:AppState):TripsLayer<ParticlePath>|null {
  if(!s.layers.wind)return null;
  const w=s.storms[s.scenarioId];
  const observed=latest(w?.storm?.bestTrack,p=>p.t,s.time);
  let lon=observed?.lon,lat=observed?.lat,maxWind=observed?.vmaxKt??0,pressure=observed?.mslpMb??970,rmw=(observed?.rmwNm??35)*1.852;
  if(s.scenarioId==='whatif'&&s.whatif.track.length){
    [lon,lat]=s.whatif.track[Math.floor(s.whatif.track.length/2)];maxWind=[0,74,90,105,125,145][s.whatif.category];pressure=1010-maxWind*.45;rmw=40;
  }
  if(lon===undefined||lat===undefined||maxWind<20)return null;
  if(observed&&s.scenarioId!=='whatif'&&s.time-Date.parse(observed.t)>24*3600000)return null;
  const paths:ParticlePath[]=[];
  for(let i=0;i<260;i++){
    const radius=rmw*(.35+Math.sqrt(((i*113)%263)/263)*7.5);
    const velocity=hollandWind(radius,rmw,maxWind,pressure,lat);
    const path:ParticlePath['path']=[],times:number[]=[];
    const initial=i*2.3999632297;
    for(let j=0;j<=90;j++){
      const t=j*LOOP/90,angle=initial+t*80*velocity/(radius*1000);
      path.push([lon+Math.cos(angle)*radius/(111.2*Math.cos(lat*Math.PI/180)),lat+Math.sin(angle)*radius/111.2,0]);
      times.push(t);
    }
    paths.push({path,times,color:[143,224,237,Math.round(90+Math.min(1,velocity/45)*115)]});
  }
  return new TripsLayer<ParticlePath>({id:'holland-gpu-wind',data:paths,getPath:p=>p.path,getTimestamps:p=>p.times,getColor:p=>p.color,
    widthMinPixels:.65,widthMaxPixels:1.05,getWidth:1,trailLength:5,fadeTrail:true,currentTime:0,opacity:.65});
}
export function flowPath(flow:Flow):[number,number,number][] {
  const path:[number,number,number][]=[];
  const length=Math.hypot((flow.to[0]-flow.from[0])*Math.cos(flow.from[1]*Math.PI/180),flow.to[1]-flow.from[1])*111200;
  for(let k=0;k<=40;k++){
    const t=k/40;
    path.push([flow.from[0]+(flow.to[0]-flow.from[0])*t,flow.from[1]+(flow.to[1]-flow.from[1])*t,Math.sin(Math.PI*t)*length*.12]);
  }
  return path;
}
export function networkMotion(s:AppState,zoom:number):TripsLayer<ParticlePath>|null {
  if(!s.layers.network)return null;
  const sc=activeScenario(s);
  const day=sc?(s.time-Date.parse(sc.day0))/86400000:-30;
  const paths:ParticlePath[]=[];
  for(const flow of supplyFlows(s,zoom)){
    // A plant-to-distributor lane drains first. Distributor buffers deplete after four days.
    const remaining=1-flow.risk*Math.max(0,Math.min(1,(day-(flow.stage==='upstream'?0:4))/7));
    const path=flowPath(flow),phase=(flow.id*17)%60;
    const color=riskColor(flow.risk,Math.round(150+105*remaining));
    for(let start=-60+phase;start<LOOP;start+=remaining<.3?90:remaining<.65?55:30){
      if(remaining<.05)break;
      paths.push({path,times:path.map((_,i)=>start+i*1.5),color});
    }
  }
  return new TripsLayer<ParticlePath>({id:'moving-shipments',data:paths,getPath:p=>p.path,getTimestamps:p=>p.times,getColor:p=>p.color,
    getWidth:1.75,widthUnits:'pixels',trailLength:2.3,fadeTrail:true,currentTime:0,opacity:.8});
}
export function motionTime(now:number){return (now/1000*5)%LOOP;}

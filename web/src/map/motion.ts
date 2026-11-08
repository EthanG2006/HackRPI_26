import { TripsLayer } from '@deck.gl/geo-layers';
import { COORDINATE_SYSTEM } from '@deck.gl/core';
import { activeScenario, type AppState } from '../store';
import { supplyFlows, type Flow } from './layers';
import type { StormState } from './storm';
import { riskColor } from '../lib/colors';
import type { LngLat } from '../types';

interface ParticlePath {period?:number;path:[number,number,number][];times:number[];color:[number,number,number,number]}
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
/**
 * Particles circulating in a storm-relative frame (metres from the eye). Moving the storm only changes
 * `coordinateOrigin`, so the field glides every frame without rebuilding particle data.
 */
export function windLayer(st:StormState):TripsLayer<ParticlePath> {
  const paths:ParticlePath[]=[];
  for(let i=0;i<260;i++){
    const radius=st.rmwKm*(.35+Math.sqrt(((i*113)%263)/263)*7.5);
    const velocity=hollandWind(radius,st.rmwKm,st.vmax,st.pressure,st.lat);
    const path:ParticlePath['path']=[],times:number[]=[];
    const initial=i*2.3999632297;
    for(let j=0;j<=90;j++){
      const t=j*LOOP/90,angle=initial+t*80*velocity/(radius*1000);
      path.push([Math.cos(angle)*radius*1000,Math.sin(angle)*radius*1000,0]);
      times.push(t);
    }
    paths.push({path,times,color:[168,226,234,Math.round(70+Math.min(1,velocity/45)*105)]});
  }
  return new TripsLayer<ParticlePath>({id:'holland-gpu-wind',data:paths,getPath:p=>p.path,getTimestamps:p=>p.times,getColor:p=>p.color,
    coordinateSystem:COORDINATE_SYSTEM.METER_OFFSETS,coordinateOrigin:[st.lon,st.lat,0],
    widthMinPixels:.65,widthMaxPixels:1.05,getWidth:1,trailLength:5,fadeTrail:true,currentTime:0,opacity:.6});
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
// Repeat the same geometry in the shader instead of drawing ten mostly invisible copies per route.
class ShipmentLayer extends TripsLayer<ParticlePath, {getPeriod:(p:ParticlePath)=>number}> {
  static layerName = 'ShipmentLayer';
  static defaultProps = { ...TripsLayer.defaultProps, getPeriod: { type:'accessor' as const, value:30 } };
  initializeState() {
    super.initializeState();
    this.getAttributeManager()!.addInstanced({instancePeriod:{size:1,accessor:'getPeriod',defaultValue:30}});
  }
  getShaders() {
    const shaders=super.getShaders();
    shaders.inject = {...shaders.inject,
      'vs:#decl':shaders.inject['vs:#decl']+'\nin float instancePeriod; out float vPeriod;',
      'vs:#main-end':shaders.inject['vs:#main-end']+'\nvPeriod = instancePeriod;',
      'fs:#decl':shaders.inject['fs:#decl']+'\nin float vPeriod;',
      'fs:DECKGL_FILTER_COLOR':`float age = mod(trips.currentTime - vTime, vPeriod);
        if(age > trips.trailLength) discard;
        color.a *= 1.0 - age / trips.trailLength;`
    };
    return shaders;
  }
}
let flowKey='',flowCache:TripsLayer<ParticlePath>|null=null;
export function networkMotion(s:AppState,zoom:number):TripsLayer<ParticlePath>|null {
  if(!s.layers.network)return null;
  const sc=activeScenario(s);
  const day=sc?(s.time-Date.parse(sc.day0))/86400000:-30;
  const flows=supplyFlows(s,zoom);
  // Rebuild particle paths only when risk or the drain stage visibly changes.
  const key=flows.length+'|'+flows.map(f=>Math.round(f.risk*20)).join('')+'|'+Math.round(Math.max(-1,Math.min(12,day))*3);
  if(key===flowKey&&flowCache)return flowCache;
  const paths:ParticlePath[]=[];
  for(const flow of flows){
    // A plant-to-distributor lane drains first. Distributor buffers deplete after four days.
    const remaining=1-flow.risk*Math.max(0,Math.min(1,(day-(flow.stage==='upstream'?0:4))/7));
    const path=flowPath(flow),phase=(flow.id*17)%60;
    const color=riskColor(flow.risk,Math.round(150+105*remaining));
    if(remaining>=.05)paths.push({path,times:path.map((_,i)=>phase+i*1.5),color,period:remaining<.3?90:remaining<.65?55:30});
  }
  flowKey=key;
  return flowCache=new ShipmentLayer({id:'moving-shipments',getPeriod:(p:ParticlePath)=>p.period??30,data:paths,getPath:p=>p.path,getTimestamps:p=>p.times,getColor:p=>p.color,
    getWidth:1.6,widthUnits:'pixels',trailLength:2.3,fadeTrail:true,currentTime:0,opacity:.7});
}
export function motionTime(now:number){return (now/1000*5)%LOOP;}

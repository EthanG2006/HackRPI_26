import { TripsLayer } from '@deck.gl/geo-layers';
import { COORDINATE_SYSTEM } from '@deck.gl/core';
import type { StormState } from './storm';

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
export function motionTime(now:number){return (now/1000*5)%LOOP;}

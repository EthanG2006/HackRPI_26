import type { Map } from 'maplibre-gl';
import { activeScenario, type AppState } from '../store';
import { latest } from './geometry';
import { plantRisk } from './layers';
import { riskCss } from '../lib/colors';
import type { LngLat } from '../types';

const cities:[string,number,number][]=[
 ['Chicago',-87.63,41.88],['New York',-74.01,40.71],['Atlanta',-84.39,33.75],['Miami',-80.19,25.76],
 ['Houston',-95.37,29.76],['New Orleans',-90.07,29.95],['Memphis',-90.05,35.15],['Nashville',-86.78,36.16],
 ['Charlotte',-80.84,35.23],['Tampa',-82.46,27.95],['Tallahassee',-84.28,30.44],['Washington',-77.04,38.91],
 ['Boston',-71.06,42.36],['Pittsburgh',-80,40.44],['Albany',-73.76,42.65],['Troy',-73.69,42.73],
 ['San Juan',-66.11,18.47],['Ponce',-66.61,18.01],['Havana',-82.37,23.11],['Santo Domingo',-69.93,18.48],
 ['Jacksonville',-81.66,30.33],['Raleigh',-78.64,35.78],['Asheville',-82.55,35.6],['San Antonio',-98.49,29.42],
 ['Dallas',-96.8,32.78],['Birmingham',-86.8,33.52],['Columbia',-81.03,34],['Richmond',-77.44,37.54],
];
const regions:[string,number,number][]=[
 ['TENNESSEE',-86.8,35.65],['NORTH CAROLINA',-79.7,35.5],['SOUTH CAROLINA',-80.8,33.4],['GEORGIA',-83.5,32.3],
 ['FLORIDA',-81.9,28.3],['ALABAMA',-86.7,32.5],['MISSISSIPPI',-89.5,32.4],['LOUISIANA',-92.2,31.15],
 ['ARKANSAS',-92.3,34.7],['KENTUCKY',-84.7,37.5],['VIRGINIA',-79.8,37.4],['NEW YORK',-75.4,43.3],
 ['PENNSYLVANIA',-77.8,40.9],['OHIO',-82.8,40.2],['INDIANA',-86.3,40],['ILLINOIS',-89.2,40.2],
 ['TEXAS',-100,31],['PUERTO RICO',-66.45,18.15],['CUBA',-78.9,21.45],['GULF OF MEXICO',-89,25.5],['ATLANTIC OCEAN',-73,31.8],
];
function label(ctx:CanvasRenderingContext2D,text:string,x:number,y:number,color:string,size=11){
  ctx.font=`500 ${size}px "Inter Variable",sans-serif`;
  ctx.lineWidth=3;ctx.strokeStyle='#091723d9';ctx.strokeText(text,x,y);ctx.fillStyle=color;ctx.fillText(text,x,y);
}
export function stormEye(s:AppState){
  const weather=s.storms[s.scenarioId],advisory=latest(weather?.storm?.advisories,a=>a.issued,s.time);
  if(s.scenarioId==='whatif'&&s.whatif.track.length){const p=s.whatif.track[Math.floor(s.whatif.track.length/2)];return {lon:p[0],lat:p[1],vmax:35+s.whatif.category*22,rmw:28};}
  if(!advisory?.forecast.length || s.time-Date.parse(advisory.issued)>36*3600000)return null;
  const forecast=advisory.forecast;
  const a=latest(forecast,x=>x.t,s.time)??forecast[0];
  const b=forecast.find(x=>Date.parse(x.t)>s.time)??a;
  const t=Math.max(0,Math.min(1,(s.time-Date.parse(a.t))/Math.max(1,Date.parse(b.t)-Date.parse(a.t))));
  const best=latest(weather?.storm?.bestTrack,p=>p.t,s.time);
  return {lon:best?.lon??a.lon+(b.lon-a.lon)*t,lat:best?.lat??a.lat+(b.lat-a.lat)*t,vmax:best?.vmaxKt??a.vmaxKt,rmw:(best?.rmwNm??35)*1.852};
}
export function paintMapEffects(ctx:CanvasRenderingContext2D,map:Map,s:AppState,now:number,width:number,height:number){
  ctx.clearRect(0,0,width,height);
  const sc=activeScenario(s),zoom=map.getZoom(),eye=stormEye(s);
  const point=(lon:number,lat:number)=>map.project([lon,lat]);
  const inside=(x:number,y:number,pad=70)=>x>-pad&&y>-pad&&x<width+pad&&y<height+pad;
  ctx.save();ctx.textAlign='center';
  for(const [name,lon,lat]of regions){
    const p=point(lon,lat);
    if(inside(p.x,p.y)&&zoom<7.4)label(ctx,name,p.x,p.y,name.includes('OCEAN')||name.includes('GULF')?'#527382':'#63808b',zoom>5?11:9);
  }
  for(const [name,lon,lat]of cities){
    const p=point(lon,lat);
    if(inside(p.x,p.y)&&zoom>4.2){
      ctx.beginPath();ctx.arc(p.x,p.y,1.5,0,Math.PI*2);ctx.fillStyle='#9badb4';ctx.fill();
      label(ctx,name,p.x,p.y-7,'#a6b9c2',zoom>6?12:10);
    }
  }
  ctx.restore();
  if(eye && (s.layers.storm||s.layers.wind)){
    const center=point(eye.lon,eye.lat),unit=Math.abs(point(eye.lon,eye.lat+1).y-center.y)/111;
    const radius=Math.min(280,Math.max(32,unit*eye.rmw));
    if(s.layers.storm){
      ctx.save();ctx.translate(center.x,center.y);ctx.rotate(-now*.00009);ctx.lineWidth=1.5;
      for(let arm=0;arm<3;arm++){
        ctx.beginPath();
        for(let i=0;i<65;i++){const a=arm*Math.PI*2/3+i*.045,r=4+i*.42;const x=Math.cos(a)*r,y=Math.sin(a)*r; if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
        ctx.strokeStyle='#aeecf0ad';ctx.stroke();
      }
      ctx.beginPath();ctx.arc(0,0,5,0,Math.PI*2);ctx.fillStyle='#0a2029';ctx.fill();ctx.strokeStyle='#c3f6f8';ctx.stroke();ctx.restore();
    }
  }
  if(s.layers.plants)for(const plant of s.plants){
    const hero=sc?.heroPlantIds.includes(plant.id),selected=s.selectedPlantId===plant.id;
    const p=point(plant.lon,plant.lat);
    if(!inside(p.x,p.y)||(!hero&&!selected))continue;
    const probability=plantRisk(s,plant.id),color=riskCss(probability);
    ctx.beginPath();ctx.arc(p.x,p.y,13+Math.sin(now*.002)*2,0,Math.PI*2);ctx.strokeStyle=color;ctx.globalAlpha=.5;ctx.lineWidth=1;ctx.stroke();ctx.globalAlpha=1;
    const text=plant.name.replace(' Healthcare','').replace(' Corporation','');
    ctx.font='600 11px "Inter Variable",sans-serif';const labelWidth=Math.max(154,ctx.measureText(text).width+20);
    const x=p.x+18,y=p.y-27;
    ctx.fillStyle='#081824ed';ctx.strokeStyle='#375462';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(x,y,labelWidth,43,4);ctx.fill();ctx.stroke();
    ctx.fillStyle=color;ctx.fillRect(x,y+5,2,33);
    label(ctx,text,x+9,y+16,'#e5f0f3',11);
    ctx.font='10px "JetBrains Mono Variable",monospace';ctx.fillStyle='#a9bdc6';ctx.fillText(Math.round(probability*100)+'% disruption · MODEL',x+9,y+32);
    if(s.shockwaveAt&&now>=s.shockwaveAt&&now-s.shockwaveAt<7000){
      const f=(now-s.shockwaveAt)/7000;ctx.beginPath();ctx.arc(p.x,p.y,10+f*width*.7,0,Math.PI*2);ctx.strokeStyle=`rgba(255,141,84,${(1-f)*.65})`;ctx.lineWidth=2;ctx.stroke();
    }
  }
  if(s.highlight?.ids.length||s.selectedHospitalId){
    const ids=new Set([...(s.highlight?.ids??[]),s.selectedHospitalId??'']);
    for(const h of s.hospitals.filter(h=>ids.has(h.id))){
      const p=point(h.lon,h.lat);if(!inside(p.x,p.y))continue;
      ctx.beginPath();ctx.arc(p.x,p.y,11+Math.sin(now*.003)*2,0,Math.PI*2);ctx.strokeStyle='#a4f3ef';ctx.lineWidth=1.3;ctx.stroke();
      label(ctx,h.name,p.x+16,p.y-12,'#e0ffff',11);
    }
  }
}


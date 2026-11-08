import type { Map } from 'maplibre-gl';
import { activeScenario, type AppState } from '../store';
import { plantRisk } from './layers';
import { networkView } from '../logistics/network';
import { HUB_RGB } from '../logistics/networkLayers';
import { stormState } from './storm';
import { smoothTime } from '../lib/clock';
import { labHourNow } from '../lab/labClock';
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
  const st=stormState(s,smoothTime());
  return st?{lon:st.lon,lat:st.lat,vmax:st.vmax,rmw:st.rmwKm}:null;
}
export function paintMapEffects(ctx:CanvasRenderingContext2D,map:Map,s:AppState,now:number,width:number,height:number){
  ctx.clearRect(0,0,width,height);
  const sc=activeScenario(s),zoom=map.getZoom(),eye=stormEye(s);
  const point=(lon:number,lat:number)=>map.project([lon,lat]);
  const inside=(x:number,y:number,pad=70)=>x>-pad&&y>-pad&&x<width+pad&&y<height+pad;
  ctx.save();ctx.textAlign='center';
  for(const [name,lon,lat]of regions){
    const p=point(lon,lat);
    if(inside(p.x,p.y)&&zoom<7.4&&zoom>3.6)label(ctx,name,p.x,p.y,name.includes('OCEAN')||name.includes('GULF')?'#45626f':'#53707b',zoom>5?11:9);
  }
  for(const [name,lon,lat]of cities){
    const p=point(lon,lat);
    if(inside(p.x,p.y)&&zoom>4.9){
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
  // Earthquake playback: P and S wavefronts racing out from the epicenter.
  const quake=s.scenarioId==='whatif'&&s.whatif.result?.hazardKind==='earthquake'&&s.whatif.hour!==null?s.whatif.track[0]:null;
  if(quake){
    const c=point(quake[0],quake[1]),kmPx=Math.abs(point(quake[0],quake[1]+1).y-c.y)/111,t=labHourNow(s)??s.whatif.hour??0;
    for(const [speed,color,width] of [[6.2,'rgba(140,220,255,',1.2],[3.5,'rgba(255,120,90,',2.6]] as const){
      const r=speed*t*kmPx;if(r<2)continue;
      ctx.beginPath();ctx.arc(c.x,c.y,r,0,Math.PI*2);ctx.strokeStyle=color+'0.85)';ctx.lineWidth=width;ctx.stroke();
      ctx.beginPath();ctx.arc(c.x,c.y,r,0,Math.PI*2);ctx.strokeStyle=color+'0.18)';ctx.lineWidth=width*6;ctx.stroke();
    }
  }
  const placed:{x:number;y:number;w:number;h:number}[]=[];
  const hit=(x:number,y:number,w:number,h:number)=>placed.some(b=>x<b.x+b.w+6&&x+w+6>b.x&&y<b.y+b.h+6&&y+h+6>b.y);
  if(s.layers.plants)for(const plant of [...s.plants].sort((a,b)=>plantRisk(s,b.id)-plantRisk(s,a.id))){
    const hero=sc?.heroPlantIds.includes(plant.id),selected=s.selectedPlantId===plant.id;
    const p=point(plant.lon,plant.lat);
    if(!inside(p.x,p.y)||(!hero&&!selected))continue;
    const probability=plantRisk(s,plant.id),color=riskCss(probability);
    ctx.beginPath();ctx.arc(p.x,p.y,13+Math.sin(now*.002)*2,0,Math.PI*2);ctx.strokeStyle=color;ctx.globalAlpha=.5;ctx.lineWidth=1;ctx.stroke();ctx.globalAlpha=1;
    const text=plant.name.replace(' Healthcare','').replace(' Corporation','');
    ctx.font='600 11px "Inter Variable",sans-serif';const labelWidth=Math.max(154,ctx.measureText(text).width+20);
    // Riskiest plants claim label space first; others shift down to clear it, or stay as rings only.
    let x=p.x+18,y=p.y-27,tries=0;
    while(hit(x,y,labelWidth,43)&&tries<3){y+=49;tries++;}
    if(hit(x,y,labelWidth,43))continue;
    placed.push({x,y,w:labelWidth,h:43});
    if(tries){ctx.beginPath();ctx.moveTo(p.x+6,p.y);ctx.lineTo(x,y+21);ctx.strokeStyle='#375462';ctx.lineWidth=1;ctx.stroke();}
    ctx.fillStyle='#081824ed';ctx.strokeStyle='#375462';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(x,y,labelWidth,43,4);ctx.fill();ctx.stroke();
    ctx.fillStyle=color;ctx.fillRect(x,y+5,2,33);
    label(ctx,text,x+9,y+16,'#e5f0f3',11);
    ctx.font='10px "JetBrains Mono Variable",monospace';ctx.fillStyle='#a9bdc6';ctx.fillText(probability>=.995?'CONFIRMED OFFLINE':Math.round(probability*100)+'% chance of disruption',x+9,y+32);
    if(s.shockwaveAt&&now>=s.shockwaveAt&&now-s.shockwaveAt<7000){
      const f=(now-s.shockwaveAt)/7000;ctx.beginPath();ctx.arc(p.x,p.y,10+f*width*.7,0,Math.PI*2);ctx.strokeStyle=`rgba(255,141,84,${(1-f)*.65})`;ctx.lineWidth=2;ctx.stroke();
    }
  }
  // Hub chips: strained hubs always, every hub while the network command is open.
  const net=s.layers.network&&s.introDone?networkView(s):null;
  if(net){
    const all=s.rightPanel==='logistics';
    for(const a of net.executed){
      const age=now-a.at;if(!a.to||age<0||age>3200)continue;
      const p=point(a.to[0],a.to[1]),f=age/3200;
      ctx.beginPath();ctx.arc(p.x,p.y,8+f*70,0,Math.PI*2);ctx.strokeStyle=`rgba(91,228,155,${(1-f)*.9})`;ctx.lineWidth=2.5;ctx.stroke();
    }
    for(const h of [...net.hubs].sort((a,b)=>a.ratio-b.ratio)){
      if(!all&&h.status==='normal')continue;
      const p=point(h.dc.lon,h.dc.lat);if(!inside(p.x,p.y))continue;
      const [r,g,b]=HUB_RGB[h.status],color=`rgb(${r},${g},${b})`;
      if(h.status==='critical'||h.status==='down'){const f=(now%1600)/1600;ctx.beginPath();ctx.arc(p.x,p.y,10+f*22,0,Math.PI*2);ctx.strokeStyle=`rgba(${r},${g},${b},${(1-f)*.7})`;ctx.lineWidth=1.6;ctx.stroke();}
      const title=h.dc.city.toUpperCase()+' HUB',sub=h.status==='down'?'OFFLINE · warehouse hit':`${Math.round(h.ratio*100)}% inbound${h.runoutDay!==null?` · dry day ${h.runoutDay}`:''}`;
      ctx.font='10px "JetBrains Mono Variable",monospace';const w=Math.max(ctx.measureText(sub).width,ctx.measureText(title).width)+20,x=p.x-w/2,y=p.y+14;
      if(hit(x,y,w,32))continue;placed.push({x,y,w,h:32});
      ctx.fillStyle='#081824e8';ctx.strokeStyle=`rgba(${r},${g},${b},.55)`;ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(x,y,w,32,4);ctx.fill();ctx.stroke();
      ctx.fillStyle=color;ctx.fillRect(x,y+4,2,24);
      ctx.textAlign='left';ctx.font='600 10px "Inter Variable",sans-serif';ctx.fillStyle='#e5f0f3';ctx.fillText(title,x+9,y+13);
      ctx.font='9.5px "JetBrains Mono Variable",monospace';ctx.fillStyle=color;ctx.fillText(sub,x+9,y+26);
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


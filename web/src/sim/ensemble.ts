import type { Drug, Hospital, Plant, WhatIfRequest, WhatIfResult, LngLat, PlantOutage, Band, Impact } from '../types';

export interface Catalog { plants: Plant[]; drugs: Drug[]; hospitals: Hospital[] }
export type SimulationInput = Catalog & { req: WhatIfRequest };
const clamp = (n: number, lo=0, hi=1) => Math.min(hi, Math.max(lo,n));
const round = (n:number) => Math.round(n*1000)/1000;
const DEG = Math.PI/180;
const wrap = (x:number) => (x+540)%360-180;
const eastKm = (lat:number) => 111.2*Math.max(.05, Math.cos(lat*DEG));
const coneHours = [0,12,24,36,48,60,72,96,120];
const coneNm = [0,25,39,49,62,77,95,134,200]; // NHC 2026 Atlantic two-thirds radii.

function radius(hours:number) {
  for (let i=1;i<coneHours.length;i++) if (hours<=coneHours[i])
    return 1.852*(coneNm[i-1]+(coneNm[i]-coneNm[i-1])*(hours-coneHours[i-1])/(coneHours[i]-coneHours[i-1]));
  return coneNm.at(-1)!*1.852;
}

function segmentKm(p: Plant, a:LngLat, b:LngLat) {
  const scale=eastKm(p.lat);
  const ax=wrap(a[0]-p.lon)*scale, ay=(a[1]-p.lat)*111.2;
  const bx=wrap(b[0]-a[0])*scale, by=(b[1]-a[1])*111.2;
  const t=clamp(-(ax*bx+ay*by)/(bx*bx+by*by||1));
  return Math.hypot(ax+t*bx,ay+t*by);
}

export function impactFromStockouts(stock:number[], hospitals:Hospital[], drug:Drug|undefined): Impact {
  let affected = 0, units=0, vulnerable=0, freightBatches=0;
  stock.forEach((d,i) => {
    if(d>30) return;
    const h=hospitals[i], daily=h.beds*(drug?.dailyUsePer100Beds??50)/100;
    const recovered = daily*Math.min(10,31-d)*.45;
    units+=recovered; affected++; if(h.svi>=.75) vulnerable++;
    freightBatches+=recovered/100;
  });
  const patients=Math.round(units/3), staff=affected*6*65;
  const savings=Math.round(units*(drug?.contractPricePerUnit??1)*((drug?.grayMarketMultiplier??2.5)-1))+patients*1150;
  const freight=freightBatches*.05*800*(.60-.08)/1000, waste=units*.03*.001;
  const item=(key:string,label:string,value:number,unit:string,assumption:string)=>({key,label,value,unit,assumption,provenance:'SIMULATED' as const});
  return {patientsProtected:patients, dollarsSaved:savings+staff,co2TonsAvoided:round(freight+waste),highSviPreventedPct:affected?vulnerable/affected:0,
    breakdown:{ patients:[item('protected','Modeled encounters protected',patients,'patients','Early warning secures 45% of up to ten shortage days. Three units support one encounter.')],
      dollars:[item('price','Cancellations and expedited purchasing avoided',savings,'USD','Recovered units × contract price × gray-market markup, plus $1,150 per protected encounter in cancelled-procedure margin.'),item('staff','Coordination time saved',staff,'USD','Six pharmacy and supply-chain hours per exposed facility at $65/hour.')],
      co2:[item('freight','Air-to-road substitution',round(freight),'t CO₂e','50 kg per 100 units × 800 km × assumed 0.52 kg CO₂e/t-km avoided.'),item('waste','Expired units avoided',round(waste),'t CO₂e','Assume 3% waste avoided at 1 kg CO₂e per unit.')],
      equity:[item('equity','High-vulnerability share',affected?round(vulnerable/affected*100):0,'%','Share of exposed facilities served in the top SVI quartile, assuming equal intervention success.')]}};
}

export function cascade(catalog:Catalog, losses:Float64Array[], outages:PlantOutage[], recovery:number) {
  const stockouts:WhatIfResult['hospitalStockouts']={};
  const baselineDays = catalog.hospitals.map(h=> 2.5+Math.min(5,Math.log1p(Math.max(1,h.beds))/1.45)-1.3*+h.rural-.7*+(h.svi>=.75));
  const risks = catalog.drugs.map(drug=>{
    const shares = catalog.plants.map((p,i)=>({i,share:p.share[drug.id]??0})).filter(p=>p.share>0);
    const memberLoss = new Float64Array(losses[0]?.length ?? 1);
    for(const {i,share} of shares) for(let m=0;m<memberLoss.length;m++) memberLoss[m]+=share*losses[i][m];
    memberLoss.sort();
    const q=(v:number)=>clamp(memberLoss[Math.floor(v*(memberLoss.length-1))],0,.98);
    let mean=0; for(const v of memberLoss) mean+=clamp(v); mean/=memberLoss.length;
    const band:Band={p10:[],p50:[],p90:[]}, hospitalBand:Band={p10:[],p50:[],p90:[]};
    const offset=drug.sterileInjectable?0:1;
    for(const [name,level] of [['p10',.90],['p50',.50],['p90',.10]] as const) {
      const loss=q(level), deficit:number[]=[];
      let cumulative=0;
      for(let d=0;d<90;d++){
        // Three distributor-buffer days, then a seven-day ramp down before recovery.
        const shortage=loss*Math.min(1,Math.max(0,d-2)/7)*Math.exp(-Math.max(0,d-10)/recovery);
        band[name].push(round(1-shortage)); cumulative+=shortage; deficit.push(cumulative);
      }
      const maxDeficit=deficit[89];
      hospitalBand[name]=baselineDays.map(days=>{
        const buffer=days+offset;
        if(buffer>maxDeficit) return 999;
        let lo=0,hi=89; while(lo<hi) {const mid=(lo+hi)>>1;if(deficit[mid]>=buffer)hi=mid;else lo=mid+1;}
        return lo;
      });
    }
    stockouts[drug.id]=hospitalBand;
    const baseline=clamp(drug.baselineRisk), risk=round(baseline+(1-baseline)*mean);
    const weather=(1-baseline)*mean, nAtRisk=hospitalBand.p50.filter(v=>v!==999).length;
    let earliest=999; for(const v of hospitalBand.p50) earliest=Math.min(earliest,v);
    return {drugId:drug.id,risk,ci:[round(baseline+(1-baseline)*q(.1)),round(baseline+(1-baseline)*q(.9))] as [number,number],
      supplyCurve:band,hospitalsAtRisk:nAtRisk,firstStockoutDay:earliest,shap:[
        {feature:'baseline',label:'Baseline supply fragility',value:round(baseline)},
        {feature:'ensemble',label:'Weather-exposed manufacturing share',value:round(weather)}
      ]};
  }).sort((a,b)=>b.risk-a.risk);
  const mostExposed=[...risks].sort((a,b)=>b.hospitalsAtRisk-a.hospitalsAtRisk || b.risk-a.risk)[0];
  const impact=impactFromStockouts(mostExposed?stockouts[mostExposed.drugId].p50:[],catalog.hospitals,catalog.drugs.find(d=>d.id===mostExposed?.drugId));
  return {drugRisk:risks,hospitalStockouts:stockouts,impact,outages};
}

export function runEnsemble(input:SimulationInput):WhatIfResult {
  const start=performance.now(), req=input.req;
  if(req.track.length<2 || req.track.length>128 || req.track.some(([x,y])=>!Number.isFinite(x+y)||Math.abs(y)>90||Math.abs(x)>180)) throw Error('Place between 2 and 128 valid points.');
  if(!Number.isFinite(req.category+req.forwardSpeedKt+(req.members??1000)))throw Error('Storm intensity, speed and ensemble size must be finite.');
  const members=Math.round(clamp(req.members??1000,100,2000)), speed=clamp(req.forwardSpeedKt,1,60);
  const category=clamp(req.category,1,5);
  let seed=2166136261;
  for(const c of JSON.stringify(req)) seed=Math.imul(seed^c.charCodeAt(0),16777619);
  const rand=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return (seed+.5)/4294967296;};
  const normal=()=>Math.sqrt(-2*Math.log(rand()))*Math.cos(2*Math.PI*rand());
  let hours=0;
  const sigmas=req.track.map((p,i)=>{
    if(i){const a=req.track[i-1];hours+=Math.hypot(wrap(p[0]-a[0])*eastKm((p[1]+a[1])/2),(p[1]-a[1])*111.2)/(speed*1.852);}
    return radius(hours)/Math.sqrt(-2*Math.log(1/3));
  });
  const losses=input.plants.map(()=>new Float64Array(members)), samples:LngLat[][]=[];
  const recovery=12+category*4+8/speed;
  const totals=input.plants.map(()=>0);
  for(let m=0;m<members;m++){
    let x=normal(),y=normal();
    const track=req.track.map(([lon,lat],i):LngLat=>{
      // Correlated perturbations preserve a coherent trajectory across consecutive fixes.
      x=.88*x+Math.sqrt(1-.88**2)*normal(); y=.88*y+Math.sqrt(1-.88**2)*normal();
      return [wrap(lon+x*sigmas[i]/eastKm(lat)),clamp(lat+y*sigmas[i]/111.2,-85,85)];
    });
    if(m<36) samples.push(track);
    input.plants.forEach((p,i)=>{
      let dist=Infinity;
      for(let k=1;k<track.length;k++) dist=Math.min(dist,segmentKm(p,track[k-1],track[k]));
      const exposure=clamp((.42+category*.105)*Math.exp(-((dist/(45+category*30))**2))*(1+Math.min(.16,1/speed)));
      const hit=rand()<exposure; if(hit){losses[i][m]=1;totals[i]++;}
    });
  }
  const outages=input.plants.map((p,i)=>{
    const prob=totals[i]/members, err=1.282*Math.sqrt((prob*(1-prob)+.001)/members);
    return {plantId:p.id,pDisrupt:round(prob),ci:[round(clamp(prob-err)),round(clamp(prob+err))] as [number,number],
      outageDays:{p10:prob>.9?Math.round(recovery*.65):0,p50:prob>.5?Math.round(recovery):0,p90:prob>.1?Math.round(recovery*1.45):0}};
  });
  const result=cascade(input,losses,outages,recovery);
  return {engine:'browser',elapsedMs:performance.now()-start,members,sampleTracks:samples,...result};
}


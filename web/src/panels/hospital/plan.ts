import type {AppState} from '../../store';
import type {Hospital, ScenarioFile} from '../../types';
import {dayToDate,fmtDate} from '../../lib/format';
export function stockDate(day0:string,day:number){
 return day==null||day>=999?'Beyond 90 days':fmtDate(dayToDate(day0,day).getTime());
}
export function buildPlan(s:AppState,sc:ScenarioFile,h:Hospital){
 const i=s.hospitalIndex.get(h.id)!;
 const ranked=[...sc.drugRisk].filter(r=>sc.hospitalStockouts[r.drugId]).sort((a,b)=>b.risk-a.risk);
 const drugs=ranked.flatMap(r=>{
   const drug=s.drugs.find(d=>d.id===r.drugId);
   if(!drug)return [];
   const band=sc.hospitalStockouts[r.drugId], dh=sc.inventoryDoh?.[r.drugId]?.[i];
   return [{drug,r,median:band.p50[i]??999,early:band.p10[i]??999,late:band.p90[i]??999,inventory:dh}];
 });
 const first=drugs[0], eq=s.equity[sc.id];
 const demand=first?Math.max(1,first.drug.dailyUsePer100Beds*h.beds/100):0;
 const horizon=eq?.horizonDays??14;
 const coverage=eq?.drugId===first?.drug.id ? eq?.policies.rxradar.coverage[i] : undefined;
 const normalSupply=first?.r.supplyCurve.p50.slice(0,horizon)??[];
 const fraction=normalSupply.length?normalSupply.reduce((a,b)=>a+b,0)/normalSupply.length:0;
 const cap=Math.floor(demand*horizon*Math.max(0,Math.min(1,coverage??fraction)));
 const order=Math.min(cap,Math.max(0,Math.ceil(demand*(horizon-(first?.inventory??0)))));
 const contract=order*(first?.drug.contractPricePerUnit??0), crisis=contract*(first?.drug.grayMarketMultiplier??1);
 const region=first?s.hospitals.map((hospital,j)=>({hospital,day:sc.hospitalStockouts[first.drug.id].p50[j],dist:Math.hypot((hospital.lon-h.lon)*Math.cos(h.lat*Math.PI/180),hospital.lat-h.lat)})).filter(n=>n.hospital.id!==h.id&&n.day>Math.max(14,first.median)&&n.dist<3).sort((a,b)=>a.dist-b.dist)[0]:null;
 const actions=[
 {action:'Review a capped replenishment order',reason:order+' '+(first?.drug.unit??'unit')+' units under a modeled fair-share cap of '+cap+' over '+horizon+' days.'},
 {action:'Prepare formulary alternatives',reason:first?.drug.conservation[0]?.strategy??'Ask the pharmacy committee to review substitution protocols.'},
 {action:'Review elective procedure demand',reason:'Compare scheduled procedures with the estimated supply window before changing bookings.'},
 {action:region?'Contact '+region.hospital.name:'Request regional inventory confirmation',reason:region?'This nearby facility has a longer modeled supply window. Confirm transferable stock directly.':'Confirm actual availability with the regional pharmacy network.'}
 ];
 return {drugs,order,cap,contract,crisis,staffHours:order>0?2:0,actions,horizon};
}

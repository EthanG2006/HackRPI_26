import type {WhatIfResult,Hospital} from '../types';
export function supplyOutlook(r:WhatIfResult,hospitals:Hospital[]){
 const affected=new Set<number>(),downside=new Set<number>();
 const riskCounts=new Map<string,number>();
 for(const [drugId,band] of Object.entries(r.hospitalStockouts)) {
   band.p50.forEach((day,i)=>{if(day<90)affected.add(i);});
   let count=0;band.p10.forEach((day,i)=>{if(day<90){downside.add(i);count++;}});riskCounts.set(drugId,count);
 }
 const medicines=r.drugRisk.filter(d=>d.hospitalsAtRisk>0);
 const downsideMedicines=[...riskCounts.values()].filter(n=>n>0).length;
 const priority=[...r.drugRisk].sort((a,b)=>affected.size?b.hospitalsAtRisk-a.hospitalsAtRisk||b.risk-a.risk:(riskCounts.get(b.drugId)??0)-(riskCounts.get(a.drugId)??0)||b.risk-a.risk)[0];
 const band=priority?r.hospitalStockouts[priority.drugId]:undefined;
 let first=999,index=-1;
 (affected.size?band?.p50:band?.p10)?.forEach((d,i)=>{if(d<first){first=d;index=i;}});
 const hospital=index>=0?hospitals[index]:undefined;
 const exposed=r.plantHazards?.filter(p=>p.windKt[1]>=34||p.rainIn[1]>=4||p.pDisrupt>=.2)??[];
 return {hospitals:affected.size,downsideHospitals:downside.size,medicines:medicines.length,downsideMedicines,priority,first,hospital,exposed:exposed.length};
}

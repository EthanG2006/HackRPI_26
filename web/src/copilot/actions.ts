import { activeScenario, useApp } from '../store';
import { hospitalForQuestion } from '../lib/hospitals';
import type { Hospital, LngLat, PolicyId } from '../types';
export type ToolCall={name:string; input:Record<string,unknown>};
export type Answer={text:string;tools:ToolCall[];sourceIds:string[];hospitals?:{id:string;name:string;day:number}[]};
const southeast=new Set(['NC','SC','GA','FL','TN','MS','AL','AR','LA','KY','VA','WV']);
const presets:Record<string,{longitude:number;latitude:number;zoom:number}>={
 'southeast':{longitude:-83,latitude:33,zoom:4.8},'puerto rico':{longitude:-66.4,latitude:18.1,zoom:7},
 'capital region':{longitude:-73.72,latitude:42.68,zoom:9.3},'troy':{longitude:-73.67,latitude:42.73,zoom:10},
 'north cove':{longitude:-81.96,latitude:35.93,zoom:9},'gulf coast':{longitude:-89,latitude:29,zoom:5},
 'united states':{longitude:-96,latitude:38,zoom:3.5}
};
export function matchedHospitals(filter:Record<string,unknown>) {
 const s=useApp.getState(),sc=activeScenario(s);
 const drugId=String(filter.drugId??s.selectedDrugId??sc?.heroDrugIds[0]??'');
 const stocks=sc?.hospitalStockouts[drugId]?.p50;
 const region=String(filter.region??'').toLowerCase();
 return s.hospitals.map((h,i)=>({h,day:stocks?.[i]??999})).filter(({h})=>
   (!filter.pediatric || h.pediatric) && (!filter.rural || h.rural) && (!filter.highSvi || h.svi>=.75) &&
   (!region || region==='all' || (region==='southeast'?southeast.has(h.state):h.state.toLowerCase()===region||h.city.toLowerCase().includes(region))))
   .sort((a,b)=>a.day-b.day||b.h.svi-a.h.svi).slice(0,Math.min(200,Number(filter.limit??8)));
}
function hospitalName(query:string):Hospital|undefined {
 return hospitalForQuestion(useApp.getState().hospitals, query);
}
export function executeTool(tool:ToolCall):string {
 const s=useApp.getState(), input=tool.input??{};
 if(tool.name==='fly_to'){
   const camera=presets[String(input.place??'').toLowerCase()];
   if(camera){s.flyTo({...camera,pitch:25,duration:1800});return 'Map moved to '+input.place;}
 }
 if(tool.name==='highlight_hospitals'){
   const list=matchedHospitals(input);
   s.setHighlight(list.map(x=>x.h.id),String(input.pediatric?'Children’s hospitals':'Hospitals')+' · '+String(input.region??'all regions'));
   s.setLayers({hospitals:true});return list.length+' hospitals highlighted';
 }
 if(tool.name==='query_drug_risk'){
   const q=String(input.drug??'').toLowerCase(), drug=s.drugs.find(d=>d.id===q||d.name.toLowerCase().includes(q)||d.shortName.toLowerCase().includes(q));
   if(drug){s.selectDrug(drug.id);return drug.shortName+' risk selected';}
 }
 if(tool.name==='set_allocation_policy'){
   const policy=String(input.policy) as PolicyId;
   if(['market','proportional','rxradar'].includes(policy)){
    s.set({policy,equityOpen:true,rightPanel:'equity',abmDay:14});return names[policy]+' allocation selected';
   }
 }
 if(tool.name==='open_hospital'||tool.name==='generate_briefing'){
   const id=String(input.id??input.hospital_id??''), hospital=s.hospitals.find(h=>h.id===id);
   if(hospital){
    s.openHospital(id);
    if(tool.name==='generate_briefing')s.set({briefingFor:{hospitalId:id,at:Date.now()}});
    return tool.name==='generate_briefing'?'Briefing requested for '+hospital.name:hospital.name+' opened';
   }
 }
 if(tool.name==='run_storm'){
   const track=input.track;
   const category=Math.round(Number(input.category??4)), speed=Number(input.forwardSpeedKt??12);
   if(Array.isArray(track)&&track.length>=2&&track.length<=128&&track.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=85)&&category>=1&&category<=5&&Number.isFinite(speed)){
     s.setWhatIf({track:track as LngLat[],category:category as 1|2|3|4|5,forwardSpeedKt:Math.max(1,Math.min(60,speed)),drawing:false});
     s.set({scenarioId:'whatif',rightPanel:'whatif',equityOpen:false,whatifRunAt:Date.now(),playing:false});
     return 'Storm ensemble started';
   }
 }
 return 'Command could not resolve a matching map target';
}
const names:Record<PolicyId,string>={market:'Market',proportional:'Proportional',rxradar:'Fair'};
export function clinicalQuestion(text:string){
 return /which patient|patient.?level|who (gets|should get|should receive|deserves)|deny (care|treatment)|ration.*(patient|child|age)|choose.*(patient|life)|withhold.*(care|treatment)|triage.*patient/i.test(text);
}
export function cachedAnswer(text:string):Answer{
 const q=text.toLowerCase(),s=useApp.getState(),sc=activeScenario(s);
 const tools:ToolCall[]=[], sourceIds:string[]=[];
 const source=(needle:string)=>{const src=s.sources.find(x=>x.id.includes(needle)||x.name.toLowerCase().includes(needle));if(src)sourceIds.push(src.id);};
 source('hifld');source('assumptions');source('nhc');
 if(clinicalQuestion(text))return {text:'Patient-specific triage requires clinician-led review and the hospital’s established clinical allocation framework. I can compare aggregate hospital demand, conservation options and fair-share ordering. The equity lab provides that planning view.',tools:[{name:'set_allocation_policy',input:{policy:'rxradar'}}],sourceIds};
 if(!sc)return {text:'The scenario archive is still loading. Select a storm replay, then ask again.',tools,sourceIds};
 const hospital=hospitalName(q);
 if(/brief|memo|pdf/.test(q)){
   const h=hospital??s.hospitals.find(h=>h.id===s.selectedHospitalId)??s.hospitals.find(h=>h.id==='samaritan-troy');
   if(h)return {text:'Preparing the CMO briefing for '+h.name+' using the current scenario, modeled stockout intervals, recommended pharmacy actions and source links. Every action remains subject to pharmacist approval.',tools:[{name:'generate_briefing',input:{hospital_id:h.id}}],sourceIds};
 }
 if(hospital){
   tools.push({name:'open_hospital',input:{id:hospital.id}});
   const idx=s.hospitalIndex.get(hospital.id)!, drug=s.selectedDrugId??sc.heroDrugIds[0],band=sc.hospitalStockouts[drug];
   const day=band?.p50[idx]??999;
   return {text:hospital.name+' in '+hospital.city+' has '+hospital.beds+' listed beds. '+(day<999?'The inventory simulation projects the first stockout for the selected drug around day '+day+' after '+new Date(sc.day0).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})+', with an 80% interval of '+band.p10[idx]+'–'+(band.p90[idx]===999?'beyond 90':band.p90[idx])+' days.':'No stockout appears in the 90-day modeled horizon for the selected drug.')+' Open the pharmacy actions for fair-share quantities and review. Inventory and purchasing inputs are simulated.',tools,sourceIds};
 }
 if(/storm|hurricane|category/.test(q)&&/draw|simulate|what.?if|category|run/.test(q)){
   const pr=/puerto|maria/.test(q),cat=Number(q.match(/(?:category|cat)\s*([1-5])/)?.[1]??4);
   const track=pr?[[-60,15],[-63,16.5],[-65.5,18],[-68,19]]:[[-88,23],[-88,27],[-88,30],[-85,34],[-82,37]];
   return {text:'Running a Category '+cat+' storm ensemble through '+(pr?'Puerto Rico':'the Gulf Coast')+'. The 1,000 perturbed tracks produce a distribution of plant outages and inventory stockout dates. Track-error radii follow NHC’s published cone statistics. Site outage probabilities and downstream inventories use explicit planning assumptions.',tools:[{name:'run_storm',input:{track,category:cat,forwardSpeedKt:12}},{name:'fly_to',input:{place:pr?'puerto rico':'gulf coast'}}],sourceIds};
 }
 if(/allocation|equity|fair|hoard|market/.test(q)){
   const policy:PolicyId=/market/.test(q)?'market':/proportional/.test(q)?'proportional':'rxradar';
   tools.push({name:'set_allocation_policy',input:{policy}});
   const eq=s.equity[s.scenarioId];
   const m=eq?.policies.market.metrics, f=eq?.policies.rxradar.metrics;
   const comparison=m&&f?'Across the 14-day simulation, '+Math.round(m.pctStockedOut*100)+'% of hospitals stock out under Market and '+Math.round(f.pctStockedOut*100)+'% under Rx Radar. High-vulnerability stockouts change from '+m.highSviStockouts.toLocaleString()+' to '+f.highSviStockouts.toLocaleString()+'. ':'';
   return {text:comparison+'The fair allocation program distributes available units under a shared supply budget and facility order caps. Drag the equity weight to change group coverage floors. Demand, starting inventory, ordering behavior and patient-delay proxies are simulated.',tools,sourceIds};
 }
 const drug=s.drugs.find(d=>q.includes(d.shortName.toLowerCase())||q.includes(d.name.toLowerCase())||q.includes(d.id)) ??
   s.drugs.find(d=>d.id===(/iv|fluid|saline/.test(q)?'sodium-chloride-0-9-iv':s.selectedDrugId??sc.heroDrugIds[0]));
 const drugId=drug?.id??sc.heroDrugIds[0];
 if(/child|pediatric|rural|vulnerab|hospital|first|southeast/.test(q)){
   const filter={pediatric:/child|pediatric/.test(q),rural:/rural/.test(q),highSvi:/vulnerab|svi/.test(q),region:/southeast/.test(q)?'southeast':'all',drugId,limit:6};
   const list=matchedHospitals(filter), atRisk=list.filter(x=>x.day<999);
   tools.push({name:'highlight_hospitals',input:filter});
   if(filter.region==='southeast')tools.push({name:'fly_to',input:{place:'southeast'}});
   const hospitals=atRisk.slice(0,4).map(({h,day})=>({id:h.id,name:h.name,day}));
   const lines=hospitals.map((h,i)=>(i+1)+'. '+h.name+' — projected day '+h.day+'.').join('\n');
   return {text:(atRisk.length?'The earliest modeled '+(filter.pediatric?'pediatric ':filter.rural?'rural ':'')+'stockouts for '+(drug?.shortName??'the selected drug')+' are\n\n'+lines:
     'No matching hospitals project a stockout within the 90-day inventory horizon for '+(drug?.shortName??'the selected drug')+'.')+
     '\n\nThese dates count from '+new Date(sc.day0).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})+'. Hospital locations are public records. Inventory buffers, drug use and supplier links are modeled. Open a highlighted hospital for its uncertainty band and pharmacist-reviewed actions.',tools,sourceIds,hospitals};
 }
 const risk=sc.drugRisk.find(d=>d.drugId===drugId);
 if(risk&&drug){
   tools.push({name:'query_drug_risk',input:{drug:drug.id}});
   return {text:drug.shortName+' has a scenario risk estimate of '+Math.round(risk.risk*100)+'% with an 80% interval of '+Math.round(risk.ci[0]*100)+'–'+Math.round(risk.ci[1]*100)+'%. The cascade projects '+risk.hospitalsAtRisk.toLocaleString()+' facilities reaching a stockout in 90 days. This estimate combines exposed manufacturing share, baseline supply fragility and synthetic inventory assumptions. The drug panel shows its drivers, alternatives and network evidence.',tools,sourceIds};
 }
 return {text:'I can rank hospitals by projected stockout, inspect a drug, compare allocation policies, draw a what-if storm or generate a CMO briefing. Try “Which children’s hospitals in the Southeast run out of IV fluids first?”',tools,sourceIds};
}
export function copilotContext(){
 const s=useApp.getState(),sc=activeScenario(s);
 return {scenarioId:s.scenarioId,scenarioName:sc?.name,day0:sc?.day0,informationTime:new Date(s.time).toISOString(),equityOpen:s.equityOpen,selectedHospitalId:s.selectedHospitalId,
   drugRisk:sc?.drugRisk.slice(0,8).map(d=>({id:d.drugId,risk:d.risk,ci:d.ci,hospitalsAtRisk:d.hospitalsAtRisk})),
   pediatric:matchedHospitals({pediatric:true,region:'southeast',limit:8}).map(({h,day})=>({id:h.id,name:h.name,state:h.state,day})),
   sources:s.sources.map(({id,name,url})=>({id,name,url}))};
}

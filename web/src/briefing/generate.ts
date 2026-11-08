import { jsPDF } from 'jspdf';
import { activeScenario,useApp } from '../store';
import {buildPlan,stockDate} from '../panels/hospital/plan';
import {fmtDate,fmtPct,fmtUsd,fmtUtc} from '../lib/format';

export async function generateBriefing(id:string){
 const s=useApp.getState(), sc=activeScenario(s), h=s.hospitals.find(x=>x.id===id);
 if(!h||!sc)throw new Error('Choose a hospital and a scenario first.');
 const plan=buildPlan(s,sc,h);
 const doc=new jsPDF({unit:'mm',format:'letter',compress:true});
 doc.setProperties({title:'CMO pharmacy briefing - '+h.name,author:'Rx Radar'});
 const clean=(v:string)=>v.replace(/[’‘]/g,"'").replace(/[–—]/g,'-').replace(/→/g,' to ').replace(/≈/g,'~');
 const text=(v:string,x:number,y:number,size=10,bold=false,color='#233b49')=>{doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(color);doc.text(clean(v),x,y)};
 const wrap=(v:string,x:number,y:number,w:number,size=9,bold=false,max=3)=>{doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);const lines=doc.splitTextToSize(clean(v),w) as string[];lines.slice(0,max).forEach((line,i)=>text(line,x,y+i*4.2,size,bold));return y+Math.min(max,lines.length)*4.2};
 doc.setFillColor('#102733');doc.rect(0,0,216,38,'F');text('Rx Radar   /   Pharmacy operations',15,12,10,true,'#87e6dd');text('Chief Medical Officer briefing',15,25,22,true,'#ffffff');
 text(fmtDate(s.time)+'  |  '+sc.name,15,32,9,false,'#deeeef');
 let y=wrap(h.name,15,51,123,17,true,2)+4;
 text(h.city+', '+h.state+'   |   '+h.beds+' beds   |   County SVI '+fmtPct(h.svi),15,y,9);
 wrap('Planning scenario. Inventory, orders and financial outcomes are model estimates. Verify availability with the distributor.',15,y+7,119,9);
 try {
   const image=(window as Window & {rxMapSnapshot?:()=>string|undefined}).rxMapSnapshot?.();
   if(image)doc.addImage(image,'PNG',140,43,61,34,undefined,'FAST');
 } catch { /* Facility coordinates remain available when a GPU context is lost. */ }
 text('Facility  '+h.lat.toFixed(2)+', '+h.lon.toFixed(2),140,82,8);
 y=92;text('Projected inventory',15,y,14,true);y+=5;
 doc.setFillColor('#eaf2f2');doc.rect(15,y,186,9,'F');text('MEDICINE',18,y+6,8,true);text('ON HAND',91,y+6,8,true);text('MEDIAN STOCKOUT / 80% WINDOW',115,y+6,8,true);y+=17;
 for(const row of plan.drugs.slice(0,3)){
  wrap(row.drug.shortName,18,y,69,10,true,2);text(row.inventory===undefined?'Unknown':Math.round(row.inventory)+' days',91,y,9);
  text(stockDate(sc.day0,row.median),115,y,9,true);text(stockDate(sc.day0,row.early)+' to '+stockDate(sc.day0,row.late),115,y+4.5,8);
  y+=13;
 }
 y+=2;text('Decisions for pharmacist review',15,y,14,true);y+=8;
 for(const [i,a] of plan.actions.entries()){
  const approved=s.audit.some(e=>e.hospitalId===id&&e.scenarioId===sc.id&&e.action===a.action&&e.decision==='approved');
  text(String(i+1).padStart(2,'0'),15,y,9,true,'#337e7e');
  y=wrap(a.action+(approved?'  [approved]':''),24,y,176,10,true,2);y=wrap(a.reason,24,y+.6,176,8.5,false,2)+3;
 }
 y=Math.max(y+3,212);text('Purchasing scenario',15,y,12,true);y+=6;
 text(fmtUsd(plan.contract)+' contract  /  '+fmtUsd(plan.crisis)+' emergency purchase  /  '+fmtUsd(plan.crisis-plan.contract)+' price exposure',15,y,10);
 text('Simulated order: '+plan.order+' units. Staff-time assumption: '+plan.staffHours+' hours saved.',15,y+5,8);
 y+=14;text('Evidence and cutoff',15,y,10,true);
 const ids=Array.from(new Set([...(sc.events.find(e=>e.kind==='alert')?.sourceIds??[]),...(s.storms[sc.id]?.storm?.sourceIds??[]),...(plan.drugs[0]?.drug.sourceIds??[]),...(s.sources.filter(src=>/hospital|hifld/i.test(src.name)).map(src=>src.id))]));
 const refs=ids.map(k=>s.sources.find(a=>a.id===k)).filter(x=>x!==undefined).slice(0,3);
 text('Replay clock '+fmtUtc(s.time,true)+(sc.alert?'  |  Alert cutoff '+fmtUtc(sc.alert.cutoff):''),15,y+5,8);
 refs.forEach((ref,i)=>{doc.setFontSize(8);doc.setTextColor('#216568');doc.textWithLink(clean(ref.publisher+' - '+ref.name).slice(0,116),15,y+10+i*4,{url:ref.url});});
 doc.setDrawColor('#bfcfd1');doc.line(15,268,201,268);text('Aggregate planning estimate  /  Rx Radar',15,273,8);text('1 / 1',191,273,8);
 doc.save('Rx-Radar-CMO-'+id+'.pdf');
}

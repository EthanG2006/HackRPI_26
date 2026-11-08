import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeScenario, useApp } from '../store';
import { localHospital, goBeat } from '../presenter/beats';
import { capitalRegionHospitals, hospitalForQuestion } from '../lib/hospitals';
import { cachedAnswer } from '../copilot/actions';
import { supplyOutlook } from '../lab/supplyOutlook';
import { frameSummary } from './frameMetrics';
import { calibrateScenario, amp } from '../sim/realism';
import { runHazard } from '../sim/lab/hazards';
import { HAZARDS } from '../sim/lab/hazardMeta';
import type { Hospital, ScenarioFile } from '../types';
const json=(p:string)=>JSON.parse(readFileSync('web/public/data/'+p,'utf8'));
const hospitals:Hospital[]=json('hospitals.json').hospitals;
const sc:ScenarioFile=json('scenarios/helene.json');
const watertown=hospitals.find(h=>h.name==='Samaritan Medical Center'&&h.city==='Watertown')!;
assert.ok(watertown);
const reordered=[watertown,...hospitals.filter(h=>h!==watertown)];
useApp.setState({hospitals:reordered,hospitalIndex:new Map(reordered.map((h,i)=>[h.id,i])),scenarios:{helene:sc},ready:true});
assert.equal(localHospital()?.id,'samaritan-troy');
goBeat(4);
assert.equal(useApp.getState().selectedHospitalId,'samaritan-troy');
assert.equal(useApp.getState().rightPanel,'hospital');
assert.ok(Math.abs(useApp.getState().camera!.latitude-42.7333)<.01);
assert.equal(hospitalForQuestion(hospitals,'Open Samaritan in Troy')?.id,'samaritan-troy');
assert.equal(hospitalForQuestion(hospitals,'Open Samaritan Medical Center in Watertown')?.id,watertown.id);
assert.equal(cachedAnswer('Open Samaritan Hospital in Troy').tools[0]?.input.id,'samaritan-troy');
assert.equal(cachedAnswer('Open Samaritan Medical Center in Watertown').tools[0]?.input.id,watertown.id);
assert.deepEqual(capitalRegionHospitals(hospitals).map(h=>h.id),['samaritan-troy','albany-medical-center']);
const noTroy=hospitals.filter(h=>h.id!=='samaritan-troy');
useApp.setState({hospitals:noTroy});assert.equal(localHospital()?.id,'albany-medical-center');
const fps=frameSummary(Array.from({length:600},(_,i)=>i*1000/60),10000);
assert.equal(fps.fps,60);assert.ok(fps.p95Ms<17);assert.equal(fps.gapsOver33Ms,0);
assert.equal(frameSummary([],10000).fps,0);
useApp.setState({hospitals});
const result={outages:[],drugRisk:[],hospitalStockouts:{},members:1000,elapsedMs:50,engine:'browser'} as any;
useApp.setState({scenarioId:'whatif',whatif:{...useApp.getState().whatif,result}});
const view=activeScenario(useApp.getState());
useApp.getState().setWhatIf({hour:2,labPlaying:true});
assert.equal(activeScenario(useApp.getState()),view,'Playback must reuse the unchanged scenario projection');
console.log('Passed hospital identity, presenter beat 4, copilot disambiguation and frame-statistic regressions.');

const overlap={...result,hospitalStockouts:{saline:{p10:[2,3,999],p50:[5,8,999],p90:[10,12,999]},ringer:{p10:[2,2,1],p50:[6,999,9],p90:[8,999,11]}},drugRisk:[{drugId:'saline',hospitalsAtRisk:2,risk:.8},{drugId:'ringer',hospitalsAtRisk:2,risk:.5}],plantHazards:[{windKt:[30,40,60],rainIn:[1,2,3],pDisrupt:.1}]} as any;
const outlook=supplyOutlook(overlap,hospitals.slice(0,3));
assert.equal(outlook.hospitals,3,'Overlapping medicine shortages count a hospital only once');
assert.equal(outlook.medicines,2);assert.equal(outlook.first,5);assert.equal(outlook.exposed,1);
assert.equal(supplyOutlook({...overlap,hospitalStockouts:{},plantHazards:[]},[]).hospitals,0);
goBeat(6);assert.equal(useApp.getState().whatif.fixes,null);assert.equal(useApp.getState().whatif.presetId,'syn-pr');assert.equal(useApp.getState().whatif.lab.vmaxKt,130);
console.log('Passed supply-impact deduplication and reproducible storm-preset checks.');

assert.equal(outlook.downsideHospitals,3);assert.equal(outlook.downsideMedicines,2);
const centralSafe={...overlap,hospitalStockouts:{saline:{p10:[2,3,999],p50:[999,999,999],p90:[999,999,999]}},drugRisk:[{drugId:'saline',risk:.4,hospitalsAtRisk:0}]};
const downside=supplyOutlook(centralSafe,hospitals.slice(0,3));assert.equal(downside.hospitals,0);assert.equal(downside.downsideHospitals,2);assert.equal(downside.first,2);
assert.equal(downside.hospital?.id,hospitals[0].id);
console.log('Passed central versus downside supply-outlook checks.');

goBeat(5);assert.equal(useApp.getState().layers.storm,false);
goBeat(2);assert.equal(useApp.getState().layers.storm,true);assert.equal(useApp.getState().layers.wind,true);assert.equal(useApp.getState().layers.svi,false);
console.log('Passed presenter transitions between supply sharing and the storm replay.');

// Realism calibration: never falls before impact, confirmed at impact, alert well above the archived 52%.
const drugsFile = json('drugs.json');
const cal = calibrateScenario(sc, new Map(drugsFile.map((d: { id: string; baselineRisk: number }) => [d.id, d.baselineRisk])));
assert.equal(amp(0), 0); assert.ok(amp(.2) < amp(.5) && amp(.5) < amp(.8));
assert.equal(cal.predictionSnapshots!.at(-1)!.outages[0].pDisrupt, 1);
assert.ok(cal.alert!.prob > .85);
const cove = cal.hazard.filter(h => h.plantId === 'baxter-north-cove').map(h => h.p);
assert.ok(cove.every((p, i) => !i || p >= cove[i - 1]) && cove.at(-1) === 1);
console.log('Passed replay realism calibration checks.');

// Every disaster type's first preset runs and threatens at least one plant.
for (const kind of ['earthquake', 'wildfire', 'flood', 'tornado', 'winter'] as const) {
  const p = HAZARDS[kind].presets[0];
  const r = runHazard({ req: { track: p.track, category: 3, forwardSpeedKt: 10, members: 200, hazard: { kind, intensity: p.intensity, extent: p.extent, durationH: p.durationH } },
    plants: json('plants.json'), drugs: drugsFile, hospitals: hospitals.slice(0, 200), phys: {} as never, errors: {} as never, terrain: {} as never });
  assert.equal(r.hazardKind, kind);
  assert.ok(r.plantHazards!.some(h => h.pDisrupt > .3), `${kind} preset should threaten a plant`);
  assert.equal(r.hazardSnapshots!.length, r.series!.hours.length);
}
console.log('Passed earthquake, wildfire, flood, tornado and ice-storm engine checks.');

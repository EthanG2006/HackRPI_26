import { useApp } from '../store';
import type { ScenarioId } from '../types';

export const beats = [
  ['Orbital view', 'Open on Earth. Introduce weather as an early signal for hospital pharmacy teams.'],
  ['Helene replay', 'Follow the advisory clock. The map reveals each weather product only after its issue time.'],
  ['Pharmacy alert', 'Read the information cutoff and compare it with the documented disruption date.'],
  ['Local hospital', 'Open the Capital Region forecast, review the uncertainty, and export the CMO briefing.'],
  ['Equity lab', 'Compare market allocation and fair allocation. Move the equity weight and watch the hospitals.'],
  ['What-if storm', 'Draw another path or change the storm category, then run the ensemble.'],
  ['Ask Rx Radar', 'Ask which children’s hospitals in the Southeast run out of IV fluids first.'],
  ['Impact', 'Open each estimate to inspect the assumptions behind the projected benefit.'],
] as const;

export function switchScenario(id: ScenarioId) {
  const s = useApp.getState();
  const sc = s.scenarios[id];
  s.set({ scenarioId: id, introDone: true, beat: 0, time: sc ? Date.parse(sc.start) : Date.now(),
    playing: false, alertFiredAt: null, shockwaveAt: null, selectedDrugId: null,
    selectedPlantId: null, selectedHospitalId: null, highlight: null, equityOpen: false, abmPlaying: false,
    copilotOpen: false, page: null, paletteOpen: false, rightPanel: id === 'whatif' ? 'whatif' : 'drugs',
    camera: sc?.camera ?? { longitude: -86, latitude: 30, zoom: 3.5, duration: 800 } });
  s.setWhatIf({drawing: false});
}

export function localHospital() {
  const list = useApp.getState().hospitals;
  return list.find(h => /samaritan hospital/i.test(h.name) && /troy/i.test(h.city)) ??
    list.find(h => /albany medical center/i.test(h.name));
}

export function goBeat(n: number) {
  const s = useApp.getState();
  if (n <= 1) {
    switchScenario('helene');
    s.set({ beat: 1, introDone: false, playing: false, notesOpen: false });
    return;
  }
  switchScenario(n === 6 ? 'whatif' : 'helene');
  const sc = s.scenarios.helene;
  s.set({beat: n});
  if (n === 2) {
    s.set({playing: true, speed: 16});
  } else if (n === 3 && sc?.alert) {
    const plant = s.plants.find(p => p.id === sc.alert?.plantId);
    s.set({time: Date.parse(sc.alert.t), selectedPlantId: sc.alert.plantId});
    s.setLayers({storm: true, rain: true, network: true, hospitals: true, plants: true});
    if (plant) s.flyTo({longitude: plant.lon, latitude: plant.lat, zoom: 5.4, duration: 1200});
    s.fireAlert();
  } else if (n === 4) {
    if (sc?.alert) s.setTime(Date.parse(sc.alert.t));
    const h = localHospital();
    if (h) s.openHospital(h.id);
  } else if (n === 5) {
    s.set({equityOpen: true, rightPanel: 'equity', equityAutoplayAt: performance.now(), policy: 'market', abmDay: 0,
      camera: {longitude: -88, latitude: 36, zoom: 4.15, duration: 900}});
    s.setLayers({hospitals: true, svi: true});
  } else if (n === 6) {
    s.setWhatIf({track: [[-60,15],[-64.5,16.8],[-66.7,18.3],[-69,20.4]], category:4, forwardSpeedKt:12, drawing:false, result:null});
    s.set({whatifRunAt: performance.now(), camera:{longitude:-67,latitude:19,zoom:4.8,duration:850}});
  } else if (n === 7) {
    if (sc?.alert) s.setTime(Date.parse(sc.alert.t));
    s.set({copilotOpen:true, copilotAsk:{text:"Which children's hospitals in the Southeast run out of IV fluids first?",at:performance.now()}});
  } else if (n === 8) {
    if (sc) s.setTime(Date.parse(sc.end));
    s.set({page:'impact'});
  }
}

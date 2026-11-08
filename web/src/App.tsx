import { useEffect } from 'react';
// App shell. Each region is owned by one teammate (see docs/CONTRACTS.md); keep this file thin.
import { useReplayClock } from './lib/clock';
import MapView from './map/MapView';
import LayerLegend from './map/LayerLegend';
import WhatIfPanel from './map/WhatIfPanel';
import LogisticsPanel from './logistics/LogisticsPanel';
import GlobeIntro from './intro/GlobeIntro';
import TopBar from './panels/TopBar';
import RightPanel from './panels/RightPanel';
import ImpactCounters from './panels/ImpactCounters';
import AlertToast from './panels/AlertToast';
import Timeline from './timeline/Timeline';
import PageModal from './pages/PageModal';
import CommandPalette from './presenter/CommandPalette';
import PresenterNotes from './presenter/PresenterNotes';
import { usePresenterKeys } from './presenter/usePresenterKeys';
import EquityLab from './equity/EquityLab';
import CopilotDrawer from './copilot/CopilotDrawer';
import { useLiveScenario } from './sim/live';
import { useActiveScenario, useApp } from './store';
import './workspace.css';
import './calm.css';
import './demo-flow.css';
import './ui/clouds.css'; // theme layer: loads last so it can tint the base styles
import PlaybackCheck from './verification/PlaybackCheck';
const verifyPlayback = new URLSearchParams(location.search).has('verify');

export default function App() {
  useReplayClock();
  useLiveScenario();
  usePresenterKeys();
  const panel=useApp(s=>s.rightPanel),introDone=useApp(s=>s.introDone);
  useEffect(()=>{if(introDone&&window.innerWidth<=800)document.documentElement.classList.add('show-rail');},[introDone,panel]);
  const lab = useApp((s) => s.scenarioId === 'whatif');
  const impact = useActiveScenario()?.impact;
  // The impact strip only takes space once it has something to say; the Storm Lab has its own playback.
  const quietImpact = !impact || (impact.patientsProtected <= 0 && impact.dollarsSaved <= 0);
  return (
    <div className={`rx-app relative h-full w-full overflow-hidden bg-ink-950 text-fg${lab ? ' lab-mode' : quietImpact ? ' impact-quiet' : ''}`}>
      <MapView />
      <TopBar />
      <LayerLegend />
      <RightPanel />
      <EquityLab />
      <WhatIfPanel />
      <LogisticsPanel />
      <ImpactCounters />
      <Timeline />
      <AlertToast />
      <CopilotDrawer />
      <PageModal />
      <CommandPalette />
      <PresenterNotes />
      <GlobeIntro />
      {verifyPlayback && <PlaybackCheck />}
    </div>
  );
}

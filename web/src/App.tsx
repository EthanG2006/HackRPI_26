// App shell. Each region is owned by one teammate (see docs/CONTRACTS.md); keep this file thin.
import { useReplayClock } from './lib/clock';
import MapView from './map/MapView';
import LayerLegend from './map/LayerLegend';
import WhatIfPanel from './map/WhatIfPanel';
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
import './workspace.css';

export default function App() {
  useReplayClock();
  useLiveScenario();
  usePresenterKeys();
  return (
    <div className="relative h-full w-full overflow-hidden bg-ink-950 text-fg">
      <MapView />
      <TopBar />
      <LayerLegend />
      <RightPanel />
      <EquityLab />
      <WhatIfPanel />
      <ImpactCounters />
      <Timeline />
      <AlertToast />
      <CopilotDrawer />
      <PageModal />
      <CommandPalette />
      <PresenterNotes />
      <GlobeIntro />
    </div>
  );
}

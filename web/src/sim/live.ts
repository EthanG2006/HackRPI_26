import { useEffect } from 'react';
import { useApp } from '../store';
import type { ScenarioFile, LiveSnapshot } from '../types';

export function useLiveScenario() {
  const active=useApp(s=>s.scenarioId==='live' && s.ready);
  const online=useApp(s=>s.api.online);
  useEffect(()=>{
    if(!active) return;
    let cancelled=false, worker:Worker|undefined, currentJob=0;
    const abort=new AbortController();
    function model(snapshot:LiveSnapshot) {
      worker?.terminate();
      worker=new Worker(new URL('./live.worker.ts',import.meta.url),{type:'module'});
      const job=++currentJob;
      worker.onmessage=(e:MessageEvent<ScenarioFile>)=>{
        if(cancelled || currentJob!==job) return;
        useApp.setState(s=>({live:snapshot,time:Date.parse(snapshot.fetchedAt),scenarios:{...s.scenarios,live:e.data}}));
        worker?.terminate();
      };
      const {hospitals,plants,drugs}=useApp.getState();
      worker.postMessage({snapshot,hospitals,plants,drugs});
    }
    const cached=useApp.getState().live;
    if(cached) model(cached);
    async function refresh(){
      if(!online) return;
      try {
        const res=await fetch('/api/live',{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(6500)])});
        if(!res.ok) return;
        const snapshot:LiveSnapshot=await res.json();
        if(!cancelled && snapshot.fetchedAt && Array.isArray(snapshot.alerts)) model(snapshot);
      } catch { /* The last timestamped snapshot stays available during network loss. */ }
    }
    void refresh();
    const id=setInterval(refresh,180_000);
    return ()=>{cancelled=true;clearInterval(id);abort.abort();worker?.terminate();};
  },[active,online]);
}

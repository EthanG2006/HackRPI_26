import { runEnsemble, type SimulationInput } from './ensemble';
self.onmessage = (e: MessageEvent<SimulationInput>) => {
  try { self.postMessage({result:runEnsemble(e.data)}); }
  catch (err) { self.postMessage({error:err instanceof Error ? err.message : 'Ensemble failed'}); }
};

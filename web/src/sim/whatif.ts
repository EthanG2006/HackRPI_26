import { useApp } from '../store';
import type { WhatIfRequest, WhatIfResult } from '../types';

export function runWhatIfInBrowser(req: WhatIfRequest, signal?:AbortSignal):Promise<WhatIfResult> {
  const {plants,drugs,hospitals}=useApp.getState();
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new DOMException('Cancelled','AbortError'));return;}
    const worker=new Worker(new URL('./whatif.worker.ts',import.meta.url),{type:'module'});
    const cancel=()=>{cleanup();reject(new DOMException('Cancelled','AbortError'));};
    const timer=setTimeout(()=>{cleanup();reject(Error('The ensemble timed out. Try a shorter storm path.'));},15000);
    function cleanup(){clearTimeout(timer);signal?.removeEventListener('abort',cancel);worker.terminate();}
    worker.onmessage=e=>{cleanup();if(e.data.error)reject(Error(e.data.error));else resolve(e.data.result);};
    worker.onerror=e=>{cleanup();reject(Error(e.message));};
    signal?.addEventListener('abort',cancel,{once:true});
    worker.postMessage({req,plants,drugs,hospitals});
  });
}

// Browser what-if engine: one persistent Storm Lab worker. Superseded runs resolve as AbortError.
import { useApp } from '../store';
import type { WhatIfRequest, WhatIfResult } from '../types';

let worker: Worker | null = null;
let sent: unknown[] = [];
let seq = 0;
const pending = new Map<number, { resolve: (r: WhatIfResult) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./lab/lab.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ id: number; result?: WhatIfResult; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.result) p.resolve(e.data.result);
    else p.reject(new Error(e.data.error ?? 'The simulation failed.'));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'The simulation worker crashed.'));
    pending.clear();
    worker?.terminate();
    worker = null;
    sent = [];
  };
  return worker;
}

export function runWhatIfInBrowser(req: WhatIfRequest, signal?: AbortSignal): Promise<WhatIfResult> {
  const w = getWorker();
  const { plants, drugs, hospitals } = useApp.getState();
  if (sent[0] !== plants || sent[1] !== drugs || sent[2] !== hospitals) {
    w.postMessage({ type: 'catalog', plants, drugs, hospitals });
    sent = [plants, drugs, hospitals];
  }
  const id = ++seq;
  // A newer request supersedes older ones: their results would be stale, so reject them now.
  for (const [k, p] of pending) if (k < id) { pending.delete(k); p.reject(new DOMException('Superseded', 'AbortError')); }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
    pending.set(id, { resolve, reject });
    signal?.addEventListener('abort', () => { if (pending.delete(id)) reject(new DOMException('Cancelled', 'AbortError')); }, { once: true });
    w.postMessage({ type: 'run', id, req, base: import.meta.env.BASE_URL });
  });
}

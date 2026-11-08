import { simulateEquity, type AllocationInputs } from './allocate';
self.onmessage = (e: MessageEvent<AllocationInputs>) => self.postMessage(simulateEquity(e.data));

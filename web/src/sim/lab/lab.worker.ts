// Storm Lab worker: caches the catalog, terrain and physics constants; runs one simulation per request.
import { runLab } from './run';
import { loadTerrain } from './terrain';
import { DEFAULT_ERRORS, physFrom } from './params';
import type { Drug, HazardModelFile, Hospital, NhcErrorsFile, ParamEntry, Plant, WhatIfRequest, WhatIfResult } from '../../types';

const ctx = self as unknown as { postMessage: (m: unknown, t?: Transferable[]) => void; onmessage: ((e: MessageEvent) => void) | null };
let catalog: { plants: Plant[]; drugs: Drug[]; hospitals: Hospital[] } = { plants: [], drugs: [], hospitals: [] };
let consts: Promise<{ phys: ReturnType<typeof physFrom>; errors: typeof DEFAULT_ERRORS; coef: { order: string[]; samples: number[][] } | null }> | null = null;

async function json<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

function loadConsts(base: string) {
  consts ??= Promise.all([
    json<ParamEntry[]>(`${base}data/model/physics_params.json`),
    json<NhcErrorsFile>(`${base}data/model/nhc_errors.json`),
    json<HazardModelFile>(`${base}data/model/hazard_model.json`),
  ]).then(([params, errors, hazard]) => ({
    phys: physFrom(params),
    errors: errors?.coneRadiusNm?.length === errors?.leadHours?.length && errors?.intensityErrorKt?.length === errors?.leadHours?.length ? errors! : DEFAULT_ERRORS,
    coef: hazard?.featureOrder && hazard.samples ? { order: hazard.featureOrder, samples: hazard.samples } : null,
  }));
  return consts;
}

function buffers(r: WhatIfResult): Transferable[] {
  const out: ArrayBuffer[] = [];
  for (const g of Object.values(r.fields ?? {})) if (g) out.push(g.values.buffer as ArrayBuffer);
  for (const s of [...(r.rainSnapshots ?? []), ...(r.windSnapshots ?? [])]) out.push(s.values.buffer as ArrayBuffer);
  return [...new Set(out)];
}

ctx.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { type: 'catalog'; plants: Plant[]; drugs: Drug[]; hospitals: Hospital[] } | { type: 'run'; id: number; req: WhatIfRequest; base: string };
  if (msg.type === 'catalog') {
    catalog = { plants: msg.plants, drugs: msg.drugs, hospitals: msg.hospitals };
    return;
  }
  try {
    const [terrain, c] = await Promise.all([loadTerrain(msg.base), loadConsts(msg.base)]);
    const result = runLab({ req: msg.req, ...catalog, ...c, terrain });
    ctx.postMessage({ id: msg.id, result }, buffers(result));
  } catch (err) {
    ctx.postMessage({ id: msg.id, error: (err as Error).message || 'The simulation failed.' });
  }
};

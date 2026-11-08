export type FrameChannel = 'raf' | 'map' | 'effects';
let work: Record<string, number[]> | null = null;
export function recordWork(key: string, ms: number) { if(work) (work[key] ??= []).push(ms); }
export function workSummary() { const result = Object.fromEntries(Object.entries(work ?? {}).map(([k,v])=>[k,{calls:v.length,totalMs:Math.round(v.reduce((a,b)=>a+b,0)),maxMs:+Math.max(...v).toFixed(2)}]));work=null;return result; }
let capture: Partial<Record<FrameChannel, number[]>> | null = null;
export function recordFrame(channel: FrameChannel, now: number) { capture?.[channel]?.push(now); }
export function beginFrames() { capture = {raf: [], map: [], effects: []}; work={}; }
export function endFrames() { const result = capture; capture = null; return result; }
export function frameSummary(stamps: number[], durationMs: number) {
  const gaps = stamps.slice(1).map((n, i) => n - stamps[i]).sort((a,b) => a-b);
  const q = (p: number) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] ?? 0;
  return { frames: stamps.length, fps: +(stamps.length * 1000 / durationMs).toFixed(1),
    p50Ms: +q(.5).toFixed(2), p95Ms: +q(.95).toFixed(2), p99Ms: +q(.99).toFixed(2),
    maxMs: +(gaps.at(-1) ?? 0).toFixed(2), gapsOver33Ms: gaps.filter(n => n > 33.4).length };
}

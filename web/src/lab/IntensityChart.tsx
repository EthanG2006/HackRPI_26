// Ensemble intensity: P10–P90 band, median line, land shading, landfall marks and the playback cursor.
import { useMemo } from 'react';
import { area, line } from 'd3-shape';
import { scaleLinear } from 'd3-scale';
import type { LabSeries } from '../types';

const W = 392, H = 150, M = { l: 30, r: 8, t: 10, b: 22 };
const CAT_LINES = [64, 96, 113, 137];

export default function IntensityChart({ s, hour, onScrub }: { s: LabSeries; hour: number | null; onScrub?: (h: number) => void }) {
  const { x, y, band, mid, ctl, landRuns, ticks } = useMemo(() => {
    const hMax = s.hours[s.hours.length - 1] || 1;
    const x = scaleLinear().domain([0, hMax]).range([M.l, W - M.r]);
    const y = scaleLinear().domain([0, Math.max(140, ...s.vmax.p90, ...(s.ctrl ?? [])) + 10]).range([H - M.b, M.t]);
    const idx = s.hours.map((_, i) => i);
    const band = area<number>().x((i) => x(s.hours[i])).y0((i) => y(s.vmax.p10[i])).y1((i) => y(s.vmax.p90[i]))(idx) ?? '';
    const mid = line<number>().x((i) => x(s.hours[i])).y((i) => y(s.vmax.p50[i]))(idx) ?? '';
    const ctl = s.ctrl ? line<number>().x((i) => x(s.hours[i])).y((i) => y(s.ctrl[i]))(idx) ?? '' : '';
    const landRuns: [number, number][] = [];
    s.land.forEach((l, i) => { if (l && (i === 0 || !s.land[i - 1])) landRuns.push([s.hours[i], s.hours[i]]); if (l) landRuns[landRuns.length - 1][1] = s.hours[i]; });
    const step = hMax > 150 ? 48 : 24;
    const ticks = Array.from({ length: Math.floor(hMax / step) + 1 }, (_, k) => k * step);
    return { x, y, band, mid, ctl, landRuns, ticks };
  }, [s]);
  const label = (h: number) => {
    if (!s.startTime) return `+${h} h`;
    const d = new Date(Date.parse(s.startTime) + h * 3.6e6);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  return (
    <svg className="sl-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Ensemble intensity over time"
      onPointerMove={(e) => { if (!onScrub || !(e.buttons & 1)) return; const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); onScrub(Math.max(0, Math.round(x.invert(((e.clientX - r.left) / r.width) * W)))); }}
      onPointerDown={(e) => { if (!onScrub) return; const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); onScrub(Math.max(0, Math.round(x.invert(((e.clientX - r.left) / r.width) * W)))); }}>
      {landRuns.map(([a, b], i) => <rect key={i} className="sl-chart-land" x={x(a)} width={Math.max(1, x(b) - x(a))} y={M.t} height={H - M.t - M.b} />)}
      {CAT_LINES.filter((v) => v < y.domain()[1]).map((v) => (
        <g key={v}><line className="sl-chart-grid" x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} /><text className="sl-chart-axis" x={M.l - 4} y={y(v) + 3} textAnchor="end">{v}</text></g>
      ))}
      <path className="sl-chart-band" d={band} />
      <path className="sl-chart-line" d={mid} />
      {ctl && <path className="sl-chart-ctrl" d={ctl} />}
      {s.landfalls.map((l) => <g key={l.hour}><line className="sl-chart-landfall" x1={x(l.hour)} x2={x(l.hour)} y1={M.t} y2={H - M.b} /><text className="sl-chart-note" x={x(l.hour) + 3} y={M.t + 9}>landfall</text></g>)}
      {ticks.map((t) => <text key={t} className="sl-chart-axis" x={x(t)} y={H - 6} textAnchor="middle">{label(t)}</text>)}
      {hour !== null && <line className="sl-chart-cursor" x1={x(hour)} x2={x(hour)} y1={M.t} y2={H - M.b} />}
      <text className="sl-chart-axis" x={M.l} y={M.t - 1}>kt</text>
    </svg>
  );
}

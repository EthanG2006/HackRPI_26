// Provenance badge: REAL / REPLAY / MODEL / SIMULATED. A feature, not a disclaimer.
// Distinguished by glyph + border style + label (never color alone).
import { useApp } from '../store';
import type { Provenance } from '../types';

const STYLE: Record<Provenance, { glyph: string; label: string; color: string; border: string; tip: string }> = {
  REAL: { glyph: '●', label: 'REAL', color: '#5be49b', border: 'solid', tip: 'Published or measured data' },
  REPLAY: { glyph: '↺', label: 'REPLAY', color: '#38d6ff', border: 'solid', tip: 'Archived product, replayed at its original issue time' },
  MODEL: { glyph: '≈', label: 'MODEL', color: '#e8eef8', border: 'dashed', tip: 'Rx Radar model estimate, with uncertainty' },
  SIMULATED: { glyph: '◇', label: 'SIMULATED', color: '#a9b8cf', border: 'dotted', tip: 'Synthetic stand-in where public data does not exist' },
};

export function Prov({ kind, sourceIds, compact = false }: { kind: Provenance; sourceIds?: string[]; compact?: boolean }) {
  const s = STYLE[kind] ?? STYLE.SIMULATED;
  const sources = useApp((st) => st.sources);
  const names = (sourceIds ?? []).map((id) => sources.find((x) => x.id === id)?.name ?? id);
  const title = `${s.label}: ${s.tip}${names.length ? `\nSources: ${names.join('; ')}` : ''}`;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        useApp.getState().set({ page: 'sources' });
      }}
      className="num inline-flex shrink-0 items-center gap-1 rounded-[4px] px-1.5 align-middle leading-[18px] hover:brightness-125"
      style={{
        color: s.color,
        border: `1px ${s.border} color-mix(in oklab, ${s.color} 55%, transparent)`,
        background: `color-mix(in oklab, ${s.color} 9%, transparent)`,
        fontSize: compact ? 9.5 : 10.5,
        fontWeight: 600,
        letterSpacing: '0.06em',
        height: compact ? 16 : 19,
      }}
    >
      <span aria-hidden>{s.glyph}</span>
      {!compact && s.label}
    </button>
  );
}

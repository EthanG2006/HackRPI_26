// Soft clouds drifting across the view (HackRPI 2026 "In the Clouds"). Pure CSS: transforms only, no repaint.

// [top %, width px, seconds to cross, start offset 0..1, opacity]
const MAP: [number, number, number, number, number][] = [[8, 520, 150, 0.1, 0.11], [34, 760, 210, 0.55, 0.08], [62, 600, 180, 0.3, 0.1], [80, 900, 240, 0.8, 0.07], [20, 420, 130, 0.9, 0.1]];
const INTRO: [number, number, number, number, number][] = [[60, 900, 120, 0.05, 0.42], [72, 1200, 160, 0.45, 0.5], [66, 760, 100, 0.75, 0.36], [80, 1400, 190, 0.25, 0.55], [50, 560, 90, 0.6, 0.26]];

export default function CloudSky({ variant }: { variant: 'map' | 'intro' }) {
  const rows = variant === 'map' ? MAP : INTRO;
  return (
    <div className={`cloud-sky cloud-sky-${variant}`} aria-hidden="true">
      {rows.map(([top, w, dur, start, o], i) => (
        <i key={i} className="cloud" style={{ top: `${top}%`, width: w, height: w * 0.36, opacity: o, animationDuration: `${dur}s`, animationDelay: `${-start * dur}s` }} />
      ))}
    </div>
  );
}

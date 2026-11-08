// Small, calm form controls for the Storm Lab.
import { useId, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

export function Section({ title, summary, children, open: initial = false }: { title: string; summary?: ReactNode; children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  const id = useId();
  return (
    <section className={`sl-section${open ? ' open' : ''}`}>
      <button className="sl-section-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span>{title}</span>
        {!open && summary && <small className="num">{summary}</small>}
        <ChevronDown size={15} className="sl-chevron" aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div id={id} key="body" className="sl-section-body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ height: { type: 'spring', stiffness: 320, damping: 34 }, opacity: { duration: 0.18 } }}>
            <div className="sl-section-inner">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  hint?: string;
  disabled?: boolean;
  /** Model-derived parameter: null value means "Auto" and shows `autoValue`. */
  auto?: { on: boolean; autoValue?: number; set: (on: boolean) => void; source: string };
}

export function Slider({ label, value, min, max, step, unit, format, onChange, hint, disabled, auto }: SliderProps) {
  const id = useId();
  const isAuto = auto?.on ?? false;
  const shown = isAuto ? auto?.autoValue : value;
  const fmt = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '—' : format ? format(v) : `${v}`);
  const pct = ((Math.min(max, Math.max(min, shown ?? value)) - min) / (max - min)) * 100;
  return (
    <div className={`sl-slider${isAuto ? ' is-auto' : ''}${disabled ? ' is-disabled' : ''}`}>
      <div className="sl-slider-top">
        <label htmlFor={id}>{label}</label>
        <span className="sl-slider-value num">
          {fmt(shown)}
          {unit && <small>{unit}</small>}
        </span>
        {auto && (
          <button type="button" className={`sl-auto${isAuto ? ' on' : ''}`} aria-pressed={isAuto} title={isAuto ? `Auto: ${auto.source}. Click to set by hand.` : `Return to ${auto.source}`} onClick={() => auto.set(!isAuto)}>
            Auto
          </button>
        )}
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={shown ?? value} disabled={disabled || isAuto} style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))} aria-describedby={hint ? `${id}-hint` : undefined} />
      {hint && <p id={`${id}-hint`} className="sl-hint">{isAuto && auto ? `Auto · ${auto.source}` : hint}</p>}
    </div>
  );
}

export function Segmented<T extends string | number>({ label, value, options, onChange }: { label?: string; value: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="sl-field">
      {label && <span className="sl-field-label">{label}</span>}
      <div className="sl-segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={String(o.value)} role="radio" aria-checked={o.value === value} title={o.title} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="sl-toggle">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden />
    </label>
  );
}

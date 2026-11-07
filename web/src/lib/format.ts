// Number and time formatting. Figures render in the mono font via the `.num` class.

export const fmtInt = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—');

export function fmtCompact(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(digits)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(digits)}K`;
  return fmtInt(n);
}

export const fmtUsd = (n: number) => (Number.isFinite(n) ? `$${fmtCompact(n)}` : '—');
export const fmtPct = (p: number, digits = 0) => (Number.isFinite(p) ? `${(p * 100).toFixed(digits)}%` : '—');

/** "Sep 26, 23:00 UTC" — replay times are always shown in UTC with the zone named. */
export function fmtUtc(t: number | string, withYear = false): string {
  const d = typeof t === 'string' ? new Date(t) : new Date(t);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  return `${date}, ${time} UTC`;
}

export function fmtDate(t: number | string): string {
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

/** Day index from day0 -> Date (UTC midnight-aligned display). */
export const dayToDate = (day0: string, day: number) => new Date(Date.parse(day0) + day * DAY_MS);

export function fmtDays(days: number): string {
  if (!Number.isFinite(days) || days >= 999) return 'none in 90 d';
  if (days < 1) return '< 1 day';
  return `${Math.round(days)} d`;
}

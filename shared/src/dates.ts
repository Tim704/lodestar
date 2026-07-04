// Day-granular date-string helpers (YYYY-MM-DD). Zero-padded ISO dates compare
// lexically in chronological order, so plain string comparison is used
// throughout — ported from Whenabouts src/server/lib/dates.ts, luxon-free.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_RANGE_DAYS = 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isValidDateStr(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

export function toDateStr(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysStr(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return toDateStr(new Date(Date.UTC(y, m - 1, d) + days * MS_PER_DAY));
}

/**
 * Inclusive list of "YYYY-MM-DD" dates from start..end. Returns [] if
 * start > end. Capped at MAX_RANGE_DAYS for safety.
 */
export function eachDate(start: string, end: string): string[] {
  if (!isValidDateStr(start) || !isValidDateStr(end)) {
    throw new Error('eachDate: invalid date');
  }
  const out: string[] = [];
  let cur = start;
  while (cur <= end && out.length < MAX_RANGE_DAYS) {
    out.push(cur);
    cur = addDaysStr(cur, 1);
  }
  return out;
}

/** Lexical comparison is chronological for zero-padded ISO dates. */
export function dateInRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD), can be negative. */
export function diffDays(from: string, to: string): number {
  const p = (s: string) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((p(to) - p(from)) / MS_PER_DAY);
}

/** Day of week for a date string: 0=Sunday … 6=Saturday (JS getDay()). */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Monday of the ISO week containing `date` (weeks are Mon..Sun — §4.5b/§4.3). */
export function mondayOf(date: string): string {
  return addDaysStr(date, -((weekdayOf(date) + 6) % 7));
}

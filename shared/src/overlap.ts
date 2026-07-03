// Find-a-date overlap engine — ported from Whenabouts src/server/lib/dates.ts
// (CONTRACT §4.4). Day-granular; explicit availability beats inferred
// term/break data; only 'free' (never 'maybe') counts toward a window.

import { dateInRange, eachDate } from './dates.js';

export type DayStatus = 'free' | 'maybe' | 'busy' | 'unknown';

export interface AvailabilityPeriod {
  user_id: string;
  status: 'free' | 'busy' | 'maybe';
  start_date: string;
  end_date: string;
}

export interface TermPeriod {
  user_id: string;
  kind: 'term' | 'break';
  start_date: string;
  end_date: string;
}

export interface OverlapDay {
  date: string;
  free: string[];
  maybe: string[];
  busy: string[];
  unknown: string[];
}

export interface OverlapWindow {
  start_date: string;
  end_date: string;
  length: number;
  free_user_ids: string[];
  free_count: number;
}

export interface OverlapResult {
  start_date: string;
  end_date: string;
  min_people: number;
  only_on_break: boolean;
  user_ids: string[];
  days: OverlapDay[];
  windows: OverlapWindow[];
}

interface ClassifyArgs {
  hasBusy: boolean;
  hasFree: boolean;
  hasMaybe: boolean;
  inBreak: boolean;
  inTerm: boolean;
  onlyOnBreak: boolean;
}

/**
 * Decide a single person's status for a single day — verbatim port.
 *
 * Precedence: busy > explicit free > explicit maybe > term/break inference.
 * With onlyOnBreak OFF, no availability data => 'unknown' (never assume free).
 * With onlyOnBreak ON, no explicit data => break ⇒ free, term ⇒ busy.
 */
export function classifyDay(a: ClassifyArgs): DayStatus {
  if (a.hasBusy) return 'busy';
  if (a.hasFree) return 'free';
  if (a.hasMaybe) return 'maybe';
  if (a.onlyOnBreak) {
    if (a.inBreak) return 'free';
    if (a.inTerm) return 'busy';
  }
  return 'unknown';
}

export interface OverlapInput {
  userIds: string[];
  availability: AvailabilityPeriod[];
  terms: TermPeriod[];
  startDate: string;
  endDate: string;
  minPeople: number;
  onlyOnBreak: boolean;
}

export function computeOverlap(input: OverlapInput): OverlapResult {
  const dates = eachDate(input.startDate, input.endDate);
  const minPeople = Math.max(1, Math.floor(input.minPeople) || 1);

  const availByUser = new Map<string, AvailabilityPeriod[]>();
  for (const p of input.availability) {
    if (!availByUser.has(p.user_id)) availByUser.set(p.user_id, []);
    availByUser.get(p.user_id)!.push(p);
  }
  const termsByUser = new Map<string, TermPeriod[]>();
  for (const t of input.terms) {
    if (!termsByUser.has(t.user_id)) termsByUser.set(t.user_id, []);
    termsByUser.get(t.user_id)!.push(t);
  }

  const days: OverlapDay[] = dates.map((date) => {
    const day: OverlapDay = { date, free: [], maybe: [], busy: [], unknown: [] };
    for (const uid of input.userIds) {
      let hasBusy = false;
      let hasFree = false;
      let hasMaybe = false;
      for (const p of availByUser.get(uid) ?? []) {
        if (!dateInRange(date, p.start_date, p.end_date)) continue;
        if (p.status === 'busy') hasBusy = true;
        else if (p.status === 'free') hasFree = true;
        else if (p.status === 'maybe') hasMaybe = true;
      }
      let inBreak = false;
      let inTerm = false;
      for (const t of termsByUser.get(uid) ?? []) {
        if (!dateInRange(date, t.start_date, t.end_date)) continue;
        if (t.kind === 'break') inBreak = true;
        else if (t.kind === 'term') inTerm = true;
      }
      const status = classifyDay({
        hasBusy,
        hasFree,
        hasMaybe,
        inBreak,
        inTerm,
        onlyOnBreak: input.onlyOnBreak,
      });
      day[status].push(uid);
    }
    return day;
  });

  return {
    start_date: input.startDate,
    end_date: input.endDate,
    min_people: minPeople,
    only_on_break: input.onlyOnBreak,
    user_ids: input.userIds,
    days,
    windows: findWindows(days, minPeople),
  };
}

/**
 * Maximal contiguous windows where the SAME set of >= minPeople users are all
 * free across every day (intersection of free sets). Greedy, non-overlapping.
 * Ranked by free_count desc, then length desc, then date asc — verbatim port.
 */
export function findWindows(days: OverlapDay[], minPeople: number): OverlapWindow[] {
  const windows: OverlapWindow[] = [];
  let i = 0;
  while (i < days.length) {
    const dayI = days[i]!;
    if (dayI.free.length < minPeople) {
      i += 1;
      continue;
    }
    let inter = new Set(dayI.free);
    let j = i;
    while (j + 1 < days.length) {
      const next = new Set(days[j + 1]!.free);
      const cand = new Set<string>();
      for (const u of inter) if (next.has(u)) cand.add(u);
      if (cand.size >= minPeople) {
        inter = cand;
        j += 1;
      } else {
        break;
      }
    }
    windows.push({
      start_date: dayI.date,
      end_date: days[j]!.date,
      length: j - i + 1,
      free_user_ids: [...inter].sort(),
      free_count: inter.size,
    });
    i = j + 1;
  }
  windows.sort(
    (a, b) =>
      b.free_count - a.free_count ||
      b.length - a.length ||
      a.start_date.localeCompare(b.start_date),
  );
  return windows;
}

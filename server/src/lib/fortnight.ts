// Fortnight assembly (CONTRACT §4.11) — pure helpers so the day-bucketing
// logic is unit-testable; the route only fetches rows and composes.

import { DateTime } from 'luxon';
import {
  addDaysStr,
  dateInRange,
  getAcademicMultiplier,
  getDeadlineBucket,
  type CalendarEvent,
  type FortnightEvent,
  type FortnightTask,
  type LectureBlock,
} from '@lodestar/shared';

export const FORTNIGHT_DAYS = 14;

/** The 14 consecutive local dates starting at `start`. */
export function fortnightDates(start: string): string[] {
  return Array.from({ length: FORTNIGHT_DAYS }, (_, i) => addDaysStr(start, i));
}

/** A lecture slot joined with its course + semester window. */
export interface SlotRow {
  course_id: string;
  course_name: string;
  color: string | null;
  weekday: number; // 0=Sunday … 6=Saturday
  start_time: string; // HH:MM[:SS]
  end_time: string;
  location: string | null;
  sem_start: string; // YYYY-MM-DD
  sem_end: string;
}

/** §4.6 expansion for one date: weekday matches and the semester covers it. */
export function classesForDate(slots: SlotRow[], date: string, weekday: number): LectureBlock[] {
  return slots
    .filter((s) => s.weekday === weekday && dateInRange(date, s.sem_start, s.sem_end))
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
    .map((s) => ({
      course_id: s.course_id,
      course_name: s.course_name,
      color: s.color,
      start: s.start_time.slice(0, 5),
      end: s.end_time.slice(0, 5),
      location: s.location,
    }));
}

export interface DueTaskRow {
  id: string;
  title: string;
  is_completed: boolean;
  duration_min: number;
  course_id: string | null;
  project_id: string | null;
  due_at: Date | string;
}

/** Bucket tasks by the user-local date of their due_at; buckets per §4.1. */
export function bucketDueTasks(
  rows: DueTaskRow[],
  tz: string,
  now: Date,
): Map<string, FortnightTask[]> {
  const byDate = new Map<string, FortnightTask[]>();
  for (const r of rows) {
    const iso = r.due_at instanceof Date ? r.due_at.toISOString() : r.due_at;
    const local = DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz).toISODate();
    if (!local) continue;
    if (!byDate.has(local)) byDate.set(local, []);
    byDate.get(local)!.push({
      id: r.id,
      title: r.title,
      is_completed: r.is_completed,
      duration_min: r.duration_min,
      course_id: r.course_id,
      project_id: r.project_id,
      deadline_bucket: getDeadlineBucket(iso, now),
    });
  }
  return byDate;
}

/**
 * Bucket visible events by local date: all-day events cover every date of
 * their inclusive range inside the window; timed events land on the local
 * date of start_utc. Each carries the §4.1 is_exam flag.
 */
export function bucketEvents(
  events: CalendarEvent[],
  windowStart: string,
  windowEnd: string,
  tz: string,
): Map<string, FortnightEvent[]> {
  const byDate = new Map<string, FortnightEvent[]>();
  const push = (date: string, e: CalendarEvent) => {
    if (!dateInRange(date, windowStart, windowEnd)) return;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push({ ...e, is_exam: getAcademicMultiplier(e.title) > 1 });
  };

  for (const e of events) {
    if (e.all_day && e.start_date && e.end_date) {
      const from = e.start_date > windowStart ? e.start_date : windowStart;
      const to = e.end_date < windowEnd ? e.end_date : windowEnd;
      for (let d = from; d <= to; d = addDaysStr(d, 1)) push(d, e);
    } else if (!e.all_day && e.start_utc) {
      const local = DateTime.fromISO(e.start_utc, { zone: 'utc' }).setZone(tz).toISODate();
      if (local) push(local, e);
    }
  }
  return byDate;
}

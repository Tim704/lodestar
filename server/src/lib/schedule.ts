// Lecture blocks, gaps between them, and free evening windows — the
// calendar-side inputs to integrations #1, #2 and #5 (CONTRACT §4.6).

import { DateTime } from 'luxon';
import type { GapInfo, LectureBlock } from '@lodestar/shared';
import { query } from '../db.js';

export function nowInTz(tz: string): DateTime {
  const dt = DateTime.now().setZone(tz);
  return dt.isValid ? dt : DateTime.now();
}

export function todayInTz(tz: string): { date: string; weekday: number } {
  const dt = nowInTz(tz);
  // luxon: 1=Monday..7=Sunday → JS getDay(): 0=Sunday..6
  return { date: dt.toISODate()!, weekday: dt.weekday % 7 };
}

const hhmm = (t: string): string => t.slice(0, 5);

export function minutesOf(t: string): number {
  const h = Number(t.slice(0, 2));
  const m = Number(t.slice(3, 5));
  return h * 60 + m;
}

/** The user's lecture blocks on a given local date (active-semester courses only). */
export async function getLectureBlocks(
  userId: string,
  date: string,
  weekday: number,
): Promise<LectureBlock[]> {
  const rows = await query<{
    course_id: string;
    course_name: string;
    color: string | null;
    start_time: string;
    end_time: string;
    location: string | null;
  }>(
    `SELECT c.id AS course_id, c.name AS course_name, c.color,
            ls.start_time::text AS start_time, ls.end_time::text AS end_time, ls.location
     FROM lecture_slots ls
     JOIN courses c ON c.id = ls.course_id
     JOIN semesters s ON s.id = c.semester_id
     WHERE c.user_id = $1 AND ls.weekday = $2
       AND s.start_date <= $3::date AND s.end_date >= $3::date
     ORDER BY ls.start_time`,
    [userId, weekday, date],
  );
  return rows.map((r) => ({
    course_id: r.course_id,
    course_name: r.course_name,
    color: r.color,
    start: hhmm(r.start_time),
    end: hhmm(r.end_time),
    location: r.location,
  }));
}

/** Gaps of 15–240 min between consecutive lecture blocks (CONTRACT §4.6). */
export function computeGaps(blocks: LectureBlock[]): GapInfo[] {
  const gaps: GapInfo[] = [];
  for (let i = 0; i + 1 < blocks.length; i++) {
    const prev = blocks[i]!;
    const next = blocks[i + 1]!;
    const minutes = minutesOf(next.start) - minutesOf(prev.end);
    if (minutes >= 15 && minutes <= 240) {
      gaps.push({
        start: prev.end,
        end: next.start,
        minutes,
        after_course: prev.course_name,
        before_course: next.course_name,
      });
    }
  }
  return gaps;
}

/** A task fits a gap if duration ≤ gap − 5 min; returns the tightest such gap. */
export function fitGap(durationMin: number, gaps: GapInfo[]): GapInfo | null {
  const fitting = gaps.filter((g) => durationMin <= g.minutes - 5);
  if (!fitting.length) return null;
  return fitting.reduce((a, b) => (a.minutes <= b.minutes ? a : b));
}

export async function getTodayGaps(userId: string, tz: string): Promise<GapInfo[]> {
  const { date, weekday } = todayInTz(tz);
  return computeGaps(await getLectureBlocks(userId, date, weekday));
}

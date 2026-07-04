// Habit streak math — ported from water-counter (Mizu) app.js currentStreak()
// (CONTRACT §4.5), plus the v2 weekly-quota layer (§4.5b): weekly progress and
// a weeks-in-a-row streak that survives rest days.

import { addDaysStr, mondayOf } from './dates.js';

/**
 * @param log map of YYYY-MM-DD → count
 * @param target daily target (>= 1)
 * @param todayKey "today" in the user's timezone (callers supply it so this
 *                 stays pure)
 */
export function currentStreak(
  log: Record<string, number>,
  target: number,
  todayKey: string,
): number {
  let streak = 0;
  for (let i = 0; i < 366; i++) {
    const key = addDaysStr(todayKey, -i);
    const count = log[key] ?? 0;
    if (count >= target) streak++;
    else if (i === 0) continue; // today not done yet — don't break the streak
    else break;
  }
  return streak;
}

export interface HabitDayStats {
  streak: number;
  days_met: number;
  best_count: number;
}

export function habitStats(
  log: Record<string, number>,
  target: number,
  todayKey: string,
): HabitDayStats {
  const counts = Object.values(log);
  return {
    streak: currentStreak(log, target, todayKey),
    days_met: counts.filter((c) => c >= target).length,
    best_count: counts.length ? Math.max(...counts) : 0,
  };
}

/** Days in the ISO week starting `weekStart` (a Monday) that met the daily target. */
export function weeklyDoneInWeek(
  log: Record<string, number>,
  targetPerDay: number,
  weekStart: string,
): number {
  let n = 0;
  for (let i = 0; i < 7; i++) {
    if ((log[addDaysStr(weekStart, i)] ?? 0) >= targetPerDay) n++;
  }
  return n;
}

export interface WeeklyHabitStats {
  week_start: string;
  weekly_done: number;
  weeks_streak: number;
}

/**
 * §4.5b — weekly progress + weeks-in-a-row streak. The in-progress current
 * week counts when already met and does NOT break the streak otherwise
 * (mirrors §4.5's "today doesn't break it" rule).
 */
export function weeklyStats(
  log: Record<string, number>,
  targetPerDay: number,
  targetPerWeek: number,
  todayKey: string,
): WeeklyHabitStats {
  const currentMonday = mondayOf(todayKey);
  const weekly_done = weeklyDoneInWeek(log, targetPerDay, currentMonday);

  let weeks_streak = 0;
  for (let w = 0; w < 520; w++) {
    const monday = addDaysStr(currentMonday, -7 * w);
    const met = weeklyDoneInWeek(log, targetPerDay, monday) >= targetPerWeek;
    if (met) weeks_streak++;
    else if (w === 0) continue; // current week still in progress — don't break
    else break;
  }
  return { week_start: currentMonday, weekly_done, weeks_streak };
}

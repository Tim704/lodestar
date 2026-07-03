// Habit streak math — ported from water-counter (Mizu) app.js currentStreak()
// (CONTRACT §4.5). Consecutive days ending today that met the target; today
// not yet met does not break the streak, it just doesn't count.

import { addDaysStr } from './dates.js';

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

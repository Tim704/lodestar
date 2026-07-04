// Focus planner (CONTRACT §4.9) — the deterministic heuristic used when
// Gemini is unconfigured or fails, kept pure so it's unit-testable:
// deadline-ranked assignments first, then behind-pace courses (≤2 each),
// dropped into the week's lecture gaps; a synthesized 18:30 slot per day when
// the week has no gaps at all.

import { DateTime } from 'luxon';
import {
  getDeadlineBucket,
  toEpochMs,
  type DeadlineBucket,
  type FocusPlanSuggestion,
} from '@lodestar/shared';

export interface PlannerTask {
  id: string;
  title: string;
  course_id: string | null;
  due_at: string | null;
  duration_min: number;
  cognitive_load: number;
}

export interface PlannerCourse {
  id: string;
  name: string;
  deficit_hours: number;
  required_velocity: number;
  status: 'on-track' | 'behind';
}

export interface PlannerSlot {
  date: string; // YYYY-MM-DD (user-local)
  start: string; // HH:MM (user-local)
  minutes: number; // usable length of the gap
}

const BUCKET_RANK: Record<DeadlineBucket, number> = {
  overdue: 0,
  lt24h: 1,
  lt48h: 2,
  lt7d: 3,
  none: 4,
};

const MAX_SUGGESTIONS = 8;
const MAX_PER_COURSE = 2;

function toInstant(slot: PlannerSlot, tz: string): string | null {
  const dt = DateTime.fromISO(`${slot.date}T${slot.start}`, { zone: tz });
  return dt.isValid ? dt.toUTC().toISO() : null;
}

export function planFocusHeuristic(args: {
  tasks: PlannerTask[];
  courses: PlannerCourse[];
  slots: PlannerSlot[]; // chronological; empty ⇒ evening slots are synthesized upstream
  tz: string;
  now?: Date;
}): FocusPlanSuggestion[] {
  const now = args.now ?? new Date();

  // §4.9: assignments by deadlineMultiplier bucket, then earliest due
  const rankedTasks = [...args.tasks].sort((a, b) => {
    const byBucket =
      BUCKET_RANK[getDeadlineBucket(a.due_at, now)] - BUCKET_RANK[getDeadlineBucket(b.due_at, now)];
    if (byBucket !== 0) return byBucket;
    const aDue = a.due_at ? toEpochMs(a.due_at) : Infinity;
    const bDue = b.due_at ? toEpochMs(b.due_at) : Infinity;
    return aDue - bDue;
  });

  // then behind courses by deficit desc, cycled
  const behind = args.courses
    .filter((c) => c.status === 'behind')
    .sort((a, b) => b.deficit_hours - a.deficit_hours);

  type Candidate =
    | { kind: 'task'; task: PlannerTask }
    | { kind: 'course'; course: PlannerCourse };
  const candidates: Candidate[] = [
    ...rankedTasks.map((task) => ({ kind: 'task' as const, task })),
  ];
  for (let round = 0; round < MAX_PER_COURSE; round++) {
    for (const course of behind) candidates.push({ kind: 'course', course });
  }

  const perCourse = new Map<string, number>();
  const usedTaskIds = new Set<string>();
  const out: FocusPlanSuggestion[] = [];

  const slots = [...args.slots].filter((s) => s.minutes >= 30);

  for (const slot of slots) {
    if (out.length >= MAX_SUGGESTIONS) break;
    const idx = candidates.findIndex((cand) => {
      if (cand.kind === 'task') return !usedTaskIds.has(cand.task.id);
      const used = perCourse.get(cand.course.id) ?? 0;
      return used < MAX_PER_COURSE;
    });
    if (idx === -1) break;
    const cand = candidates.splice(idx, 1)[0]!;

    if (cand.kind === 'task') {
      usedTaskIds.add(cand.task.id);
      const minutes = Math.max(25, Math.min(cand.task.duration_min, slot.minutes - 5, 60));
      out.push({
        task_id: cand.task.id,
        course_id: cand.task.course_id,
        goal: cand.task.title,
        planned_minutes: minutes,
        scheduled_for: toInstant(slot, args.tz),
        reason: `due ${getDeadlineBucket(cand.task.due_at, now)}`,
      });
    } else {
      perCourse.set(cand.course.id, (perCourse.get(cand.course.id) ?? 0) + 1);
      const minutes = Math.max(25, Math.min(50, slot.minutes - 5, 60));
      out.push({
        task_id: null,
        course_id: cand.course.id,
        goal: `Study ${cand.course.name}: chip away at the ${cand.course.deficit_hours}h deficit`,
        planned_minutes: minutes,
        scheduled_for: toInstant(slot, args.tz),
        reason: `behind pace — needs ${cand.course.required_velocity}h/day`,
      });
    }
  }

  return out;
}

/** §4.9 — one 18:30 / 50-min slot per remaining day when the week has no gaps. */
export function eveningSlots(weekStart: string, todayLocal: string): PlannerSlot[] {
  const out: PlannerSlot[] = [];
  for (let d = 0; d < 7; d++) {
    const date = DateTime.fromISO(weekStart).plus({ days: d }).toISODate()!;
    if (date < todayLocal) continue;
    out.push({ date, start: '18:30', minutes: 55 });
  }
  return out;
}

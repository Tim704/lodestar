// Task priority engine — ported from dynamicTo-Do src/services/priority.service.ts
// (CONTRACT §4.1). The one Lodestar extension is the calendar-aware
// deadlineMultiplier, combined as max(academic, deadline).

export interface ScorableTask {
  id: string;
  title: string;
  importance: number; // 1–10
  cognitive_load: number; // 1–5
  duration_min: number; // >= 1
  created_at: string | Date;
  due_at?: string | Date | null;
  is_completed: boolean;
}

export interface ScoredTask<T extends ScorableTask = ScorableTask> {
  task: T;
  priority_score: number;
  is_starving: boolean;
  urgency_multiplier: number;
  deadline_bucket: DeadlineBucket;
}

export type DeadlineBucket = 'overdue' | 'lt24h' | 'lt48h' | 'lt7d' | 'none';

const MINUTES_TO_MS = 60_000;
const STARVATION_THRESHOLD_MINUTES = 7 * 24 * 60;
export const ACADEMIC_URGENCY_MULTIPLIER = 1.5;
const DEFAULT_URGENCY_MULTIPLIER = 1.0;
export const ACADEMIC_KEYWORDS = [
  'exam',
  'klausur',
  'prüfung',
  'assignment',
  'proof',
  'project',
  'abgabe',
];

export const BETWEEN_LECTURES_MAX_DURATION_MINUTES = 30;
export const BETWEEN_LECTURES_MAX_COGNITIVE_LOAD = 2;

export function toEpochMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/** 1.5 for academically critical task names, else 1.0 — verbatim port. */
export function getAcademicMultiplier(title: string): number {
  const normalized = title.toLowerCase();
  return ACADEMIC_KEYWORDS.some((keyword) => normalized.includes(keyword))
    ? ACADEMIC_URGENCY_MULTIPLIER
    : DEFAULT_URGENCY_MULTIPLIER;
}

export function getDeadlineBucket(
  dueAt: string | Date | null | undefined,
  now: Date,
): DeadlineBucket {
  if (!dueAt) return 'none';
  const msLeft = toEpochMs(dueAt) - now.getTime();
  if (msLeft < 0) return 'overdue';
  const h = msLeft / 3_600_000;
  if (h < 24) return 'lt24h';
  if (h < 48) return 'lt48h';
  if (h < 24 * 7) return 'lt7d';
  return 'none';
}

const DEADLINE_MULTIPLIERS: Record<DeadlineBucket, number> = {
  overdue: 2.0,
  lt24h: 2.0,
  lt48h: 1.7,
  lt7d: 1.3,
  none: 1.0,
};

export function getDeadlineMultiplier(bucket: DeadlineBucket): number {
  return DEADLINE_MULTIPLIERS[bucket];
}

/**
 * S = (importance × cognitive_load / ln(elapsedMinutes + duration_min + 2)) × mult
 *
 * The `+ 2` keeps the logarithm in a safe region even for very recent, short
 * tasks while preserving the intended decay curve. `mult` is
 * max(academicMultiplier, deadlineMultiplier).
 */
export function calculatePriorityScore(task: ScorableTask, now: Date): number {
  const elapsedMinutes = Math.max(
    1,
    (now.getTime() - toEpochMs(task.created_at)) / MINUTES_TO_MS,
  );
  const mult = Math.max(
    getAcademicMultiplier(task.title),
    getDeadlineMultiplier(getDeadlineBucket(task.due_at, now)),
  );
  return (
    ((task.importance * task.cognitive_load) /
      Math.log(elapsedMinutes + task.duration_min + 2)) *
    mult
  );
}

/** Incomplete and ignored for more than seven days. */
export function isTaskStarving(task: ScorableTask, now: Date): boolean {
  if (task.is_completed) return false;
  const elapsedMinutes = Math.max(
    1,
    (now.getTime() - toEpochMs(task.created_at)) / MINUTES_TO_MS,
  );
  return elapsedMinutes > STARVATION_THRESHOLD_MINUTES;
}

/** Score + sort: score desc, created_at asc, id asc — verbatim tie-breakers. */
export function prioritizeTasks<T extends ScorableTask>(
  tasks: readonly T[],
  now: Date = new Date(),
): ScoredTask<T>[] {
  return tasks
    .map((task) => {
      const bucket = getDeadlineBucket(task.due_at, now);
      return {
        task,
        priority_score: calculatePriorityScore(task, now),
        is_starving: isTaskStarving(task, now),
        urgency_multiplier: Math.max(
          getAcademicMultiplier(task.title),
          getDeadlineMultiplier(bucket),
        ),
        deadline_bucket: bucket,
      };
    })
    .sort((a, b) => {
      if (a.priority_score !== b.priority_score) {
        return b.priority_score - a.priority_score;
      }
      const createdDelta = toEpochMs(a.task.created_at) - toEpochMs(b.task.created_at);
      if (createdDelta !== 0) return createdDelta;
      return a.task.id.localeCompare(b.task.id);
    });
}

/** The "between lectures" quick-win filter (CONTRACT §4.1). */
export function isBetweenLecturesTask(t: {
  duration_min: number;
  cognitive_load: number;
}): boolean {
  return (
    t.duration_min <= BETWEEN_LECTURES_MAX_DURATION_MINUTES &&
    t.cognitive_load <= BETWEEN_LECTURES_MAX_COGNITIVE_LOAD
  );
}

// Study pacing math — ported from studyHourCounter src/utils/studyMath.js
// (CONTRACT §4.3). Hours everywhere; grades on the German scale
// (1.0 best … 5.0 fail). The v2 tail (effort × consistency) supersedes the
// raw-ROI grade/status — constants are contract literals.

import { dateInRange, diffDays, mondayOf, toDateStr } from './dates.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// §4.3 v2 contract constants
export const EFFORT_SCORE_MIN = 0.7;
export const EFFORT_SCORE_MAX = 1.15;
export const CONSISTENCY_BASE = 0.85;
export const CONSISTENCY_WEIGHT = 0.15;
export const CONSISTENCY_MIN_DAYS = 3;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/** Inclusive days from today to semester end, minimum 1 — verbatim port. */
export function getDaysRemaining(endDate: string, now: Date = new Date()): number {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const end = new Date(`${endDate}T00:00:00`);
  end.setHours(0, 0, 0, 0);
  return Math.max(1, Math.ceil((end.getTime() - today.getTime()) / MS_PER_DAY) + 1);
}

/** Hours per day still required to hit the target — verbatim port. */
export function calculateRequiredVelocity(
  targetHours: number,
  loggedHours: number,
  daysRemaining: number,
): number {
  return Math.max(0, (Number(targetHours || 0) - Number(loggedHours || 0)) / Math.max(1, daysRemaining));
}

/** % of the target already logged, clamped 0–100 — verbatim port. */
export function calculateStudyRoi(loggedHours: number, targetHours: number): number {
  if (targetHours <= 0) return 0;
  return clamp((loggedHours / targetHours) * 100, 0, 100);
}

/**
 * ROI → grade (German scale). ≤40% → 5.0; 40–80% linear to 3.0; ≥80% eased
 * (normalised sigmoid) toward 1.0 — the v1 piecewise mapping, verbatim.
 * v2 applies it to adjustedRoi; the what-if projector uses it directly.
 */
export function gradeFromRoi(roi: number): number {
  if (roi <= 40) return 5.0;

  if (roi < 80) {
    const progress = (roi - 40) / 40;
    return Number((5.0 - progress * 2.0).toFixed(1));
  }

  const tailProgress = clamp((roi - 80) / 20, 0, 1);
  const eased = sigmoid((tailProgress - 0.5) * 6);
  const normalized = (eased - sigmoid(-3)) / (sigmoid(3) - sigmoid(-3));
  return Number((5.0 - (2.0 + normalized * 2.0)).toFixed(1));
}

/** v1 convenience wrapper — identical behaviour to the original port. */
export function calculatePredictedGrade(loggedHours: number, targetHours: number): number {
  return gradeFromRoi(calculateStudyRoi(loggedHours, targetHours));
}

export type PaceStatus = 'on-track' | 'behind';

/** Verbatim port of getStatusTone. requiredVelocity is hours/day. */
export function getPaceStatus(roi: number, requiredVelocity: number): PaceStatus {
  if (roi >= 80 && requiredVelocity <= 2) return 'on-track';
  return requiredVelocity <= 4 ? 'on-track' : 'behind';
}

export interface CoursePace {
  logged_hours: number;
  logged_self_hours: number;
  logged_lecture_hours: number;
  target_hours: number;
  days_remaining: number;
  required_velocity: number;
  roi: number;
  predicted_grade: number;
  status: PaceStatus;
  deficit_hours: number;
}

export function computeCoursePace(args: {
  targetHours: number;
  loggedSelfMinutes: number;
  loggedLectureMinutes: number;
  semesterEndDate: string;
  now?: Date;
}): CoursePace {
  const loggedSelf = args.loggedSelfMinutes / 60;
  const loggedLecture = args.loggedLectureMinutes / 60;
  const logged = loggedSelf + loggedLecture;
  const daysRemaining = getDaysRemaining(args.semesterEndDate, args.now);
  const roi = calculateStudyRoi(logged, args.targetHours);
  const requiredVelocity = calculateRequiredVelocity(args.targetHours, logged, daysRemaining);
  return {
    logged_hours: Number(logged.toFixed(2)),
    logged_self_hours: Number(loggedSelf.toFixed(2)),
    logged_lecture_hours: Number(loggedLecture.toFixed(2)),
    target_hours: args.targetHours,
    days_remaining: daysRemaining,
    required_velocity: Number(requiredVelocity.toFixed(2)),
    roi: Number(roi.toFixed(1)),
    predicted_grade: calculatePredictedGrade(logged, args.targetHours),
    status: getPaceStatus(roi, requiredVelocity),
    deficit_hours: Number(Math.max(0, args.targetHours - logged).toFixed(1)),
  };
}

// ── §4.3 v2 tail — effort × consistency (supersedes the raw-ROI grade/status) ─

export interface SessionLite {
  date: string; // YYYY-MM-DD
  minutes: number;
  is_self_study: boolean;
  effort: number | null; // 1–5; null ⇒ 3
}

export interface CoursePaceV2 extends CoursePace {
  avg_effort: number;
  effort_score: number;
  weeks_elapsed: number;
  active_weeks: number;
  consistency: number; // 0..1
  adjusted_roi: number; // 0..100
  advice: string;
}

function localDateKey(now: Date): string {
  // §4.3 v1 uses local Date math (setHours) — stay consistent with it.
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return toDateStr(local);
}

/**
 * The full v2 pace: v1 base plus
 *   effortScore  = clamp(avgEffort/3, 0.7, 1.15)
 *   consistency  = min(1, activeWeeks / weeksElapsed)   (active = ≥3 distinct study days)
 *   adjustedRoi  = clamp(roi × (0.85 + 0.15 × consistency) × effortScore, 0, 100)
 * predicted_grade and status are computed against adjustedRoi.
 */
export function computeCoursePaceV2(args: {
  targetHours: number;
  sessions: SessionLite[];
  semesterStartDate: string;
  semesterEndDate: string;
  now?: Date;
}): CoursePaceV2 {
  const now = args.now ?? new Date();
  const inSemester = args.sessions.filter((s) =>
    dateInRange(s.date, args.semesterStartDate, args.semesterEndDate),
  );

  const base = computeCoursePace({
    targetHours: args.targetHours,
    loggedSelfMinutes: inSemester
      .filter((s) => s.is_self_study)
      .reduce((a, s) => a + s.minutes, 0),
    loggedLectureMinutes: inSemester
      .filter((s) => !s.is_self_study)
      .reduce((a, s) => a + s.minutes, 0),
    semesterEndDate: args.semesterEndDate,
    now,
  });

  const avgEffort = inSemester.length
    ? inSemester.reduce((a, s) => a + (s.effort ?? 3), 0) / inSemester.length
    : 3;
  const effortScore = clamp(avgEffort / 3, EFFORT_SCORE_MIN, EFFORT_SCORE_MAX);

  const todayKey = localDateKey(now);
  const clampedToday = todayKey < args.semesterStartDate
    ? args.semesterStartDate
    : todayKey > args.semesterEndDate
      ? args.semesterEndDate
      : todayKey;
  const firstMonday = mondayOf(args.semesterStartDate);
  const lastMonday = mondayOf(clampedToday);
  const weeksElapsed = Math.max(1, diffDays(firstMonday, lastMonday) / 7 + 1);

  const daysByWeek = new Map<string, Set<string>>();
  for (const s of inSemester) {
    const monday = mondayOf(s.date);
    if (monday < firstMonday || monday > lastMonday) continue;
    if (!daysByWeek.has(monday)) daysByWeek.set(monday, new Set());
    daysByWeek.get(monday)!.add(s.date);
  }
  let activeWeeks = 0;
  for (const days of daysByWeek.values()) {
    if (days.size >= CONSISTENCY_MIN_DAYS) activeWeeks++;
  }
  const consistency = Math.min(1, activeWeeks / weeksElapsed);

  const adjustedRoi = clamp(
    base.roi * (CONSISTENCY_BASE + CONSISTENCY_WEIGHT * consistency) * effortScore,
    0,
    100,
  );

  const pace: CoursePaceV2 = {
    ...base,
    predicted_grade: gradeFromRoi(adjustedRoi),
    status: getPaceStatus(adjustedRoi, base.required_velocity),
    avg_effort: Number(avgEffort.toFixed(2)),
    effort_score: Number(effortScore.toFixed(3)),
    weeks_elapsed: weeksElapsed,
    active_weeks: activeWeeks,
    consistency: Number(consistency.toFixed(3)),
    adjusted_roi: Number(adjustedRoi.toFixed(1)),
    advice: '',
  };
  pace.advice = paceAdvice(pace);
  return pace;
}

/**
 * §4.3 advice ladder — deterministic "the one thing to change", first match
 * wins. Also the heuristic fallback for POST /api/study/advice.
 */
export function paceAdvice(p: {
  roi: number;
  adjusted_roi: number;
  status: PaceStatus;
  required_velocity: number;
  deficit_hours: number;
  consistency: number;
  effort_score: number;
  weeks_elapsed: number;
  active_weeks: number;
}): string {
  const idle = p.weeks_elapsed - p.active_weeks;
  if (p.required_velocity > 4) {
    return `Raw hours are the problem — ${p.required_velocity}h/day needed to close ${p.deficit_hours}h.`;
  }
  if (p.consistency < 0.6 && p.roi >= 40) {
    return `Hours fine, consistency thin — ${idle} idle week${idle === 1 ? '' : 's'} dragging you down.`;
  }
  if (p.effort_score < 0.9) {
    return 'Time is going in, but mostly low-effort sessions — bring the hard problems here.';
  }
  if (p.status === 'on-track' && p.adjusted_roi >= 80) {
    return 'On course — keep the rhythm.';
  }
  return `Steady — ${p.deficit_hours}h to go at ${p.required_velocity}h/day.`;
}

/** UI meter (§4.3): how close the projection is to the course target. */
export function targetProximity(predictedGrade: number, targetGrade: number | null): number {
  const target = targetGrade ?? 1.0;
  if (target >= 5) return 1;
  return clamp((5 - predictedGrade) / (5 - target), 0, 1);
}

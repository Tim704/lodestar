// Study pacing math — ported from studyHourCounter src/utils/studyMath.js
// (CONTRACT §4.3). Hours everywhere; grades on the German scale
// (1.0 best … 5.0 fail).

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
 * ROI → predicted grade (German scale). ≤40% → 5.0; 40–80% linear to 3.0;
 * ≥80% eased (normalised sigmoid) toward 1.0 — verbatim port.
 */
export function calculatePredictedGrade(loggedHours: number, targetHours: number): number {
  const roi = calculateStudyRoi(loggedHours, targetHours);

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

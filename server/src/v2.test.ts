// Contract tests for the v2 features (CONTRACT §4.3 tail, §4.5b, §4.8, §4.9).

import { describe, expect, it } from 'vitest';
import {
  calculatePredictedGrade,
  computeCoursePaceV2,
  gradeFromRoi,
  paceAdvice,
  targetProximity,
  weeklyDoneInWeek,
  weeklyStats,
  mondayOf,
  type SessionLite,
} from '@lodestar/shared';
import { decideDisappear, extractItems } from './lib/scrape.js';
import { eveningSlots, planFocusHeuristic } from './lib/focus.js';

// local noon → the local calendar date is 2026-07-03 (a Friday) on any machine
const NOW = new Date('2026-07-03T12:00:00');

describe('watcher notify_on=disappear (§4.8)', () => {
  it('fires on present→absent and unknown→absent, once, and re-arms', () => {
    expect(decideDisappear(undefined, true)).toEqual({ fire: false, present: true });
    expect(decideDisappear(true, false)).toEqual({ fire: true, present: false });
    expect(decideDisappear(false, false)).toEqual({ fire: false, present: false }); // no re-fire
    expect(decideDisappear(false, true)).toEqual({ fire: false, present: true }); // re-armed
    expect(decideDisappear(undefined, false)).toEqual({ fire: true, present: false }); // already gone
  });

  it('regex extraction is case-insensitive (gi) — the W27 banner', () => {
    const selector = 'no more units available in W\\|27';
    const present = '<div>There are currently no more units available in W|27.</div>';
    const shouty = '<div>NO MORE UNITS AVAILABLE IN W|27</div>';
    const gone = '<div>2 units available — book now!</div>';
    expect(extractItems(present, 'regex', selector)).toHaveLength(1);
    expect(extractItems(shouty, 'regex', selector)).toHaveLength(1);
    expect(extractItems(gone, 'regex', selector)).toHaveLength(0);
  });
});

describe('habit weekly goals (§4.5b)', () => {
  const today = '2026-07-03'; // Friday; week = 2026-06-29 .. 07-05
  const met = (days: string[]) => Object.fromEntries(days.map((d) => [d, 1]));

  it('mondayOf is Monday-start', () => {
    expect(mondayOf('2026-07-03')).toBe('2026-06-29');
    expect(mondayOf('2026-06-29')).toBe('2026-06-29');
    expect(mondayOf('2026-07-05')).toBe('2026-06-29'); // Sunday belongs to the same week
  });

  it('gym 5×/week: rest days are simply not required', () => {
    const log = met(['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03']);
    const s = weeklyStats(log, 1, 5, today);
    expect(s.weekly_done).toBe(5);
    expect(s.weeks_streak).toBe(1); // this week already met
  });

  it('the in-progress week does not break the weeks streak', () => {
    const log = met([
      // two fully met previous weeks
      '2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19',
      '2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26',
      // this week: only one day so far
      '2026-07-01',
    ]);
    const s = weeklyStats(log, 1, 5, today);
    expect(s.weekly_done).toBe(1);
    expect(s.weeks_streak).toBe(2);
  });

  it('a missed completed week breaks it', () => {
    const log = met([
      '2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19', // met (2 weeks ago)
      '2026-06-22', // last week: 1/5 — unmet
    ]);
    expect(weeklyStats(log, 1, 5, today).weeks_streak).toBe(0);
  });

  it('weeklyDoneInWeek respects the daily target', () => {
    const log = { '2026-06-29': 8, '2026-06-30': 4 };
    expect(weeklyDoneInWeek(log, 8, '2026-06-29')).toBe(1);
  });
});

describe('grade projection v2 (§4.3 tail)', () => {
  const semester = { start: '2026-06-01', end: '2026-09-30' }; // Mondays: 06-01 .. 06-29 → 5 weeks
  const s = (date: string, minutes: number, effort: number | null): SessionLite => ({
    date,
    minutes,
    is_self_study: true,
    effort,
  });

  it('computes effortScore, consistency, adjustedRoi exactly per contract', () => {
    const sessions = [s('2026-06-29', 120, 5), s('2026-06-30', 120, 5), s('2026-07-01', 120, 5)];
    const pace = computeCoursePaceV2({
      targetHours: 100,
      sessions,
      semesterStartDate: semester.start,
      semesterEndDate: semester.end,
      now: NOW,
    });
    expect(pace.weeks_elapsed).toBe(5);
    expect(pace.active_weeks).toBe(1); // one week with ≥3 distinct days
    expect(pace.consistency).toBeCloseTo(0.2, 3);
    expect(pace.effort_score).toBe(1.15); // clamp(5/3, 0.7, 1.15)
    expect(pace.roi).toBeCloseTo(6, 1); // 6h of 100h
    expect(pace.adjusted_roi).toBeCloseTo(6 * (0.85 + 0.15 * 0.2) * 1.15, 1);
    expect(pace.predicted_grade).toBe(gradeFromRoi(pace.adjusted_roi));
  });

  it('low effort clamps to 0.7; two days a week is not an active week', () => {
    const sessions = [s('2026-06-29', 60, 1), s('2026-06-30', 60, 1)];
    const pace = computeCoursePaceV2({
      targetHours: 10,
      sessions,
      semesterStartDate: semester.start,
      semesterEndDate: semester.end,
      now: NOW,
    });
    expect(pace.effort_score).toBe(0.7);
    expect(pace.active_weeks).toBe(0);
  });

  it('null effort is treated as 3 (score 1.0) and consistency lifts the grade', () => {
    // 3 study days in each of the 5 elapsed weeks, 9h total on a 10h target
    const days: SessionLite[] = [];
    for (let w = 0; w < 5; w++) {
      for (let d = 0; d < 3; d++) {
        const day = new Date(Date.UTC(2026, 5, 1 + w * 7 + d));
        days.push(s(day.toISOString().slice(0, 10), 36, null));
      }
    }
    const consistent = computeCoursePaceV2({
      targetHours: 10,
      sessions: days,
      semesterStartDate: semester.start,
      semesterEndDate: semester.end,
      now: NOW,
    });
    expect(consistent.effort_score).toBe(1);
    expect(consistent.consistency).toBe(1);
    expect(consistent.adjusted_roi).toBeCloseTo(consistent.roi, 1);

    // same hours crammed into one week → worse adjusted grade
    const crammed = computeCoursePaceV2({
      targetHours: 10,
      sessions: [s('2026-06-29', 180, null), s('2026-06-30', 180, null), s('2026-07-01', 180, null)],
      semesterStartDate: semester.start,
      semesterEndDate: semester.end,
      now: NOW,
    });
    expect(crammed.adjusted_roi).toBeLessThan(consistent.adjusted_roi);
    expect(crammed.predicted_grade).toBeGreaterThan(consistent.predicted_grade);
  });

  it('v1 mapping is unchanged (gradeFromRoi refactor)', () => {
    expect(calculatePredictedGrade(60, 100)).toBe(4.0);
    expect(gradeFromRoi(40)).toBe(5.0);
    expect(gradeFromRoi(100)).toBeCloseTo(1.0, 1);
  });

  it('advice ladder — first match wins, in contract order', () => {
    const base = {
      roi: 50,
      adjusted_roi: 50,
      status: 'on-track' as const,
      required_velocity: 1,
      deficit_hours: 10,
      consistency: 1,
      effort_score: 1,
      weeks_elapsed: 5,
      active_weeks: 5,
    };
    expect(paceAdvice({ ...base, required_velocity: 5 })).toContain('Raw hours are the problem');
    expect(paceAdvice({ ...base, consistency: 0.4, active_weeks: 2 })).toContain('consistency thin');
    expect(paceAdvice({ ...base, effort_score: 0.8 })).toContain('low-effort sessions');
    expect(paceAdvice({ ...base, adjusted_roi: 85 })).toBe('On course — keep the rhythm.');
    expect(paceAdvice(base)).toContain('Steady');
  });

  it('target proximity meter', () => {
    expect(targetProximity(2.0, 2.0)).toBe(1);
    expect(targetProximity(3.0, 2.0)).toBeCloseTo(2 / 3, 3);
    expect(targetProximity(5.0, null)).toBe(0); // default target 1.0
  });
});

describe('focus planner heuristic (§4.9)', () => {
  const tz = 'Europe/Zurich';
  const tasks = [
    { id: 't1', title: 'Sheet 5 Q1-3', course_id: 'c1', due_at: '2026-07-04T08:00:00Z', duration_min: 45, cognitive_load: 4 },
    { id: 't2', title: 'Read paper', course_id: null, due_at: '2026-07-08T08:00:00Z', duration_min: 120, cognitive_load: 3 },
  ];
  const courses = [
    { id: 'c2', name: 'Analysis', deficit_hours: 20, required_velocity: 5, status: 'behind' as const },
    { id: 'c3', name: 'Chill', deficit_hours: 1, required_velocity: 0.2, status: 'on-track' as const },
  ];
  const slots = [
    { date: '2026-07-06', start: '10:00', minutes: 60 },
    { date: '2026-07-06', start: '13:00', minutes: 45 },
    { date: '2026-07-07', start: '10:00', minutes: 90 },
  ];

  it('deadline-ranked tasks first, then behind courses, into gaps chronologically', () => {
    const plan = planFocusHeuristic({ tasks, courses, slots, tz, now: NOW });
    expect(plan).toHaveLength(3);
    expect(plan[0]).toMatchObject({ task_id: 't1', course_id: 'c1', planned_minutes: 45 });
    expect(plan[0]!.scheduled_for).toBe('2026-07-06T08:00:00.000Z'); // 10:00 CEST
    expect(plan[1]).toMatchObject({ task_id: 't2', planned_minutes: 40 }); // 45-min gap → 40
    expect(plan[2]!.course_id).toBe('c2'); // behind course; on-track c3 never proposed
    expect(plan.some((p) => p.course_id === 'c3')).toBe(false);
  });

  it('caps at 2 sessions per course', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      date: '2026-07-06',
      start: `${String(8 + i).padStart(2, '0')}:00`,
      minutes: 60,
    }));
    const plan = planFocusHeuristic({ tasks: [], courses, slots: many, tz, now: NOW });
    expect(plan.filter((p) => p.course_id === 'c2')).toHaveLength(2);
  });

  it('synthesizes 18:30 evening slots for a gap-less week', () => {
    const evenings = eveningSlots('2026-07-06', '2026-07-08');
    expect(evenings).toHaveLength(5); // Wed..Sun remain
    expect(evenings[0]).toMatchObject({ date: '2026-07-08', start: '18:30' });
    const plan = planFocusHeuristic({ tasks: [], courses, slots: evenings, tz, now: NOW });
    expect(plan.length).toBeGreaterThan(0);
  });
});

// Contract tests for the ported formulas (CONTRACT §4) — these pin the ports
// to the source apps' observable behaviour.

import { describe, expect, it } from 'vitest';
import {
  calculatePriorityScore,
  getAcademicMultiplier,
  getDeadlineBucket,
  isBetweenLecturesTask,
  isTaskStarving,
  prioritizeTasks,
  type ScorableTask,
} from '@lodestar/shared';
import {
  calculatePredictedGrade,
  calculateRequiredVelocity,
  calculateStudyRoi,
  computeCoursePace,
  getPaceStatus,
} from '@lodestar/shared';
import { classifyDay, computeOverlap, findWindows } from '@lodestar/shared';
import { currentStreak } from '@lodestar/shared';
import { addDaysStr, eachDate, isValidDateStr } from '@lodestar/shared';
import { extractItems } from './lib/scrape.js';
import { heuristicEnrich } from './lib/enrich.js';
import { actionsToSuggestions } from './routes/assistant.js';

const NOW = new Date('2026-07-03T12:00:00Z');

function task(over: Partial<ScorableTask>): ScorableTask {
  return {
    id: 'a',
    title: 'plain task',
    importance: 5,
    cognitive_load: 3,
    duration_min: 45,
    created_at: '2026-07-03T11:00:00Z',
    due_at: null,
    is_completed: false,
    ...over,
  };
}

describe('priority (dynamicTo-Do port, §4.1)', () => {
  it('computes S = (imp × load / ln(elapsed + dur + 2)) × mult', () => {
    const t = task({ importance: 6, cognitive_load: 4, duration_min: 30 });
    // elapsed = 60 min → ln(60 + 30 + 2) = ln(92)
    expect(calculatePriorityScore(t, NOW)).toBeCloseTo((6 * 4) / Math.log(92), 6);
  });

  it('boosts academic keywords by exactly 1.5', () => {
    expect(getAcademicMultiplier('Prepare KLAUSUR sheet')).toBe(1.5);
    expect(getAcademicMultiplier('water the plants')).toBe(1.0);
    const plain = task({});
    const academic = task({ title: 'exam prep' });
    expect(calculatePriorityScore(academic, NOW)).toBeCloseTo(
      calculatePriorityScore(plain, NOW) * 1.5,
      6,
    );
  });

  it('deadline buckets escalate the multiplier (Lodestar extension)', () => {
    expect(getDeadlineBucket(null, NOW)).toBe('none');
    expect(getDeadlineBucket('2026-07-03T10:00:00Z', NOW)).toBe('overdue');
    expect(getDeadlineBucket('2026-07-04T09:00:00Z', NOW)).toBe('lt24h');
    expect(getDeadlineBucket('2026-07-05T09:00:00Z', NOW)).toBe('lt48h');
    expect(getDeadlineBucket('2026-07-09T09:00:00Z', NOW)).toBe('lt7d');
    expect(getDeadlineBucket('2026-08-01T09:00:00Z', NOW)).toBe('none');
    // deadline (2.0) beats academic (1.5); they don't stack
    const both = task({ title: 'exam', due_at: '2026-07-03T13:00:00Z' });
    const scored = prioritizeTasks([both], NOW)[0]!;
    expect(scored.urgency_multiplier).toBe(2.0);
  });

  it('sorts score desc with created_at then id tie-breakers', () => {
    const heavy = task({ id: 'z', title: 'exam', importance: 10, cognitive_load: 5 });
    const light = task({ id: 'a', importance: 1, cognitive_load: 1 });
    const ranked = prioritizeTasks([light, heavy], NOW);
    expect(ranked[0]!.task.id).toBe('z');
    const twinA = task({ id: 'a' });
    const twinB = task({ id: 'b' });
    expect(prioritizeTasks([twinB, twinA], NOW)[0]!.task.id).toBe('a');
  });

  it('starvation flips after 7 days, never for completed tasks', () => {
    expect(isTaskStarving(task({ created_at: '2026-06-25T11:00:00Z' }), NOW)).toBe(true);
    expect(isTaskStarving(task({ created_at: '2026-06-27T11:00:00Z' }), NOW)).toBe(false);
    expect(
      isTaskStarving(task({ created_at: '2026-06-01T00:00:00Z', is_completed: true }), NOW),
    ).toBe(false);
  });

  it('between-lectures = duration ≤ 30 AND load ≤ 2', () => {
    expect(isBetweenLecturesTask({ duration_min: 30, cognitive_load: 2 })).toBe(true);
    expect(isBetweenLecturesTask({ duration_min: 31, cognitive_load: 2 })).toBe(false);
    expect(isBetweenLecturesTask({ duration_min: 10, cognitive_load: 3 })).toBe(false);
  });
});

describe('study pacing (studyHourCounter port, §4.3)', () => {
  it('required velocity = deficit / days remaining, floored at 0', () => {
    expect(calculateRequiredVelocity(100, 40, 30)).toBeCloseTo(2);
    expect(calculateRequiredVelocity(100, 120, 30)).toBe(0);
  });

  it('roi clamps 0..100', () => {
    expect(calculateStudyRoi(50, 100)).toBe(50);
    expect(calculateStudyRoi(150, 100)).toBe(100);
    expect(calculateStudyRoi(10, 0)).toBe(0);
  });

  it('predicted grade: ≤40% → 5.0, midband linear, ≥80% eases toward 1.0', () => {
    expect(calculatePredictedGrade(40, 100)).toBe(5.0);
    expect(calculatePredictedGrade(60, 100)).toBe(4.0); // (60-40)/40 × 2 below 5.0
    expect(calculatePredictedGrade(80, 100)).toBeCloseTo(3.0, 1);
    expect(calculatePredictedGrade(100, 100)).toBeCloseTo(1.0, 1);
  });

  it('status: behind only when velocity demands > 4h/day (or >2 with high roi)', () => {
    expect(getPaceStatus(85, 1)).toBe('on-track');
    expect(getPaceStatus(20, 3.5)).toBe('on-track');
    expect(getPaceStatus(20, 4.5)).toBe('behind');
  });

  it('computeCoursePace splits self vs lecture minutes', () => {
    const pace = computeCoursePace({
      targetHours: 90,
      loggedSelfMinutes: 600, // 10h
      loggedLectureMinutes: 300, // 5h
      semesterEndDate: '2026-08-01',
      now: NOW,
    });
    expect(pace.logged_hours).toBe(15);
    expect(pace.logged_self_hours).toBe(10);
    expect(pace.deficit_hours).toBe(75);
  });
});

describe('overlap finder (Whenabouts port, §4.4)', () => {
  it('classifyDay precedence: busy > free > maybe > inference', () => {
    const base = { hasBusy: false, hasFree: false, hasMaybe: false, inBreak: false, inTerm: false, onlyOnBreak: false };
    expect(classifyDay({ ...base, hasBusy: true, hasFree: true })).toBe('busy');
    expect(classifyDay({ ...base, hasFree: true, hasMaybe: true })).toBe('free');
    expect(classifyDay({ ...base, hasMaybe: true })).toBe('maybe');
    expect(classifyDay(base)).toBe('unknown');
    expect(classifyDay({ ...base, inBreak: true })).toBe('unknown'); // inference off
    expect(classifyDay({ ...base, inBreak: true, onlyOnBreak: true })).toBe('free');
    expect(classifyDay({ ...base, inTerm: true, onlyOnBreak: true })).toBe('busy');
  });

  it('finds the maximal same-set window and ranks by count then length', () => {
    const result = computeOverlap({
      userIds: ['u1', 'u2', 'u3'],
      availability: [
        { user_id: 'u1', status: 'free', start_date: '2026-07-01', end_date: '2026-07-05' },
        { user_id: 'u2', status: 'free', start_date: '2026-07-02', end_date: '2026-07-04' },
        { user_id: 'u3', status: 'free', start_date: '2026-07-04', end_date: '2026-07-06' },
      ],
      terms: [],
      startDate: '2026-07-01',
      endDate: '2026-07-07',
      minPeople: 2,
      onlyOnBreak: false,
    });
    const w = result.windows[0]!;
    expect(w.start_date).toBe('2026-07-02');
    expect(w.end_date).toBe('2026-07-04');
    expect(w.free_user_ids).toEqual(['u1', 'u2']);
  });

  it('only free counts — maybe never fills a window', () => {
    const days = [
      { date: '2026-07-01', free: ['a'], maybe: ['b'], busy: [], unknown: [] },
      { date: '2026-07-02', free: ['a', 'b'], maybe: [], busy: [], unknown: [] },
    ];
    const windows = findWindows(days, 2);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.start_date).toBe('2026-07-02');
  });
});

describe('streaks (Mizu port, §4.5)', () => {
  const today = '2026-07-03';
  it('counts consecutive met days ending today', () => {
    expect(currentStreak({ '2026-07-01': 8, '2026-07-02': 8, '2026-07-03': 8 }, 8, today)).toBe(3);
  });
  it("today not yet met doesn't break the streak", () => {
    expect(currentStreak({ '2026-07-01': 8, '2026-07-02': 8 }, 8, today)).toBe(2);
  });
  it('a gap before today breaks it', () => {
    expect(currentStreak({ '2026-06-30': 8, '2026-07-02': 8, '2026-07-03': 8 }, 8, today)).toBe(2);
  });
});

describe('date helpers', () => {
  it('validates and iterates', () => {
    expect(isValidDateStr('2026-02-29')).toBe(false); // not a leap year
    expect(isValidDateStr('2024-02-29')).toBe(true);
    expect(eachDate('2026-07-01', '2026-07-03')).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
    expect(addDaysStr('2026-07-31', 1)).toBe('2026-08-01');
  });
});

describe('watcher extraction (checkRosenberg port)', () => {
  const html = `<table><tbody>
    <tr><td>1.09</td><td>1. OG</td><td>595 €</td><td>Belegt</td></tr>
    <tr><td>2.11</td><td>2. OG</td><td>625 €</td><td>Frei ab sofort</td></tr>
  </tbody></table>`;

  it('css mode: one item per match, whitespace normalized', () => {
    const items = extractItems(html, 'css', 'tbody tr');
    expect(items).toHaveLength(2);
    expect(items[1]).toContain('Frei ab sofort');
  });

  it('regex mode uses group 1 when present', () => {
    const items = extractItems('id: A-17\nid: B-23', 'regex', 'id: ([A-Z]-\\d+)');
    expect(items).toEqual(['A-17', 'B-23']);
  });
});

describe('enrichment heuristics (§4.2 fallback)', () => {
  it('academic → {8,4,90}, domestic → {3,1,30}, default → {5,3,45}', () => {
    expect(heuristicEnrich('Prepare exam')).toMatchObject({ importance: 8, cognitive_load: 4, duration_min: 90 });
    expect(heuristicEnrich('do the laundry')).toMatchObject({ importance: 3, cognitive_load: 1, duration_min: 30 });
    expect(heuristicEnrich('call mum')).toMatchObject({ importance: 5, cognitive_load: 3, duration_min: 45 });
  });
});

describe('capture validation (aiParse pattern — model never trusted)', () => {
  it('keeps valid actions, drops garbage silently', () => {
    const out = actionsToSuggestions(
      {
        actions: [
          { kind: 'task', title: 'email prof', due_at: '2026-07-04T10:00:00Z' },
          { kind: 'task', title: '' }, // invalid: empty
          { kind: 'event', title: 'party', all_day: true, start_date: '2026-07-05', end_date: '2026-07-04' }, // start > end
          { kind: 'availability', status: 'busy', start_date: '2026-07-10', end_date: '2026-07-12' },
          { kind: 'nonsense' },
        ],
      },
      'Europe/Zurich',
    );
    expect(out).toHaveLength(2);
    expect(out[0]!.kind).toBe('task');
    expect(out[1]!.kind).toBe('availability');
  });
});

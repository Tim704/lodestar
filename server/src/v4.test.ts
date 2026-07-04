// Contract tests for v4 — fortnight assembly (§4.11) and project semantics (§4.12).

import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@lodestar/shared';
import {
  bucketDueTasks,
  bucketEvents,
  classesForDate,
  fortnightDates,
  type SlotRow,
} from './lib/fortnight.js';
import { heuristicProjectSteps } from './routes/projects.js';

const NOW = new Date('2026-07-03T12:00:00Z');

describe('fortnight assembly (§4.11)', () => {
  it('yields 14 consecutive dates', () => {
    const days = fortnightDates('2026-06-29');
    expect(days).toHaveLength(14);
    expect(days[0]).toBe('2026-06-29');
    expect(days[13]).toBe('2026-07-12');
  });

  it('classesForDate filters by weekday AND semester range, sorted by start', () => {
    const slots: SlotRow[] = [
      { course_id: 'c1', course_name: 'Algebra', color: null, weekday: 5, start_time: '13:00:00', end_time: '15:00:00', location: null, sem_start: '2026-06-01', sem_end: '2026-09-30' },
      { course_id: 'c1', course_name: 'Algebra', color: null, weekday: 5, start_time: '10:00:00', end_time: '12:00:00', location: 'HG F1', sem_start: '2026-06-01', sem_end: '2026-09-30' },
      { course_id: 'c2', course_name: 'Old course', color: null, weekday: 5, start_time: '08:00:00', end_time: '09:00:00', location: null, sem_start: '2026-01-01', sem_end: '2026-05-31' },
    ];
    // 2026-07-03 is a Friday (weekday 5)
    const blocks = classesForDate(slots, '2026-07-03', 5);
    expect(blocks).toHaveLength(2); // out-of-semester slot dropped
    expect(blocks[0]).toMatchObject({ start: '10:00', end: '12:00', location: 'HG F1' });
    expect(blocks[1]!.start).toBe('13:00');
    expect(classesForDate(slots, '2026-07-04', 6)).toHaveLength(0); // Saturday
  });

  it('buckets due tasks by the USER-LOCAL date of due_at', () => {
    const rows = [
      // 22:30 UTC on the 5th = 00:30 on the 6th in Zurich (CEST, +2)
      { id: 't1', title: 'late-night due', is_completed: false, duration_min: 30, course_id: null, project_id: null, due_at: '2026-07-05T22:30:00Z' },
      { id: 't2', title: 'overdue thing', is_completed: false, duration_min: 15, course_id: null, project_id: null, due_at: '2026-07-01T09:00:00Z' },
    ];
    const byDate = bucketDueTasks(rows, 'Europe/Zurich', NOW);
    expect(byDate.get('2026-07-06')?.[0]?.title).toBe('late-night due');
    expect(byDate.get('2026-07-05')).toBeUndefined();
    expect(byDate.get('2026-07-01')?.[0]?.deadline_bucket).toBe('overdue');
  });

  it('expands all-day events across their range (clipped) and flags exams', () => {
    const base: Omit<CalendarEvent, 'id' | 'title' | 'all_day' | 'start_date' | 'end_date' | 'start_utc' | 'end_utc'> = {
      owner_id: 'u',
      group_id: null,
      description: null,
      location: null,
      tz: 'Europe/Zurich',
      color: null,
      icon: null,
      source: 'manual',
    };
    const events: CalendarEvent[] = [
      { ...base, id: 'e1', title: 'Festival', all_day: true, start_date: '2026-06-27', end_date: '2026-07-01', start_utc: null, end_utc: null },
      { ...base, id: 'e2', title: 'Klausur Analysis', all_day: false, start_date: null, end_date: null, start_utc: '2026-07-07T07:00:00Z', end_utc: '2026-07-07T09:00:00Z' },
    ];
    const byDate = bucketEvents(events, '2026-06-29', '2026-07-12', 'Europe/Zurich');
    // clipped: 27th/28th fall before the window
    expect(byDate.get('2026-06-28')).toBeUndefined();
    expect(byDate.get('2026-06-29')?.map((e) => e.id)).toEqual(['e1']);
    expect(byDate.get('2026-07-01')?.map((e) => e.id)).toEqual(['e1']);
    expect(byDate.get('2026-07-02')).toBeUndefined();
    // timed event lands on its local date, flagged as an exam by §4.1 keywords
    const exam = byDate.get('2026-07-07')?.[0];
    expect(exam?.id).toBe('e2');
    expect(exam?.is_exam).toBe(true);
    expect(byDate.get('2026-06-29')?.[0]?.is_exam).toBe(false);
  });
});

describe('project next-steps heuristic (§4.12)', () => {
  it('leads with next_action, then the three templates, capped at 3', () => {
    const steps = heuristicProjectSteps('Zine', 'Sketch the cover', []);
    expect(steps).toHaveLength(3);
    expect(steps[0]!.title).toBe('Sketch the cover');
    expect(steps[1]!.title).toContain('one-page spec for Zine');
  });

  it('skips suggestions already open on the project (case-insensitive)', () => {
    const steps = heuristicProjectSteps('Zine', 'Sketch the cover', ['sketch the cover']);
    expect(steps[0]!.title).toContain('one-page spec');
    expect(steps.every((s) => s.title.toLowerCase() !== 'sketch the cover')).toBe(true);
  });

  it('without a next_action, offers the three canonical templates', () => {
    const steps = heuristicProjectSteps('Bot', null, []);
    expect(steps.map((s) => s.title)).toEqual([
      'Write a one-page spec for Bot — scope, non-goals, first slice',
      'Set up the Bot repo — scaffold, README, deploy notes',
      'Build the smallest end-to-end slice of Bot and show it to someone',
    ]);
  });
});

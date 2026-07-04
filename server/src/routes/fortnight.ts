// GET /api/fortnight — the home page's single fetch (CONTRACT §4.11):
// 14 days of classes, due tasks, and events, assembled server-side.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DateTime } from 'luxon';
import {
  isValidDateStr,
  mondayOf,
  weekdayOf,
  type FortnightPayload,
} from '@lodestar/shared';
import { query } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { todayInTz } from '../lib/schedule.js';
import {
  bucketDueTasks,
  bucketEvents,
  classesForDate,
  fortnightDates,
  type DueTaskRow,
  type SlotRow,
} from '../lib/fortnight.js';
import { visibleEvents } from './calendar.js';

export async function fortnightRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/api/fortnight', async (request): Promise<FortnightPayload> => {
    const q = z
      .object({ start: z.string().refine(isValidDateStr, 'expected YYYY-MM-DD').optional() })
      .parse(request.query);
    const tz = request.user.tz;
    const start = q.start ?? mondayOf(todayInTz(tz).date);
    const dates = fortnightDates(start);
    const end = dates[dates.length - 1]!;
    const now = new Date();

    // one query per source, buckets computed in the pure lib
    const [slots, taskRows, events] = await Promise.all([
      query<SlotRow>(
        `SELECT c.id AS course_id, c.name AS course_name, c.color, ls.weekday,
                ls.start_time::text AS start_time, ls.end_time::text AS end_time, ls.location,
                s.start_date AS sem_start, s.end_date AS sem_end
         FROM lecture_slots ls
         JOIN courses c ON c.id = ls.course_id
         JOIN semesters s ON s.id = c.semester_id
         WHERE c.user_id = $1 AND s.start_date <= $3::date AND s.end_date >= $2::date`,
        [request.user.id, start, end],
      ),
      query<DueTaskRow>(
        `SELECT id, title, is_completed, duration_min, course_id, project_id, due_at
         FROM tasks
         WHERE user_id = $1 AND due_at IS NOT NULL
           AND due_at >= $2 AND due_at < $3`,
        [
          request.user.id,
          DateTime.fromISO(start, { zone: tz }).startOf('day').toUTC().toISO(),
          DateTime.fromISO(end, { zone: tz }).plus({ days: 1 }).startOf('day').toUTC().toISO(),
        ],
      ),
      visibleEvents(request.user.id, start, end),
    ]);

    const dueByDate = bucketDueTasks(taskRows, tz, now);
    const eventsByDate = bucketEvents(events, start, end, tz);

    return {
      start,
      days: dates.map((date) => ({
        date,
        classes: classesForDate(slots, date, weekdayOf(date)),
        due_tasks: dueByDate.get(date) ?? [],
        events: eventsByDate.get(date) ?? [],
      })),
    };
  });
}

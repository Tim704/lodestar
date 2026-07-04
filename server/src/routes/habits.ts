// Habits module — the Mizu (water-counter) generalization: N habits, daily
// targets, streak math from CONTRACT §4.5, plus v2 weekly quotas (§4.5b).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  addDaysStr,
  eachDate,
  habitStats,
  isValidDateStr,
  mondayOf,
  weeklyDoneInWeek,
  weeklyStats,
  type Habit,
  type HabitHistory,
  type HabitToday,
} from '@lodestar/shared';
import { query, queryOne } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { notFound } from '../lib/errors.js';
import { todayInTz } from '../lib/schedule.js';

const idParams = z.object({ id: z.string().uuid() });

const habitSchema = z.object({
  name: z.string().trim().min(1).max(60),
  emoji: z.string().trim().min(1).max(8).default('✦'),
  target_per_day: z.number().int().min(1).max(100).default(1),
  target_per_week: z.number().int().min(1).max(7).nullish(),
  unit: z.string().trim().max(20).nullish(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
});

export async function habitsWithToday(userId: string, tz: string): Promise<HabitToday[]> {
  const habits = await query<Habit>(
    'SELECT * FROM habits WHERE user_id = $1 AND NOT archived ORDER BY sort, created_at',
    [userId],
  );
  if (!habits.length) return [];
  const { date: today } = todayInTz(tz);

  const logs = await query<{ habit_id: string; date: string; count: number }>(
    `SELECT habit_id, date, count FROM habit_logs
     WHERE habit_id = ANY($1) AND date >= (CURRENT_DATE - 400)`,
    [habits.map((h) => h.id)],
  );

  return habits.map((h) => {
    const log: Record<string, number> = {};
    for (const l of logs) if (l.habit_id === h.id) log[l.date] = l.count;
    const stats = habitStats(log, h.target_per_day, today);
    const weekly = h.target_per_week
      ? weeklyStats(log, h.target_per_day, h.target_per_week, today)
      : null;
    return {
      ...h,
      today_count: log[today] ?? 0,
      streak: stats.streak,
      days_met: stats.days_met,
      weekly_done: weekly?.weekly_done ?? null,
      weeks_streak: weekly?.weeks_streak ?? null,
    };
  });
}

export async function habitRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/api/habits/today', async (request) => {
    return { habits: await habitsWithToday(request.user.id, request.user.tz) };
  });

  app.post('/api/habits', async (request, reply) => {
    const body = habitSchema.parse(request.body);
    const row = await queryOne<Habit>(
      `INSERT INTO habits (user_id, name, emoji, target_per_day, target_per_week, unit, color, sort)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               (SELECT COALESCE(MAX(sort), 0) + 1 FROM habits WHERE user_id = $1))
       RETURNING *`,
      [
        request.user.id,
        body.name,
        body.emoji,
        body.target_per_day,
        body.target_per_week ?? null,
        body.unit ?? null,
        body.color ?? null,
      ],
    );
    return reply.code(201).send({ habit: row });
  });

  app.patch('/api/habits/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = habitSchema.partial().extend({ archived: z.boolean().optional() }).parse(request.body);
    const current = await queryOne<Habit>('SELECT * FROM habits WHERE id = $1 AND user_id = $2', [
      id,
      request.user.id,
    ]);
    if (!current) throw notFound('Habit not found.');
    const row = await queryOne<Habit>(
      `UPDATE habits SET name = $3, emoji = $4, target_per_day = $5, target_per_week = $6,
                         unit = $7, color = $8, archived = $9
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [
        id,
        request.user.id,
        body.name ?? current.name,
        body.emoji ?? current.emoji,
        body.target_per_day ?? current.target_per_day,
        body.target_per_week !== undefined ? body.target_per_week : current.target_per_week,
        body.unit !== undefined ? body.unit : current.unit,
        body.color !== undefined ? body.color : current.color,
        body.archived ?? current.archived,
      ],
    );
    return { habit: row };
  });

  // §4.5b graph data — per-day counts + per-week completion for the heatmap.
  app.get('/api/habits/history', async (request): Promise<HabitHistory> => {
    const q = z
      .object({
        habit_id: z.string().uuid(),
        weeks: z.coerce.number().int().min(1).max(26).default(12),
      })
      .parse(request.query);
    const habit = await queryOne<Habit>('SELECT * FROM habits WHERE id = $1 AND user_id = $2', [
      q.habit_id,
      request.user.id,
    ]);
    if (!habit) throw notFound('Habit not found.');

    const { date: today } = todayInTz(request.user.tz);
    const startDate = addDaysStr(mondayOf(today), -7 * (q.weeks - 1));

    const rows = await query<{ date: string; count: number }>(
      'SELECT date, count FROM habit_logs WHERE habit_id = $1 AND date >= $2',
      [q.habit_id, startDate],
    );
    const log: Record<string, number> = {};
    for (const r of rows) log[r.date] = r.count;

    const days = eachDate(startDate, today).map((date) => ({
      date,
      count: log[date] ?? 0,
      met: (log[date] ?? 0) >= habit.target_per_day,
    }));
    const weeks = Array.from({ length: q.weeks }, (_, i) => {
      const week_start = addDaysStr(startDate, 7 * i);
      const done = weeklyDoneInWeek(log, habit.target_per_day, week_start);
      return {
        week_start,
        done,
        met: habit.target_per_week ? done >= habit.target_per_week : null,
      };
    });

    return {
      habit_id: habit.id,
      target_per_day: habit.target_per_day,
      target_per_week: habit.target_per_week,
      days,
      weeks,
    };
  });

  app.delete('/api/habits/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const rows = await query('DELETE FROM habits WHERE id = $1 AND user_id = $2 RETURNING id', [
      id,
      request.user.id,
    ]);
    if (!rows.length) throw notFound('Habit not found.');
    return { ok: true };
  });

  // delta-based logging (tap +1 / undo −1), floor at 0 — Mizu semantics
  app.post('/api/habits/:id/log', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = z
      .object({
        date: z.string().refine(isValidDateStr).optional(),
        delta: z.number().int().min(-100).max(100),
      })
      .parse(request.body);
    const habit = await queryOne<Habit>('SELECT * FROM habits WHERE id = $1 AND user_id = $2', [
      id,
      request.user.id,
    ]);
    if (!habit) throw notFound('Habit not found.');
    const date = body.date ?? todayInTz(request.user.tz).date;

    const row = await queryOne<{ count: number }>(
      `INSERT INTO habit_logs (habit_id, date, count)
       VALUES ($1, $2, GREATEST(0, $3))
       ON CONFLICT (habit_id, date)
       DO UPDATE SET count = GREATEST(0, habit_logs.count + $3)
       RETURNING count`,
      [id, date, body.delta],
    );
    return { date, count: row!.count };
  });
}

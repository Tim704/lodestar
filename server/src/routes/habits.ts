// Habits module — the Mizu (water-counter) generalization: N habits, daily
// targets, streak math from CONTRACT §4.5.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { habitStats, isValidDateStr, type Habit, type HabitToday } from '@lodestar/shared';
import { query, queryOne } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { notFound } from '../lib/errors.js';
import { todayInTz } from '../lib/schedule.js';

const idParams = z.object({ id: z.string().uuid() });

const habitSchema = z.object({
  name: z.string().trim().min(1).max(60),
  emoji: z.string().trim().min(1).max(8).default('✦'),
  target_per_day: z.number().int().min(1).max(100).default(1),
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
    return {
      ...h,
      today_count: log[today] ?? 0,
      streak: stats.streak,
      days_met: stats.days_met,
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
      `INSERT INTO habits (user_id, name, emoji, target_per_day, unit, color, sort)
       VALUES ($1, $2, $3, $4, $5, $6,
               (SELECT COALESCE(MAX(sort), 0) + 1 FROM habits WHERE user_id = $1))
       RETURNING *`,
      [request.user.id, body.name, body.emoji, body.target_per_day, body.unit ?? null, body.color ?? null],
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
      `UPDATE habits SET name = $3, emoji = $4, target_per_day = $5, unit = $6, color = $7, archived = $8
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [
        id,
        request.user.id,
        body.name ?? current.name,
        body.emoji ?? current.emoji,
        body.target_per_day ?? current.target_per_day,
        body.unit !== undefined ? body.unit : current.unit,
        body.color !== undefined ? body.color : current.color,
        body.archived ?? current.archived,
      ],
    );
    return { habit: row };
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

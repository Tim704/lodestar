// Tasks module — the dynamicTo-Do port (CONTRACT §4.1/§4.2, §5), with
// calendar-aware scoring and gap-fit chips (integration #1).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  BETWEEN_LECTURES_MAX_COGNITIVE_LOAD,
  BETWEEN_LECTURES_MAX_DURATION_MINUTES,
  prioritizeTasks,
  type PrioritizedTask,
  type Task,
} from '@lodestar/shared';
import { query, queryOne } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { enrichTitles, heuristicEnrich } from '../lib/enrich.js';
import { badRequest, notFound } from '../lib/errors.js';
import { fitGap, getTodayGaps } from '../lib/schedule.js';

export interface TaskRow {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  importance: number;
  cognitive_load: number;
  duration_min: number;
  reasoning: string | null;
  enrichment_source: Task['enrichment_source'];
  due_at: Date | null;
  course_id: string | null;
  source: Task['source'];
  source_ref: string | null;
  is_completed: boolean;
  completed_at: Date | null;
  created_at: Date;
}

export function rowToTask(r: TaskRow): Task {
  return {
    ...r,
    due_at: r.due_at ? new Date(r.due_at).toISOString() : null,
    completed_at: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    created_at: new Date(r.created_at).toISOString(),
  };
}

export function scoreRows(rows: TaskRow[], now = new Date()): PrioritizedTask[] {
  const tasks = rows.map(rowToTask);
  return prioritizeTasks(tasks, now).map((s) => ({
    ...s.task,
    priority_score: Number(s.priority_score.toFixed(4)),
    is_starving: s.is_starving,
    urgency_multiplier: s.urgency_multiplier,
    deadline_bucket: s.deadline_bucket,
  }));
}

const boolQuery = z.preprocess(
  (v) => (v === 'true' || v === true ? true : v === 'false' || v === false ? false : v),
  z.boolean(),
);

const listQuerySchema = z.object({
  max_duration: z.coerce.number().int().positive().optional(),
  max_energy: z.coerce.number().int().min(1).max(5).optional(),
  between_lectures: boolQuery.optional(),
  include_completed: boolQuery.optional(),
});

const smartAddSchema = z.object({
  task_names: z.array(z.string().trim().min(1).max(300)).min(1).max(20),
});

const dueAt = z.string().datetime({ offset: true }).nullable();

const createSchema = z.object({
  title: z.string().trim().min(1).max(300),
  notes: z.string().trim().max(2000).nullish(),
  importance: z.number().int().min(1).max(10).optional(),
  cognitive_load: z.number().int().min(1).max(5).optional(),
  duration_min: z.number().int().min(1).max(1440).optional(),
  due_at: dueAt.optional(),
  course_id: z.string().uuid().nullish(),
});

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    importance: z.number().int().min(1).max(10).optional(),
    cognitive_load: z.number().int().min(1).max(5).optional(),
    duration_min: z.number().int().min(1).max(1440).optional(),
    due_at: dueAt.optional(),
    course_id: z.string().uuid().nullable().optional(),
  })
  .strict();

const idParams = z.object({ id: z.string().uuid() });

/** SQL-level filters, min-combined like the dynamicTo-Do port. */
async function listTasks(
  userId: string,
  filters: z.infer<typeof listQuerySchema>,
): Promise<TaskRow[]> {
  const where = ['user_id = $1'];
  const params: unknown[] = [userId];

  if (!filters.include_completed) where.push('is_completed = FALSE');

  const durationCaps: number[] = [];
  const energyCaps: number[] = [];
  if (filters.max_duration !== undefined) durationCaps.push(filters.max_duration);
  if (filters.max_energy !== undefined) energyCaps.push(filters.max_energy);
  if (filters.between_lectures === true) {
    durationCaps.push(BETWEEN_LECTURES_MAX_DURATION_MINUTES);
    energyCaps.push(BETWEEN_LECTURES_MAX_COGNITIVE_LOAD);
  }
  if (durationCaps.length) {
    params.push(Math.min(...durationCaps));
    where.push(`duration_min <= $${params.length}`);
  }
  if (energyCaps.length) {
    params.push(Math.min(...energyCaps));
    where.push(`cognitive_load <= $${params.length}`);
  }

  return query<TaskRow>(`SELECT * FROM tasks WHERE ${where.join(' AND ')}`, params);
}

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/api/tasks', async (request) => {
    const filters = listQuerySchema.parse(request.query);
    const rows = await listTasks(request.user.id, filters);
    return { tasks: scoreRows(rows) };
  });

  // Zero-input add: titles in, enriched + prioritized list out.
  app.post('/api/tasks/smart-add', async (request, reply) => {
    const { task_names } = smartAddSchema.parse(request.body);
    const enrichments = await enrichTitles(task_names);

    const values: string[] = [];
    const params: unknown[] = [request.user.id];
    task_names.forEach((title, i) => {
      const e = enrichments[i]!;
      const o = params.length;
      values.push(`($1, $${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6})`);
      params.push(title, e.importance, e.cognitive_load, e.duration_min, e.reasoning, e.source);
    });
    await query(
      `INSERT INTO tasks (user_id, title, importance, cognitive_load, duration_min, reasoning, enrichment_source)
       VALUES ${values.join(', ')}`,
      params,
    );

    const rows = await listTasks(request.user.id, {});
    return reply.code(201).send({ tasks: scoreRows(rows) });
  });

  // Manual create (full control; enriches whatever is missing).
  app.post('/api/tasks', async (request, reply) => {
    const body = createSchema.parse(request.body);
    const needsEnrich =
      body.importance === undefined ||
      body.cognitive_load === undefined ||
      body.duration_min === undefined;
    const e = needsEnrich ? (await enrichTitles([body.title]))[0]! : heuristicEnrich(body.title);
    const source = needsEnrich ? e.source : 'manual';

    const row = await queryOne<TaskRow>(
      `INSERT INTO tasks (user_id, title, notes, importance, cognitive_load, duration_min,
                          reasoning, enrichment_source, due_at, course_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        request.user.id,
        body.title,
        body.notes ?? null,
        body.importance ?? e.importance,
        body.cognitive_load ?? e.cognitive_load,
        body.duration_min ?? e.duration_min,
        needsEnrich ? e.reasoning : null,
        source,
        body.due_at ?? null,
        body.course_id ?? null,
      ],
    );
    return reply.code(201).send({ task: rowToTask(row!) });
  });

  app.patch('/api/tasks/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = patchSchema.parse(request.body);
    if (Object.keys(body).length === 0) throw badRequest('Nothing to update.');

    const current = await queryOne<TaskRow>(
      'SELECT * FROM tasks WHERE id = $1 AND user_id = $2',
      [id, request.user.id],
    );
    if (!current) throw notFound('Task not found.');

    const row = await queryOne<TaskRow>(
      `UPDATE tasks
       SET title = $3, notes = $4, importance = $5, cognitive_load = $6, duration_min = $7,
           due_at = $8, course_id = $9
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [
        id,
        request.user.id,
        body.title ?? current.title,
        body.notes !== undefined ? body.notes : current.notes,
        body.importance ?? current.importance,
        body.cognitive_load ?? current.cognitive_load,
        body.duration_min ?? current.duration_min,
        body.due_at !== undefined ? body.due_at : current.due_at,
        body.course_id !== undefined ? body.course_id : current.course_id,
      ],
    );
    return { task: rowToTask(row!) };
  });

  app.post('/api/tasks/:id/toggle', async (request) => {
    const { id } = idParams.parse(request.params);
    const row = await queryOne<TaskRow>(
      `UPDATE tasks
       SET is_completed = NOT is_completed,
           completed_at = CASE WHEN is_completed THEN NULL ELSE now() END
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, request.user.id],
    );
    if (!row) throw notFound('Task not found.');
    return { task: rowToTask(row) };
  });

  app.delete('/api/tasks/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const rows = await query('DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id', [
      id,
      request.user.id,
    ]);
    if (!rows.length) throw notFound('Task not found.');
    return { ok: true };
  });

  // The order of execution + today's lecture gaps (integration #1).
  app.get('/api/tasks/plan', async (request) => {
    const rows = await listTasks(request.user.id, {});
    const gaps = await getTodayGaps(request.user.id, request.user.tz);
    const tasks = scoreRows(rows).map((t) => ({
      ...t,
      fits_gap: fitGap(t.duration_min, gaps),
    }));
    return { tasks, gaps };
  });
}

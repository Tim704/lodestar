// Watchers module — CRUD + manual run + hit history (CONTRACT §5).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { getWatcher, runWatcher } from '../lib/scrape.js';

const idParams = z.object({ id: z.string().uuid() });

const watcherSchema = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().url().max(500),
  mode: z.enum(['css', 'regex']),
  selector: z.string().trim().min(1).max(500),
  exclude_pattern: z.string().trim().max(200).nullish(),
  notify_on: z.enum(['appear', 'disappear']).default('appear'),
  interval_min: z.number().int().min(5).max(24 * 60).default(30),
  active: z.boolean().default(true),
  create_task: z.boolean().default(false),
  task_hint: z.string().trim().max(120).nullish(),
});

function validateSelector(mode: 'css' | 'regex', selector: string): void {
  if (mode === 'regex') {
    try {
      new RegExp(selector, 'gi'); // gi per CONTRACT §4.8 (v2)
    } catch (err) {
      throw badRequest(`Invalid regex: ${(err as Error).message}`);
    }
  }
}

const LIST_SQL = `
  SELECT id, user_id, name, url, mode, selector, exclude_pattern, notify_on, interval_min, active,
         create_task, task_hint, last_run_at, last_status, last_error,
         COALESCE(jsonb_array_length(state->'known'), 0) AS known_count
  FROM watchers`;

export async function watcherRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/api/watchers', async (request) => {
    const rows = await query(`${LIST_SQL} WHERE user_id = $1 ORDER BY created_at`, [
      request.user.id,
    ]);
    return { watchers: rows };
  });

  app.post('/api/watchers', async (request, reply) => {
    const body = watcherSchema.parse(request.body);
    validateSelector(body.mode, body.selector);
    const row = await queryOne(
      `INSERT INTO watchers (user_id, name, url, mode, selector, exclude_pattern, notify_on,
                             interval_min, active, create_task, task_hint)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        request.user.id,
        body.name,
        body.url,
        body.mode,
        body.selector,
        body.exclude_pattern ?? null,
        body.notify_on,
        body.interval_min,
        body.active,
        body.create_task,
        body.task_hint ?? null,
      ],
    );
    const created = await queryOne(`${LIST_SQL} WHERE id = $1`, [(row as { id: string }).id]);
    return reply.code(201).send({ watcher: created });
  });

  app.patch('/api/watchers/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = watcherSchema.partial().parse(request.body);
    const current = await queryOne<Record<string, unknown>>(
      'SELECT * FROM watchers WHERE id = $1 AND user_id = $2',
      [id, request.user.id],
    );
    if (!current) throw notFound('Watcher not found.');
    const mode = (body.mode ?? current.mode) as 'css' | 'regex';
    const selector = (body.selector ?? current.selector) as string;
    validateSelector(mode, selector);

    await query(
      `UPDATE watchers
       SET name = $3, url = $4, mode = $5, selector = $6, exclude_pattern = $7,
           notify_on = $8, interval_min = $9, active = $10, create_task = $11, task_hint = $12
       WHERE id = $1 AND user_id = $2`,
      [
        id,
        request.user.id,
        body.name ?? current.name,
        body.url ?? current.url,
        mode,
        selector,
        body.exclude_pattern !== undefined ? body.exclude_pattern : current.exclude_pattern,
        body.notify_on ?? current.notify_on,
        body.interval_min ?? current.interval_min,
        body.active ?? current.active,
        body.create_task ?? current.create_task,
        body.task_hint !== undefined ? body.task_hint : current.task_hint,
      ],
    );
    const updated = await queryOne(`${LIST_SQL} WHERE id = $1`, [id]);
    return { watcher: updated };
  });

  app.delete('/api/watchers/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const rows = await query('DELETE FROM watchers WHERE id = $1 AND user_id = $2 RETURNING id', [
      id,
      request.user.id,
    ]);
    if (!rows.length) throw notFound('Watcher not found.');
    return { ok: true };
  });

  app.post('/api/watchers/:id/run', async (request) => {
    const { id } = idParams.parse(request.params);
    const w = await getWatcher(id, request.user.id);
    if (!w) throw notFound('Watcher not found.');
    const result = await runWatcher(w);
    const watcher = await queryOne(`${LIST_SQL} WHERE id = $1`, [id]);
    return { result, watcher };
  });

  app.get('/api/watchers/:id/hits', async (request) => {
    const { id } = idParams.parse(request.params);
    const w = await queryOne('SELECT 1 FROM watchers WHERE id = $1 AND user_id = $2', [
      id,
      request.user.id,
    ]);
    if (!w) throw notFound('Watcher not found.');
    const hits = await query(
      'SELECT * FROM watcher_hits WHERE watcher_id = $1 ORDER BY seen_at DESC LIMIT 100',
      [id],
    );
    return { hits };
  });
}

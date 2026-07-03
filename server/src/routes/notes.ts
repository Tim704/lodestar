// Notes module — tabs CRUD, the Yjs WebSocket endpoint, and checklist-item →
// task promotion (integration #3).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db.js';
import { loadUserFromCookies, requireAuth } from '../lib/auth.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { enrichTitles } from '../lib/enrich.js';
import { handleNotesSocket } from '../lib/yjs.js';
import { rowToTask, type TaskRow } from './tasks.js';

const idParams = z.object({ id: z.string().uuid() });

async function canAccessTab(userId: string, tabId: string): Promise<boolean> {
  const row = await queryOne(
    `SELECT 1 FROM note_tabs t
     WHERE t.id = $2 AND (
       t.owner_id = $1
       OR t.group_id IN (SELECT group_id FROM memberships WHERE user_id = $1)
     )`,
    [userId, tabId],
  );
  return Boolean(row);
}

export async function noteRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/api/notes/tabs', async (request) => {
    const rows = await query(
      `SELECT id, owner_id, group_id, name, sort FROM note_tabs
       WHERE owner_id = $1
          OR group_id IN (SELECT group_id FROM memberships WHERE user_id = $1)
       ORDER BY sort, name`,
      [request.user.id],
    );
    return { tabs: rows };
  });

  app.post('/api/notes/tabs', async (request, reply) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(60),
        group_id: z.string().uuid().nullish(),
      })
      .parse(request.body);
    if (body.group_id) {
      const member = await queryOne(
        'SELECT 1 FROM memberships WHERE user_id = $1 AND group_id = $2',
        [request.user.id, body.group_id],
      );
      if (!member) throw forbidden('You are not in that group.');
    }
    const row = await queryOne(
      `INSERT INTO note_tabs (owner_id, group_id, name, sort)
       VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort), 0) + 1 FROM note_tabs WHERE owner_id = $1))
       RETURNING id, owner_id, group_id, name, sort`,
      [request.user.id, body.group_id ?? null, body.name],
    );
    return reply.code(201).send({ tab: row });
  });

  app.patch('/api/notes/tabs/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = z
      .object({
        name: z.string().trim().min(1).max(60).optional(),
        sort: z.number().int().optional(),
      })
      .parse(request.body);
    const row = await queryOne(
      `UPDATE note_tabs SET name = COALESCE($3, name), sort = COALESCE($4, sort)
       WHERE id = $1 AND owner_id = $2
       RETURNING id, owner_id, group_id, name, sort`,
      [id, request.user.id, body.name ?? null, body.sort ?? null],
    );
    if (!row) throw notFound('Tab not found (only the owner can edit it).');
    return { tab: row };
  });

  app.delete('/api/notes/tabs/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const rows = await query(
      'DELETE FROM note_tabs WHERE id = $1 AND owner_id = $2 RETURNING id',
      [id, request.user.id],
    );
    if (!rows.length) throw notFound('Tab not found (only the owner can delete it).');
    return { ok: true };
  });

  // Checklist item → enriched task (integration #3)
  app.post('/api/notes/promote', async (request, reply) => {
    const body = z
      .object({
        tab_id: z.string().uuid(),
        note_id: z.string().min(1).max(120),
        text: z.string().trim().min(1).max(300),
      })
      .parse(request.body);
    if (!(await canAccessTab(request.user.id, body.tab_id))) {
      throw forbidden('No access to that tab.');
    }
    const e = (await enrichTitles([body.text]))[0]!;
    const row = await queryOne<TaskRow>(
      `INSERT INTO tasks (user_id, title, importance, cognitive_load, duration_min, reasoning,
                          enrichment_source, source, source_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'note', $8)
       RETURNING *`,
      [
        request.user.id,
        body.text,
        e.importance,
        e.cognitive_load,
        e.duration_min,
        e.reasoning,
        e.source,
        `${body.tab_id}:${body.note_id}`,
      ],
    );
    return reply.code(201).send({ task: rowToTask(row!) });
  });
}

/** WS endpoint — plain fastify route with websocket:true, cookie-authed. */
export async function noteSocketRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ws/notes/:tabId', { websocket: true }, (socket, request) => {
    void (async () => {
      const params = z.object({ tabId: z.string().uuid() }).safeParse(request.params);
      if (!params.success) {
        socket.close(4400, 'bad tab id');
        return;
      }
      const user = await loadUserFromCookies(request.cookies);
      if (!user) {
        socket.close(4401, 'not signed in');
        return;
      }
      if (!(await canAccessTab(user.id, params.data.tabId))) {
        socket.close(4403, 'no access');
        return;
      }
      await handleNotesSocket(socket, params.data.tabId);
    })().catch((err) => {
      console.error('[notes-ws] setup failed:', (err as Error).message);
      socket.close(1011, 'internal error');
    });
  });
}

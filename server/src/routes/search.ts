// Global search — the command bar's backend (CONTRACT §5): ILIKE across
// tasks, events, the note index, media, and courses; ≤8 hits per bucket.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SearchResults } from '@lodestar/shared';
import { query } from '../db.js';
import { requireAuth } from '../lib/auth.js';

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/api/search', async (request): Promise<SearchResults> => {
    const { q } = z.object({ q: z.string().trim().min(1).max(120) }).parse(request.query);
    const like = `%${q}%`;
    const uid = request.user.id;

    const [tasks, events, notes, media, courses] = await Promise.all([
      query(
        `SELECT id, title, is_completed FROM tasks
         WHERE user_id = $1 AND title ILIKE $2
         ORDER BY is_completed, created_at DESC LIMIT 8`,
        [uid, like],
      ),
      query(
        `SELECT id, title, start_date, start_utc FROM events
         WHERE (owner_id = $1 OR group_id IN (SELECT group_id FROM memberships WHERE user_id = $1))
           AND title ILIKE $2
         ORDER BY COALESCE(start_utc, start_date::timestamptz) DESC LIMIT 8`,
        [uid, like],
      ),
      query(
        `SELECT n.note_id, n.tab_id, n.title, n.snippet FROM note_index n
         JOIN note_tabs t ON t.id = n.tab_id
         WHERE (t.owner_id = $1 OR t.group_id IN (SELECT group_id FROM memberships WHERE user_id = $1))
           AND (n.title ILIKE $2 OR n.snippet ILIKE $2)
         ORDER BY n.updated_at DESC LIMIT 8`,
        [uid, like],
      ),
      query(
        `SELECT id, title, domain, status FROM media_items
         WHERE user_id = $1 AND (title ILIKE $2 OR creator ILIKE $2)
         ORDER BY updated_at DESC LIMIT 8`,
        [uid, like],
      ),
      query(
        `SELECT id, name FROM courses WHERE user_id = $1 AND name ILIKE $2 ORDER BY name LIMIT 8`,
        [uid, like],
      ),
    ]);

    return { tasks, events, notes, media, courses } as SearchResults;
  });
}

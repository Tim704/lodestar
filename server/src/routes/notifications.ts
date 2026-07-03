// Notification hub read-side (integration #7) — the bell.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth } from '../lib/auth.js';

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/api/notifications', async (request) => {
    const q = z
      .object({
        unread: z
          .enum(['true', 'false'])
          .optional()
          .transform((v) => v === 'true'),
      })
      .parse(request.query);
    const rows = q.unread
      ? await query(
          `SELECT * FROM notifications WHERE user_id = $1 AND read_at IS NULL
           ORDER BY created_at DESC LIMIT 100`,
          [request.user.id],
        )
      : await query(
          `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
          [request.user.id],
        );
    const unreadCount = await query<{ n: string }>(
      'SELECT count(*)::text AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL',
      [request.user.id],
    );
    return { notifications: rows, unread: Number(unreadCount[0]?.n ?? 0) };
  });

  app.post('/api/notifications/read', async (request) => {
    const body = z
      .object({ ids: z.array(z.string().uuid()).max(200).optional() })
      .parse(request.body ?? {});
    if (body.ids?.length) {
      await query(
        'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2) AND read_at IS NULL',
        [request.user.id, body.ids],
      );
    } else {
      await query(
        'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
        [request.user.id],
      );
    }
    return { ok: true };
  });
}

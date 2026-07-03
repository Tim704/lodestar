// GET /api/today — the composite dashboard where the six modules meet
// (CONTRACT §5): today's events + lectures + gaps, the top of the order of
// execution with gap-fit chips, pace warnings, habits, backlog suggestions,
// the briefing, and the unread count.

import type { FastifyInstance } from 'fastify';
import type { TodayPayload } from '@lodestar/shared';
import { queryOne } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { computeGaps, fitGap, getLectureBlocks, todayInTz } from '../lib/schedule.js';
import {
  isOnBreak,
  mediaSuggestions,
  paceWarnings,
  topOpenTasks,
} from '../lib/assistant.js';
import { visibleEvents } from './calendar.js';
import { habitsWithToday } from './habits.js';

export async function todayRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/api/today', async (request): Promise<TodayPayload> => {
    const user = request.user;
    const { date, weekday } = todayInTz(user.tz);

    const [events, blocks] = await Promise.all([
      visibleEvents(user.id, date, date),
      getLectureBlocks(user.id, date, weekday),
    ]);
    const gaps = computeGaps(blocks);

    const [tasks, warnings, habits, media, onBreak, unread, briefing] = await Promise.all([
      topOpenTasks(user.id, 8),
      paceWarnings(user.id),
      habitsWithToday(user.id, user.tz),
      mediaSuggestions(user, events, blocks, date),
      isOnBreak(user.id, date),
      queryOne<{ n: string }>(
        'SELECT count(*)::text AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL',
        [user.id],
      ),
      queryOne(
        `SELECT id, kind, for_date, content, meta, created_at FROM assistant_docs
         WHERE user_id = $1 AND kind = 'briefing' AND for_date = $2`,
        [user.id, date],
      ),
    ]);

    return {
      date,
      events,
      lecture_blocks: blocks,
      gaps,
      top_tasks: tasks.map((t) => ({ ...t, fits_gap: fitGap(t.duration_min, gaps) })),
      pace_warnings: warnings,
      habits,
      media_suggestions: media.items,
      media_reason: media.reason,
      unread_notifications: Number(unread?.n ?? 0),
      briefing: (briefing as TodayPayload['briefing']) ?? null,
      on_break: onBreak,
    };
  });
}

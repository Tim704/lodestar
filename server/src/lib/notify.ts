// The notification hub (integration #7) — every module notifies through here:
// one in-app row, plus an ntfy push when the user (or the instance) has a topic.
import { config } from '../config.js';
import { query, queryOne } from '../db.js';
import { postNtfy } from './ntfy.js';

export interface NotifyArgs {
  type: string; // 'watcher' | 'pace' | 'briefing' | 'review' | …
  title: string;
  body?: string;
  link?: string;
  priority?: 'default' | 'high';
  tags?: string;
}

export async function notify(userId: string, args: NotifyArgs): Promise<void> {
  await query(
    `INSERT INTO notifications (user_id, type, title, body, link)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, args.type, args.title, args.body ?? null, args.link ?? null],
  );

  const row = await queryOne<{ settings: { ntfy_topic?: unknown } }>(
    'SELECT settings FROM users WHERE id = $1',
    [userId],
  );
  const userTopic =
    typeof row?.settings?.ntfy_topic === 'string' ? row.settings.ntfy_topic : '';
  const topic = userTopic || config.ntfy.defaultTopic;
  if (topic) {
    // fire-and-forget; postNtfy never throws
    void postNtfy(topic, {
      title: args.title,
      body: args.body ?? '',
      priority: args.priority ?? 'default',
      tags: args.tags ?? 'star',
    });
  }
}

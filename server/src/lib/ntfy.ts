// ntfy push — ported from checkRosenberg's send_alert(). Fire-and-forget:
// a dead ntfy server must never break an API request or a job tick.
import { config } from '../config.js';

export async function postNtfy(
  topic: string,
  args: { title: string; body: string; priority?: 'default' | 'high'; tags?: string },
): Promise<void> {
  if (!topic) return;
  try {
    const res = await fetch(`${config.ntfy.server}/${encodeURIComponent(topic)}`, {
      method: 'POST',
      body: args.body,
      headers: {
        Title: args.title,
        Priority: args.priority ?? 'default',
        ...(args.tags ? { Tags: args.tags } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[ntfy] ${res.status} posting to topic ${topic.slice(0, 4)}****`);
    }
  } catch (err) {
    console.warn('[ntfy] post failed:', (err as Error).message);
  }
}

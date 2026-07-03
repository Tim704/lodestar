// Watcher engine — checkRosenberg generalized (integration #4): fetch any URL
// on a schedule, extract items by CSS selector or regex, diff against known
// state, then notify + optionally spawn a task. Plain fetch (no headless
// browser on the Pi); JS-rendered pages are out of scope for v1.

import { parse as parseHtml } from 'node-html-parser';
import { query, queryOne } from '../db.js';
import { notify } from './notify.js';

const FETCH_TIMEOUT = 30_000;
const MAX_BODY_BYTES = 2_000_000;
const MAX_ITEMS_PER_RUN = 200;
const MAX_KNOWN = 1000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export interface WatcherRow {
  id: string;
  user_id: string;
  name: string;
  url: string;
  mode: 'css' | 'regex';
  selector: string;
  exclude_pattern: string | null;
  create_task: boolean;
  task_hint: string | null;
  state: { known?: string[] };
}

const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim();

export function extractItems(
  body: string,
  mode: 'css' | 'regex',
  selector: string,
): string[] {
  const items: string[] = [];
  if (mode === 'css') {
    const root = parseHtml(body);
    for (const el of root.querySelectorAll(selector)) {
      const text = normalize(el.text);
      if (text) items.push(text.slice(0, 300));
      if (items.length >= MAX_ITEMS_PER_RUN) break;
    }
  } else {
    const re = new RegExp(selector, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null && items.length < MAX_ITEMS_PER_RUN) {
      const text = normalize(m[1] ?? m[0]);
      if (text) items.push(text.slice(0, 300));
      if (m.index === re.lastIndex) re.lastIndex++; // zero-width safety
    }
  }
  return [...new Set(items)];
}

export interface RunResult {
  ok: boolean;
  error?: string;
  found: number;
  new_items: string[];
}

export async function runWatcher(w: WatcherRow): Promise<RunResult> {
  let result: RunResult;
  try {
    const res = await fetch(w.url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,*/*' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.text()).slice(0, MAX_BODY_BYTES);

    let items = extractItems(body, w.mode, w.selector);
    if (w.exclude_pattern) {
      try {
        const ex = new RegExp(w.exclude_pattern, 'i');
        items = items.filter((i) => !ex.test(i)); // e.g. drop "Belegt" rows
      } catch {
        /* bad exclude pattern — ignore it rather than break the watcher */
      }
    }

    const known = new Set(w.state.known ?? []);
    const newItems = items.filter((i) => !known.has(i));
    result = { ok: true, found: items.length, new_items: newItems };

    const mergedKnown = [...known, ...newItems].slice(-MAX_KNOWN);
    await query(
      `UPDATE watchers
       SET last_run_at = now(), last_status = 'ok', last_error = NULL, state = $2
       WHERE id = $1`,
      [w.id, JSON.stringify({ known: mergedKnown })],
    );

    if (newItems.length) {
      for (const item of newItems) {
        await query('INSERT INTO watcher_hits (watcher_id, item) VALUES ($1, $2)', [w.id, item]);
      }
      const preview = newItems.slice(0, 5).join('\n');
      await notify(w.user_id, {
        type: 'watcher',
        title: `${w.name}: ${newItems.length} new`,
        body: preview + (newItems.length > 5 ? `\n…and ${newItems.length - 5} more` : ''),
        link: '/watchers',
        priority: 'high',
        tags: 'eyes',
      });
      if (w.create_task) {
        // one task per run, not per item — a burst of hits is one action
        const first = newItems[0]!;
        await query(
          `INSERT INTO tasks (user_id, title, importance, cognitive_load, duration_min,
                              enrichment_source, source, source_ref)
           VALUES ($1, $2, 8, 1, 15, 'heuristic', 'watcher', $3)`,
          [
            w.user_id,
            `${w.task_hint || `Act on ${w.name}`}: ${first.slice(0, 120)}`,
            w.id,
          ],
        );
      }
    }
  } catch (err) {
    const message = (err as Error).message.slice(0, 300);
    await query(
      `UPDATE watchers SET last_run_at = now(), last_status = 'error', last_error = $2
       WHERE id = $1`,
      [w.id, message],
    );
    result = { ok: false, error: message, found: 0, new_items: [] };
  }
  return result;
}

/** All active watchers whose interval has elapsed — the scheduler's work list. */
export async function dueWatchers(): Promise<WatcherRow[]> {
  return query<WatcherRow>(
    `SELECT id, user_id, name, url, mode, selector, exclude_pattern, create_task, task_hint, state
     FROM watchers
     WHERE active
       AND (last_run_at IS NULL OR last_run_at + (interval_min || ' minutes')::interval <= now())
     ORDER BY last_run_at NULLS FIRST
     LIMIT 10`,
  );
}

export async function getWatcher(id: string, userId: string): Promise<WatcherRow | null> {
  return queryOne<WatcherRow>(
    `SELECT id, user_id, name, url, mode, selector, exclude_pattern, create_task, task_hint, state
     FROM watchers WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
}

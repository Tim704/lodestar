// In-process scheduler — CONTRACT §7. One 60 s tick, all jobs idempotent
// (existence checks / job_state dedupe), all times in each user's timezone.

import { query, queryOne } from '../db.js';
import type { UserRow } from '../lib/auth.js';
import { briefingHour, generateBriefing, generateWeeklyReview, paceWarnings } from '../lib/assistant.js';
import { notify } from '../lib/notify.js';
import { nowInTz } from '../lib/schedule.js';
import { dueWatchers, runWatcher } from '../lib/scrape.js';

const TICK_MS = 60_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

async function getJobState(key: string): Promise<unknown> {
  const row = await queryOne<{ value: unknown }>('SELECT value FROM job_state WHERE key = $1', [
    key,
  ]);
  return row?.value ?? null;
}

async function setJobState(key: string, value: unknown): Promise<void> {
  await query(
    `INSERT INTO job_state (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)],
  );
}

async function runWatchersJob(): Promise<void> {
  const due = await dueWatchers();
  for (const w of due) {
    const result = await runWatcher(w);
    if (!result.ok) console.warn(`[cron] watcher "${w.name}" failed: ${result.error}`);
    else if (result.new_items.length) {
      console.log(`[cron] watcher "${w.name}": ${result.new_items.length} new item(s)`);
    }
  }
}

async function runBriefingJob(user: UserRow): Promise<void> {
  const local = nowInTz(user.tz);
  if (local.hour !== briefingHour(user)) return;
  const date = local.toISODate()!;
  const existing = await queryOne(
    `SELECT 1 FROM assistant_docs WHERE user_id = $1 AND kind = 'briefing' AND for_date = $2`,
    [user.id, date],
  );
  if (existing) return;
  await generateBriefing(user, date);
  await notify(user.id, {
    type: 'briefing',
    title: 'Your morning telegram is ready',
    body: 'Lectures, gaps, the order of execution, and one nudge.',
    link: '/',
    tags: 'newspaper',
  });
  console.log(`[cron] briefing generated for ${user.username} (${date})`);
}

/** §4.7 — auto study tasks for behind-pace courses, once per course per day. */
async function runPaceJob(user: UserRow): Promise<void> {
  const local = nowInTz(user.tz);
  if (local.hour !== 4) return;
  const date = local.toISODate()!;
  const stateKey = `pace:${user.id}`;
  if ((await getJobState(stateKey)) === date) return;
  await setJobState(stateKey, date);

  const warnings = await paceWarnings(user.id);
  for (const w of warnings) {
    const open = await queryOne(
      `SELECT 1 FROM tasks WHERE user_id = $1 AND source = 'study' AND source_ref = $2
         AND NOT is_completed`,
      [user.id, w.course_id],
    );
    if (open) continue;
    await query(
      `INSERT INTO tasks (user_id, title, importance, cognitive_load, duration_min,
                          enrichment_source, source, source_ref, course_id)
       VALUES ($1, $2, 8, 4, 60, 'heuristic', 'study', $3, $3)`,
      [user.id, `Study ${w.course_name}: ${w.deficit_hours}h behind pace`, w.course_id],
    );
    await notify(user.id, {
      type: 'pace',
      title: `${w.course_name} is behind pace`,
      body: `${w.deficit_hours}h to make up — needs ${w.required_velocity}h/day. A study task was added; book a block from the Study tab.`,
      link: '/study',
      tags: 'books',
    });
  }
}

async function runReviewJob(user: UserRow): Promise<void> {
  const local = nowInTz(user.tz);
  if (local.weekday !== 7 || local.hour !== 17) return; // Sunday 17:00 local
  const monday = local.startOf('week').toISODate()!;
  const existing = await queryOne(
    `SELECT 1 FROM assistant_docs WHERE user_id = $1 AND kind = 'review' AND for_date = $2`,
    [user.id, monday],
  );
  if (existing) return;
  await generateWeeklyReview(user, monday);
  await notify(user.id, {
    type: 'review',
    title: 'Weekly review is in',
    body: 'What got done, what slipped, and one suggestion for next week.',
    link: '/review',
    tags: 'scroll',
  });
  console.log(`[cron] weekly review generated for ${user.username} (week of ${monday})`);
}

async function tick(): Promise<void> {
  if (running) return; // a slow tick must never stack
  running = true;
  try {
    await runWatchersJob().catch((err) => console.error('[cron] watchers:', err.message));
    const users = await query<UserRow>('SELECT * FROM users');
    for (const user of users) {
      await runBriefingJob(user).catch((err) =>
        console.error(`[cron] briefing (${user.username}):`, err.message),
      );
      await runPaceJob(user).catch((err) =>
        console.error(`[cron] pace (${user.username}):`, err.message),
      );
      await runReviewJob(user).catch((err) =>
        console.error(`[cron] review (${user.username}):`, err.message),
      );
    }
  } catch (err) {
    console.error('[cron] tick failed:', (err as Error).message);
  } finally {
    running = false;
  }
}

export function startScheduler(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
  console.log('[cron] scheduler started (60s tick)');
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

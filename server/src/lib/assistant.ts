// The Lodestar assistant (integrations #5 & #6): daily briefing + weekly
// review in Florence's wry telegram voice, media suggestions for free
// evenings, all with plain-template fallbacks when Gemini is unconfigured.

import { DateTime } from 'luxon';
import type {
  AssistantDoc,
  CalendarEvent,
  HabitToday,
  LectureBlock,
  MediaItem,
  PaceWarning,
  PrioritizedTask,
} from '@lodestar/shared';
import { query, queryOne } from '../db.js';
import type { UserRow } from './auth.js';
import { userSettings } from './auth.js';
import { generateText, isGeminiConfigured } from './gemini.js';
import { computeGaps, getLectureBlocks, nowInTz, todayInTz } from './schedule.js';
import { visibleEvents } from '../routes/calendar.js';
import { scoreRows, type TaskRow } from '../routes/tasks.js';
import { activeSemester, courseOverviews } from '../routes/study.js';
import { habitsWithToday } from '../routes/habits.js';

// ── building blocks ──────────────────────────────────────────────────────────

export async function topOpenTasks(userId: string, limit: number): Promise<PrioritizedTask[]> {
  const rows = await query<TaskRow>(
    'SELECT * FROM tasks WHERE user_id = $1 AND NOT is_completed',
    [userId],
  );
  return scoreRows(rows).slice(0, limit);
}

export async function paceWarnings(userId: string): Promise<PaceWarning[]> {
  const semester = await activeSemester(userId);
  if (!semester) return [];
  const today = new Date().toISOString().slice(0, 10);
  if (today < semester.start_date || today > semester.end_date) return [];
  const overviews = await courseOverviews(userId, semester);
  return overviews
    .filter((c) => c.pace.status === 'behind')
    .map((c) => ({
      course_id: c.id,
      course_name: c.name,
      deficit_hours: c.pace.deficit_hours,
      required_velocity: c.pace.required_velocity,
      predicted_grade: c.pace.predicted_grade,
    }));
}

export async function isOnBreak(userId: string, localDate: string): Promise<boolean> {
  const row = await queryOne(
    `SELECT 1 FROM terms WHERE user_id = $1 AND kind = 'break'
       AND start_date <= $2::date AND end_date >= $2::date`,
    [userId, localDate],
  );
  return Boolean(row);
}

/**
 * Free evening (CONTRACT §6.5): no lecture block and no timed event that
 * overlaps 17:00–23:00 local today.
 */
export async function hasFreeEvening(
  user: UserRow,
  events: CalendarEvent[],
  blocks: LectureBlock[],
): Promise<boolean> {
  if (blocks.some((b) => b.end > '17:00')) return false;
  const local = nowInTz(user.tz);
  const eveStart = local.set({ hour: 17, minute: 0, second: 0, millisecond: 0 });
  const eveEnd = local.set({ hour: 23, minute: 0, second: 0, millisecond: 0 });
  for (const e of events) {
    if (e.all_day || !e.start_utc || !e.end_utc) continue;
    const s = DateTime.fromISO(e.start_utc).setZone(user.tz);
    const en = DateTime.fromISO(e.end_utc).setZone(user.tz);
    if (s < eveEnd && en > eveStart) return false;
  }
  return true;
}

export interface MediaSuggestion {
  items: MediaItem[];
  reason: string | null;
}

/** Integration #5: the backlog as a reward layer. Oldest planned items first. */
export async function mediaSuggestions(
  user: UserRow,
  events: CalendarEvent[],
  blocks: LectureBlock[],
  localDate: string,
): Promise<MediaSuggestion> {
  const onBreak = await isOnBreak(user.id, localDate);
  const freeEvening = await hasFreeEvening(user, events, blocks);
  if (!onBreak && !freeEvening) return { items: [], reason: null };

  const items = await query<MediaItem>(
    `SELECT * FROM media_items WHERE user_id = $1 AND status = 'PLANNED'
     ORDER BY created_at ASC LIMIT 3`,
    [user.id],
  );
  if (!items.length) return { items: [], reason: null };
  return {
    items,
    reason: onBreak
      ? 'You are on a break — the backlog has been waiting.'
      : 'Free evening ahead — the backlog has been waiting.',
  };
}

// ── briefing data + rendering ───────────────────────────────────────────────

export interface BriefingData {
  date: string;
  weekdayName: string;
  events: CalendarEvent[];
  blocks: LectureBlock[];
  gaps: ReturnType<typeof computeGaps>;
  tasks: PrioritizedTask[];
  warnings: PaceWarning[];
  habits: HabitToday[];
  media: MediaSuggestion;
}

export async function collectBriefingData(user: UserRow): Promise<BriefingData> {
  const { date, weekday } = todayInTz(user.tz);
  const events = await visibleEvents(user.id, date, date);
  const blocks = await getLectureBlocks(user.id, date, weekday);
  return {
    date,
    weekdayName: nowInTz(user.tz).toFormat('cccc, d LLLL'),
    events,
    blocks,
    gaps: computeGaps(blocks),
    tasks: await topOpenTasks(user.id, 5),
    warnings: await paceWarnings(user.id),
    habits: await habitsWithToday(user.id, user.tz),
    media: await mediaSuggestions(user, events, blocks, date),
  };
}

function fmtEvent(e: CalendarEvent, tz: string): string {
  if (e.all_day) return `${e.icon ? e.icon + ' ' : ''}${e.title} (all day)`;
  const s = DateTime.fromISO(e.start_utc!).setZone(tz).toFormat('HH:mm');
  return `${s} ${e.icon ? e.icon + ' ' : ''}${e.title}`;
}

export function renderFallbackBriefing(user: UserRow, d: BriefingData): string {
  const lines: string[] = [`**${d.weekdayName}** — telegram for ${user.display_name}.`, ''];
  if (d.blocks.length) {
    lines.push('**Lectures**');
    for (const b of d.blocks) lines.push(`- ${b.start}–${b.end} ${b.course_name}`);
    for (const g of d.gaps) lines.push(`- ↳ ${g.minutes} min gap at ${g.start} — room for a quick win`);
    lines.push('');
  }
  if (d.events.length) {
    lines.push('**On the calendar**');
    for (const e of d.events.slice(0, 5)) lines.push(`- ${fmtEvent(e, user.tz)}`);
    lines.push('');
  }
  if (d.tasks.length) {
    lines.push('**Order of execution**');
    d.tasks.forEach((t, i) =>
      lines.push(
        `${i + 1}. ${t.title} (~${t.duration_min} min${t.deadline_bucket !== 'none' ? ', due soon' : ''}${t.is_starving ? ', starving' : ''})`,
      ),
    );
    lines.push('');
  }
  if (d.warnings.length) {
    lines.push('**Pace**');
    for (const w of d.warnings) {
      lines.push(`- ${w.course_name}: ${w.deficit_hours}h behind — needs ${w.required_velocity}h/day`);
    }
    lines.push('');
  }
  if (d.media.items.length) {
    lines.push(`**Off duty** — ${d.media.reason}`);
    for (const m of d.media.items) lines.push(`- ${m.title} (${m.domain})`);
    lines.push('');
  }
  if (!d.blocks.length && !d.events.length && !d.tasks.length) {
    lines.push('A blank page of a day. Fill it deliberately.');
    lines.push('');
  }
  lines.push('— ✦ Lodestar');
  return lines.join('\n');
}

const TELEGRAM_VOICE =
  'You are the Lodestar bureau clerk: you file wry, warm, slightly old-fashioned telegrams ' +
  'about the user\'s day (kin to Florence of the Seismic Travel Bureau). Write a morning ' +
  'briefing in markdown, under 180 words, addressed to the user by name. Cover, in this order ' +
  'and only when present: lectures & the gaps between them (suggest using a gap for a quick task), ' +
  'calendar events, the top of their order of execution, study-pace warnings (be firm but kind), ' +
  'habit streaks worth guarding, and — only if offered — a backlog suggestion for the evening. ' +
  'No preamble, no headers larger than bold. Sign off with "— ✦ Lodestar".';

export async function generateBriefing(user: UserRow, forDate: string): Promise<AssistantDoc> {
  const data = await collectBriefingData(user);
  let content: string;
  if (isGeminiConfigured()) {
    try {
      content = await generateText({
        system: TELEGRAM_VOICE,
        user: JSON.stringify({
          name: user.display_name,
          date: data.weekdayName,
          lectures: data.blocks,
          gaps: data.gaps,
          events: data.events.map((e) => fmtEvent(e, user.tz)),
          tasks: data.tasks.map((t) => ({
            title: t.title,
            minutes: t.duration_min,
            due: t.deadline_bucket,
            starving: t.is_starving,
          })),
          pace_warnings: data.warnings,
          habit_streaks: data.habits.map((h) => ({ name: h.name, streak: h.streak })),
          backlog_suggestion: data.media.items.map((m) => `${m.title} (${m.domain})`),
          backlog_reason: data.media.reason,
        }),
        temperature: 0.8,
        maxOutputTokens: 1024,
      });
    } catch (err) {
      console.warn('[assistant] briefing via Gemini failed:', (err as Error).message);
      content = renderFallbackBriefing(user, data);
    }
  } else {
    content = renderFallbackBriefing(user, data);
  }

  const row = await queryOne<AssistantDoc>(
    `INSERT INTO assistant_docs (user_id, kind, for_date, content, meta)
     VALUES ($1, 'briefing', $2, $3, $4)
     ON CONFLICT (user_id, kind, for_date)
     DO UPDATE SET content = EXCLUDED.content, meta = EXCLUDED.meta, created_at = now()
     RETURNING id, kind, for_date, content, meta, created_at`,
    [user.id, forDate, content, JSON.stringify({ generator: isGeminiConfigured() ? 'gemini' : 'fallback' })],
  );
  return row!;
}

// ── weekly review ────────────────────────────────────────────────────────────

const REVIEW_VOICE =
  'You are the Lodestar bureau clerk writing the WEEKLY REVIEW telegram: wry, warm, honest. ' +
  'Markdown, under 250 words. Cover: what got done (tasks completed, hours studied per course), ' +
  'what slipped (starving tasks, behind-pace courses), habit adherence, anything finished from ' +
  'the backlog, and what next week holds (due tasks, events). Close with one specific, ' +
  'actionable suggestion for the coming week. Sign off "— ✦ Lodestar".';

export async function generateWeeklyReview(user: UserRow, weekMonday: string): Promise<AssistantDoc> {
  const local = nowInTz(user.tz);
  const weekStart = DateTime.fromISO(weekMonday, { zone: user.tz });
  const weekEnd = weekStart.plus({ days: 7 });

  const completed = await query<{ title: string }>(
    `SELECT title FROM tasks WHERE user_id = $1 AND is_completed
       AND completed_at >= $2 AND completed_at < $3
     ORDER BY completed_at DESC LIMIT 15`,
    [user.id, weekStart.toUTC().toISO(), weekEnd.toUTC().toISO()],
  );
  const starving = await query<{ title: string }>(
    `SELECT title FROM tasks WHERE user_id = $1 AND NOT is_completed
       AND created_at < now() - interval '7 days'
     ORDER BY created_at ASC LIMIT 8`,
    [user.id],
  );
  const hours = await query<{ name: string; minutes: string }>(
    `SELECT c.name, sum(s.minutes)::text AS minutes
     FROM study_sessions s JOIN courses c ON c.id = s.course_id
     WHERE s.user_id = $1 AND s.date >= $2::date AND s.date < $3::date
     GROUP BY c.name ORDER BY sum(s.minutes) DESC`,
    [user.id, weekStart.toISODate(), weekEnd.toISODate()],
  );
  const finishedMedia = await query<{ title: string; domain: string }>(
    `SELECT title, domain FROM media_items
     WHERE user_id = $1 AND status = 'COMPLETED'
       AND finished_at >= $2::date AND finished_at < $3::date`,
    [user.id, weekStart.toISODate(), weekEnd.toISODate()],
  );
  const dueNext = await query<{ title: string; due_at: Date }>(
    `SELECT title, due_at FROM tasks
     WHERE user_id = $1 AND NOT is_completed AND due_at IS NOT NULL
       AND due_at < $2 ORDER BY due_at ASC LIMIT 8`,
    [user.id, weekEnd.plus({ days: 7 }).toUTC().toISO()],
  );
  const habits = await habitsWithToday(user.id, user.tz);
  const warnings = await paceWarnings(user.id);

  const facts = {
    name: user.display_name,
    week_of: weekMonday,
    completed_tasks: completed.map((c) => c.title),
    starving_tasks: starving.map((s) => s.title),
    study_hours: hours.map((h) => ({ course: h.name, hours: Number((Number(h.minutes) / 60).toFixed(1)) })),
    behind_pace: warnings,
    habit_streaks: habits.map((h) => ({ name: h.name, streak: h.streak })),
    finished_from_backlog: finishedMedia,
    due_soon: dueNext.map((d) => ({ title: d.title, due: new Date(d.due_at).toISOString().slice(0, 10) })),
  };

  let content: string;
  if (isGeminiConfigured()) {
    try {
      content = await generateText({
        system: REVIEW_VOICE,
        user: JSON.stringify(facts),
        temperature: 0.8,
        maxOutputTokens: 1200,
      });
    } catch (err) {
      console.warn('[assistant] review via Gemini failed:', (err as Error).message);
      content = renderFallbackReview(facts);
    }
  } else {
    content = renderFallbackReview(facts);
  }

  const row = await queryOne<AssistantDoc>(
    `INSERT INTO assistant_docs (user_id, kind, for_date, content, meta)
     VALUES ($1, 'review', $2, $3, $4)
     ON CONFLICT (user_id, kind, for_date)
     DO UPDATE SET content = EXCLUDED.content, meta = EXCLUDED.meta, created_at = now()
     RETURNING id, kind, for_date, content, meta, created_at`,
    [
      user.id,
      weekMonday,
      content,
      JSON.stringify({ generator: isGeminiConfigured() ? 'gemini' : 'fallback', generated_at_local: local.toISO() }),
    ],
  );
  return row!;
}

function renderFallbackReview(f: {
  name: string;
  week_of: string;
  completed_tasks: string[];
  starving_tasks: string[];
  study_hours: Array<{ course: string; hours: number }>;
  behind_pace: PaceWarning[];
  habit_streaks: Array<{ name: string; streak: number }>;
  finished_from_backlog: Array<{ title: string; domain: string }>;
  due_soon: Array<{ title: string; due: string }>;
}): string {
  const lines = [`**Weekly review** — week of ${f.week_of}, for ${f.name}.`, ''];
  lines.push(`**Done**: ${f.completed_tasks.length} tasks.`);
  if (f.study_hours.length) {
    lines.push(
      `**Studied**: ${f.study_hours.map((h) => `${h.course} ${h.hours}h`).join(' · ')}.`,
    );
  }
  if (f.behind_pace.length) {
    lines.push(
      `**Behind**: ${f.behind_pace.map((w) => `${w.course_name} (${w.deficit_hours}h)`).join(' · ')}.`,
    );
  }
  if (f.starving_tasks.length) {
    lines.push(`**Starving tasks**: ${f.starving_tasks.slice(0, 5).join(' · ')}.`);
  }
  if (f.finished_from_backlog.length) {
    lines.push(`**Off the backlog**: ${f.finished_from_backlog.map((m) => m.title).join(' · ')}.`);
  }
  if (f.due_soon.length) {
    lines.push(`**Coming up**: ${f.due_soon.map((d) => `${d.title} (${d.due})`).join(' · ')}.`);
  }
  lines.push('', '— ✦ Lodestar');
  return lines.join('\n');
}

// ── settings helper for jobs ────────────────────────────────────────────────

export function briefingHour(user: UserRow): number {
  return userSettings(user).briefing_hour;
}

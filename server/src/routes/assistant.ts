// Assistant routes (integration #6): briefing, weekly review, and natural-
// language capture — the Whenabouts aiParse pattern: the model proposes,
// zod validates, the human confirms; nothing is ever auto-applied.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { isValidDateStr, type CaptureSuggestion } from '@lodestar/shared';
import { query, queryOne } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { badRequest } from '../lib/errors.js';
import { generateJson, isGeminiConfigured } from '../lib/gemini.js';
import { enrichTitles } from '../lib/enrich.js';
import { generateBriefing, generateWeeklyReview } from '../lib/assistant.js';
import { nowInTz, todayInTz } from '../lib/schedule.js';
import { rowToTask, type TaskRow } from './tasks.js';

const zDate = z.string().refine(isValidDateStr, 'expected YYYY-MM-DD');
const zInstant = z.string().datetime({ offset: true });

// ── capture validation (model output is never trusted) ─────────────────────

const taskAction = z.object({
  kind: z.literal('task'),
  title: z.string().trim().min(1).max(300),
  due_at: zInstant.nullish(),
  notes: z.string().trim().max(500).nullish(),
});

const eventAction = z
  .object({
    kind: z.literal('event'),
    title: z.string().trim().min(1).max(200),
    all_day: z.boolean(),
    start_date: zDate.nullish(),
    end_date: zDate.nullish(),
    start_utc: zInstant.nullish(),
    end_utc: zInstant.nullish(),
    icon: z.string().trim().max(8).nullish(),
  })
  .refine(
    (v) =>
      v.all_day
        ? Boolean(v.start_date && v.end_date && v.start_date <= v.end_date)
        : Boolean(v.start_utc && v.end_utc && v.start_utc <= v.end_utc),
    'incomplete event dates',
  );

const availabilityAction = z
  .object({
    kind: z.literal('availability'),
    status: z.enum(['free', 'busy', 'maybe']),
    start_date: zDate,
    end_date: zDate,
    note: z.string().trim().max(500).nullish(),
  })
  .refine((v) => v.start_date <= v.end_date, 'start after end');

const CAPTURE_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    actions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          kind: { type: 'STRING' },
          title: { type: 'STRING' },
          due_at: { type: 'STRING' },
          notes: { type: 'STRING' },
          all_day: { type: 'BOOLEAN' },
          start_date: { type: 'STRING' },
          end_date: { type: 'STRING' },
          start_utc: { type: 'STRING' },
          end_utc: { type: 'STRING' },
          icon: { type: 'STRING' },
          status: { type: 'STRING' },
          note: { type: 'STRING' },
        },
        required: ['kind'],
      },
    },
  },
  required: ['actions'],
};

function captureSystemPrompt(tz: string, today: string): string {
  return [
    `You convert a student's casual note into structured actions. Today is ${today}. Their timezone is ${tz}.`,
    `Return ONLY JSON of the form {"actions":[ ... ]}. Each action has a "kind":`,
    `- "task": {kind, title, due_at?(UTC ISO instant, only when a deadline is stated or clearly implied), notes?}`,
    `- "event": {kind, title, all_day:boolean, start_date?('YYYY-MM-DD'), end_date?, start_utc?(UTC ISO), end_utc?(UTC ISO), icon?(one emoji)}`,
    `- "availability": {kind, status:'free'|'busy'|'maybe', start_date, end_date, note?}`,
    `Resolve relative dates ("friday", "next week") against today and the timezone. For timed events convert local times to UTC instants; default a timed event's length to 1 hour when unstated.`,
    `Things to do become tasks; appointments/plans become events; "I'm away / around" becomes availability.`,
    `If nothing is actionable, return {"actions":[]}.`,
  ].join('\n');
}

function fmtRange(s: string, e: string): string {
  const a = DateTime.fromISO(s);
  const b = DateTime.fromISO(e);
  return a.hasSame(b, 'day') ? a.toFormat('d LLL') : `${a.toFormat('d LLL')}–${b.toFormat('d LLL')}`;
}

/** Pure transformation of extracted actions → validated suggestions. */
export function actionsToSuggestions(raw: unknown, tz: string): CaptureSuggestion[] {
  const actions =
    raw && typeof raw === 'object' && Array.isArray((raw as { actions?: unknown }).actions)
      ? ((raw as { actions: unknown[] }).actions)
      : Array.isArray(raw)
        ? raw
        : [];
  const out: CaptureSuggestion[] = [];
  for (const a of actions) {
    if (!a || typeof a !== 'object') continue;
    const kind = (a as { kind?: unknown }).kind;
    try {
      if (kind === 'task') {
        const v = taskAction.parse(a);
        out.push({
          kind: 'task',
          label: `Task · ${v.title}${v.due_at ? ` · due ${DateTime.fromISO(v.due_at).setZone(tz).toFormat('d LLL HH:mm')}` : ''}`,
          payload: { title: v.title, due_at: v.due_at ?? null, notes: v.notes ?? null },
        });
      } else if (kind === 'event') {
        const v = eventAction.parse(a);
        const when = v.all_day
          ? fmtRange(v.start_date!, v.end_date!)
          : DateTime.fromISO(v.start_utc!).setZone(tz).toFormat('d LLL HH:mm');
        out.push({
          kind: 'event',
          label: `Event · ${v.icon ? v.icon + ' ' : ''}${v.title} · ${when}`,
          payload: {
            title: v.title,
            all_day: v.all_day,
            start_date: v.all_day ? v.start_date! : null,
            end_date: v.all_day ? v.end_date! : null,
            start_utc: v.all_day ? null : v.start_utc!,
            end_utc: v.all_day ? null : v.end_utc!,
            icon: v.icon ?? null,
          },
        });
      } else if (kind === 'availability') {
        const v = availabilityAction.parse(a);
        const label = { free: 'Free', busy: 'Away', maybe: 'Maybe' }[v.status];
        out.push({
          kind: 'availability',
          label: `${label} · ${fmtRange(v.start_date, v.end_date)}${v.note ? ` · ${v.note}` : ''}`,
          payload: { status: v.status, start_date: v.start_date, end_date: v.end_date, note: v.note ?? null },
        });
      }
    } catch {
      // drop invalid action — the model is never trusted
    }
  }
  return out.slice(0, 10);
}

// ── routes ──────────────────────────────────────────────────────────────────

export async function assistantRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/api/assistant/briefing', async (request) => {
    const q = z.object({ date: zDate.optional() }).parse(request.query);
    const date = q.date ?? todayInTz(request.user.tz).date;
    const existing = await queryOne(
      `SELECT id, kind, for_date, content, meta, created_at FROM assistant_docs
       WHERE user_id = $1 AND kind = 'briefing' AND for_date = $2`,
      [request.user.id, date],
    );
    if (existing) return { briefing: existing };
    return { briefing: await generateBriefing(request.user, date) };
  });

  app.post('/api/assistant/briefing/regenerate', async (request) => {
    const date = todayInTz(request.user.tz).date;
    return { briefing: await generateBriefing(request.user, date) };
  });

  app.get('/api/assistant/review', async (request) => {
    const local = nowInTz(request.user.tz);
    const monday = local.startOf('week').toISODate()!; // luxon weeks start Monday
    const existing = await queryOne(
      `SELECT id, kind, for_date, content, meta, created_at FROM assistant_docs
       WHERE user_id = $1 AND kind = 'review' AND for_date = $2`,
      [request.user.id, monday],
    );
    if (existing) return { review: existing };
    return { review: await generateWeeklyReview(request.user, monday) };
  });

  app.post('/api/assistant/capture', async (request) => {
    const body = z.object({ text: z.string().trim().min(1).max(1000) }).parse(request.body);
    const { date } = todayInTz(request.user.tz);

    if (!isGeminiConfigured()) {
      // keyless fallback: everything becomes one task, enriched heuristically at confirm
      const suggestions: CaptureSuggestion[] = [
        {
          kind: 'task',
          label: `Task · ${body.text.slice(0, 120)}`,
          payload: { title: body.text.slice(0, 300), due_at: null, notes: null },
        },
      ];
      return { suggestions, generator: 'fallback' };
    }

    try {
      const raw = await generateJson({
        system: captureSystemPrompt(request.user.tz, date),
        user: body.text,
        responseSchema: CAPTURE_RESPONSE_SCHEMA,
        temperature: 0.2,
      });
      return { suggestions: actionsToSuggestions(raw, request.user.tz), generator: 'gemini' };
    } catch (err) {
      throw badRequest(`Capture failed: ${(err as Error).message}`);
    }
  });

  app.post('/api/assistant/capture/confirm', async (request, reply) => {
    const body = z
      .object({
        suggestions: z
          .array(
            z.discriminatedUnion('kind', [
              z.object({ kind: z.literal('task'), payload: taskAction.omit({ kind: true }) }),
              z.object({ kind: z.literal('event'), payload: eventAction.innerType().omit({ kind: true }) }),
              z.object({
                kind: z.literal('availability'),
                payload: availabilityAction.innerType().omit({ kind: true }),
              }),
            ]),
          )
          .min(1)
          .max(10),
      })
      .parse(request.body);

    const created: Array<{ kind: string; id: string; title: string }> = [];
    for (const s of body.suggestions) {
      if (s.kind === 'task') {
        const e = (await enrichTitles([s.payload.title]))[0]!;
        const row = await queryOne<TaskRow>(
          `INSERT INTO tasks (user_id, title, notes, importance, cognitive_load, duration_min,
                              reasoning, enrichment_source, due_at, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'capture')
           RETURNING *`,
          [
            request.user.id,
            s.payload.title,
            s.payload.notes ?? null,
            e.importance,
            e.cognitive_load,
            e.duration_min,
            e.reasoning,
            e.source,
            s.payload.due_at ?? null,
          ],
        );
        created.push({ kind: 'task', id: row!.id, title: rowToTask(row!).title });
      } else if (s.kind === 'event') {
        const p = eventAction.parse({ ...s.payload, kind: 'event' });
        const row = await queryOne<{ id: string; title: string }>(
          `INSERT INTO events (owner_id, title, all_day, start_date, end_date, start_utc, end_utc, tz, icon)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, title`,
          [
            request.user.id,
            p.title,
            p.all_day,
            p.all_day ? p.start_date : null,
            p.all_day ? p.end_date : null,
            p.all_day ? null : p.start_utc,
            p.all_day ? null : p.end_utc,
            request.user.tz,
            p.icon ?? null,
          ],
        );
        created.push({ kind: 'event', id: row!.id, title: row!.title });
      } else {
        const p = availabilityAction.parse({ ...s.payload, kind: 'availability' });
        const row = await queryOne<{ id: string }>(
          `INSERT INTO availability (user_id, status, start_date, end_date, note)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [request.user.id, p.status, p.start_date, p.end_date, p.note ?? null],
        );
        created.push({ kind: 'availability', id: row!.id, title: `${p.status} ${p.start_date}` });
      }
    }
    return reply.code(201).send({ created });
  });
}

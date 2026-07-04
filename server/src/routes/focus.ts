// Focus sessions (CONTRACT §3, §4.9, §5, integration #8): goal-driven timed
// work blocks. The AI/heuristic planner proposes a week of sessions (user
// confirms — never auto-created); a check-in with a course logs straight into
// study_sessions so focus work moves pace and the grade projection.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DateTime } from 'luxon';
import {
  getAcademicMultiplier,
  mondayOf,
  type FocusPlanSuggestion,
  type FocusSession,
} from '@lodestar/shared';
import { query, queryOne } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { generateJson, isGeminiConfigured } from '../lib/gemini.js';
import { computeGaps, getLectureBlocks, todayInTz } from '../lib/schedule.js';
import {
  eveningSlots,
  planFocusHeuristic,
  type PlannerCourse,
  type PlannerSlot,
  type PlannerTask,
} from '../lib/focus.js';
import { activeSemester, courseOverviews } from './study.js';

const idParams = z.object({ id: z.string().uuid() });
const zInstant = z.string().datetime({ offset: true });

interface FocusRow {
  id: string;
  user_id: string;
  task_id: string | null;
  course_id: string | null;
  goal: string;
  planned_minutes: number;
  scheduled_for: Date | null;
  status: FocusSession['status'];
  planned_by: 'ai' | 'manual';
  started_at: Date | null;
  ended_at: Date | null;
  actual_minutes: number | null;
  completion_pct: number | null;
  checkin_note: string | null;
  created_at: Date;
  task_title?: string | null;
  course_name?: string | null;
  course_color?: string | null;
}

export function rowToFocus(r: FocusRow): FocusSession {
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  return {
    ...r,
    scheduled_for: iso(r.scheduled_for),
    started_at: iso(r.started_at),
    ended_at: iso(r.ended_at),
    created_at: new Date(r.created_at).toISOString(),
  };
}

const FOCUS_SQL = `
  SELECT f.*, t.title AS task_title, c.name AS course_name, c.color AS course_color
  FROM focus_sessions f
  LEFT JOIN tasks t ON t.id = f.task_id
  LEFT JOIN courses c ON c.id = f.course_id`;

export async function getFocusRow(id: string, userId: string): Promise<FocusRow | null> {
  return queryOne<FocusRow>(`${FOCUS_SQL} WHERE f.id = $1 AND f.user_id = $2`, [id, userId]);
}

async function assertOwnedIds(
  userId: string,
  taskIds: string[],
  courseIds: string[],
): Promise<void> {
  if (taskIds.length) {
    const rows = await query('SELECT id FROM tasks WHERE user_id = $1 AND id = ANY($2)', [
      userId,
      taskIds,
    ]);
    if (rows.length !== new Set(taskIds).size) throw badRequest('Unknown task in suggestions.');
  }
  if (courseIds.length) {
    const rows = await query('SELECT id FROM courses WHERE user_id = $1 AND id = ANY($2)', [
      userId,
      courseIds,
    ]);
    if (rows.length !== new Set(courseIds).size) throw badRequest('Unknown course in suggestions.');
  }
}

// ── planner input gathering (§4.9) ──────────────────────────────────────────

async function gatherPlannerInputs(userId: string, tz: string, weekStart: string) {
  const { date: today } = todayInTz(tz);
  const horizon = DateTime.fromISO(weekStart, { zone: tz }).plus({ days: 14 }).toUTC().toISO()!;

  const tasks = await query<PlannerTask & { importance: number }>(
    `SELECT id, title, course_id, due_at, duration_min, cognitive_load, importance
     FROM tasks
     WHERE user_id = $1 AND NOT is_completed AND due_at IS NOT NULL AND due_at <= $2
     ORDER BY due_at ASC LIMIT 30`,
    [userId, horizon],
  );

  const examEvents = await query<{ title: string; start_date: string | null; start_utc: Date | null }>(
    `SELECT title, start_date, start_utc FROM events
     WHERE owner_id = $1
       AND COALESCE(start_utc, start_date::timestamptz) BETWEEN $2::date AND $3
     ORDER BY 3 LIMIT 20`,
    [userId, weekStart, horizon],
  );
  const exams = examEvents.filter((e) => getAcademicMultiplier(e.title) > 1);

  const semester = await activeSemester(userId);
  const courses: PlannerCourse[] = semester
    ? (await courseOverviews(userId, semester)).map((c) => ({
        id: c.id,
        name: c.name,
        deficit_hours: c.pace.deficit_hours,
        required_velocity: c.pace.required_velocity,
        status: c.pace.status,
      }))
    : [];

  const slots: PlannerSlot[] = [];
  for (let d = 0; d < 7; d++) {
    const day = DateTime.fromISO(weekStart, { zone: tz }).plus({ days: d });
    const date = day.toISODate()!;
    if (date < today) continue;
    const blocks = await getLectureBlocks(userId, date, day.weekday % 7);
    for (const gap of computeGaps(blocks)) {
      slots.push({ date, start: gap.start, minutes: gap.minutes });
    }
  }
  const effectiveSlots = slots.length ? slots : eveningSlots(weekStart, today);

  return { today, tasks, exams, courses, slots: effectiveSlots };
}

// ── Gemini planner (validated per §4.9 — the model is never trusted) ────────

const PLAN_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    suggestions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          course_id: { type: 'STRING' },
          task_id: { type: 'STRING' },
          goal: { type: 'STRING' },
          planned_minutes: { type: 'INTEGER' },
          scheduled_for: { type: 'STRING' },
          reason: { type: 'STRING' },
        },
        required: ['goal', 'planned_minutes'],
      },
    },
  },
  required: ['suggestions'],
};

const planEntrySchema = z.object({
  course_id: z.string().nullish(),
  task_id: z.string().nullish(),
  goal: z.string().trim().min(1).max(200),
  planned_minutes: z.number(),
  scheduled_for: z.string().nullish(),
  reason: z.string().trim().max(200).nullish(),
});

function validateGeminiPlan(
  raw: unknown,
  taskIds: Set<string>,
  courseIds: Set<string>,
): FocusPlanSuggestion[] {
  const arr =
    raw && typeof raw === 'object' && Array.isArray((raw as { suggestions?: unknown }).suggestions)
      ? ((raw as { suggestions: unknown[] }).suggestions)
      : [];
  const out: FocusPlanSuggestion[] = [];
  for (const entry of arr) {
    const parsed = planEntrySchema.safeParse(entry);
    if (!parsed.success) continue;
    const v = parsed.data;
    const task_id = v.task_id && taskIds.has(v.task_id) ? v.task_id : null;
    const course_id = v.course_id && courseIds.has(v.course_id) ? v.course_id : null;
    if (!task_id && !course_id) continue; // targetless or invented ids — drop
    let scheduled_for: string | null = null;
    if (v.scheduled_for) {
      const dt = DateTime.fromISO(v.scheduled_for);
      if (!dt.isValid) continue; // unparseable schedule — drop (§4.9)
      scheduled_for = dt.toUTC().toISO();
    }
    out.push({
      task_id,
      course_id,
      goal: v.goal,
      planned_minutes: Math.min(180, Math.max(15, Math.round(v.planned_minutes))),
      scheduled_for,
      reason: v.reason ?? undefined,
    });
    if (out.length >= 10) break;
  }
  return out;
}

const PLANNER_VOICE = [
  'You are the weekly study planner inside a student\'s self-hosted dashboard.',
  'Given their timezone, week window, open assignments (ids, due dates, estimated minutes,',
  'cognitive load), exam-flavoured events, course pacing (deficit hours, behind/on-track), and',
  'this week\'s free lecture gaps (local times), propose focus sessions.',
  'Rules: 3-8 suggestions; ONLY reference the provided task_id / course_id values — never invent',
  'ids; planned_minutes 25-90; prefer scheduling inside the provided gaps, converting the local',
  'gap times to UTC ISO instants in scheduled_for; imminent deadlines first, then the biggest',
  'pace deficits; at most 2 sessions per course; goals must be concrete and small',
  '(e.g. "Questions 1-3", "Redo lecture 4 examples", "Draft intro section").',
  'Return ONLY JSON of the form {"suggestions":[...]}.',
].join(' ');

// ── routes ──────────────────────────────────────────────────────────────────

export async function focusRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/api/focus', async (request) => {
    const q = z
      .object({ status: z.enum(['planned', 'active', 'done', 'abandoned']).optional() })
      .parse(request.query);
    const params: unknown[] = [request.user.id];
    let where = 'f.user_id = $1';
    if (q.status) {
      params.push(q.status);
      where += ` AND f.status = $${params.length}`;
    }
    const rows = await query<FocusRow>(
      `${FOCUS_SQL} WHERE ${where}
       ORDER BY CASE f.status WHEN 'active' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END,
                f.scheduled_for ASC NULLS LAST, f.ended_at DESC NULLS LAST, f.created_at DESC
       LIMIT 100`,
      params,
    );
    return { sessions: rows.map(rowToFocus) };
  });

  app.post('/api/focus', async (request, reply) => {
    const body = z
      .object({
        task_id: z.string().uuid().nullish(),
        course_id: z.string().uuid().nullish(),
        goal: z.string().trim().min(1).max(200),
        planned_minutes: z.number().int().min(1).max(600),
        scheduled_for: zInstant.nullish(),
      })
      .parse(request.body);
    await assertOwnedIds(
      request.user.id,
      body.task_id ? [body.task_id] : [],
      body.course_id ? [body.course_id] : [],
    );
    const row = await queryOne<{ id: string }>(
      `INSERT INTO focus_sessions (user_id, task_id, course_id, goal, planned_minutes, scheduled_for)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        request.user.id,
        body.task_id ?? null,
        body.course_id ?? null,
        body.goal,
        body.planned_minutes,
        body.scheduled_for ?? null,
      ],
    );
    return reply.code(201).send({ session: rowToFocus((await getFocusRow(row!.id, request.user.id))!) });
  });

  // §4.9 — AI/heuristic weekly plan; suggestions only, never auto-created.
  app.post('/api/focus/plan', async (request) => {
    const body = z
      .object({ week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
      .parse(request.body ?? {});
    const { date: today } = todayInTz(request.user.tz);
    const weekStart = body.week_start ?? mondayOf(today);

    const inputs = await gatherPlannerInputs(request.user.id, request.user.tz, weekStart);
    const taskNames = new Map(inputs.tasks.map((t) => [t.id, t.title]));
    const courseNames = new Map(inputs.courses.map((c) => [c.id, c.name]));

    const heuristic = () =>
      planFocusHeuristic({
        tasks: inputs.tasks,
        courses: inputs.courses,
        slots: inputs.slots,
        tz: request.user.tz,
      });

    let suggestions: FocusPlanSuggestion[];
    let generator: 'gemini' | 'heuristic' = 'heuristic';
    if (isGeminiConfigured()) {
      try {
        const raw = await generateJson({
          system: PLANNER_VOICE,
          user: JSON.stringify({
            timezone: request.user.tz,
            week_start: weekStart,
            today: inputs.today,
            assignments: inputs.tasks,
            exam_events: inputs.exams,
            course_pace: inputs.courses,
            free_gaps_local: inputs.slots,
          }),
          responseSchema: PLAN_RESPONSE_SCHEMA,
          temperature: 0.4,
        });
        suggestions = validateGeminiPlan(
          raw,
          new Set(taskNames.keys()),
          new Set(courseNames.keys()),
        );
        generator = 'gemini';
        if (!suggestions.length) {
          suggestions = heuristic();
          generator = 'heuristic';
        }
      } catch (err) {
        console.warn('[focus] Gemini plan failed, using heuristic:', (err as Error).message);
        suggestions = heuristic();
      }
    } else {
      suggestions = heuristic();
    }

    return {
      week_start: weekStart,
      generator,
      suggestions: suggestions.map((s) => ({
        ...s,
        task_title: s.task_id ? (taskNames.get(s.task_id) ?? null) : null,
        course_name: s.course_id ? (courseNames.get(s.course_id) ?? null) : null,
      })),
    };
  });

  app.post('/api/focus/plan/confirm', async (request, reply) => {
    const body = z
      .object({
        suggestions: z
          .array(
            z.object({
              task_id: z.string().uuid().nullish(),
              course_id: z.string().uuid().nullish(),
              goal: z.string().trim().min(1).max(200),
              planned_minutes: z.number().int().min(15).max(240),
              scheduled_for: zInstant.nullish(),
            }),
          )
          .min(1)
          .max(10),
      })
      .parse(request.body);

    await assertOwnedIds(
      request.user.id,
      body.suggestions.flatMap((s) => (s.task_id ? [s.task_id] : [])),
      body.suggestions.flatMap((s) => (s.course_id ? [s.course_id] : [])),
    );

    const created: FocusSession[] = [];
    for (const s of body.suggestions) {
      const row = await queryOne<{ id: string }>(
        `INSERT INTO focus_sessions (user_id, task_id, course_id, goal, planned_minutes,
                                     scheduled_for, planned_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'ai') RETURNING id`,
        [
          request.user.id,
          s.task_id ?? null,
          s.course_id ?? null,
          s.goal,
          s.planned_minutes,
          s.scheduled_for ?? null,
        ],
      );
      created.push(rowToFocus((await getFocusRow(row!.id, request.user.id))!));
    }
    return reply.code(201).send({ created });
  });

  app.post('/api/focus/:id/start', async (request) => {
    const { id } = idParams.parse(request.params);
    const active = await queryOne(
      `SELECT 1 FROM focus_sessions WHERE user_id = $1 AND status = 'active' AND id <> $2`,
      [request.user.id, id],
    );
    if (active) throw conflict('Another focus session is already running — check it in first.');
    const row = await queryOne<{ id: string }>(
      `UPDATE focus_sessions SET status = 'active', started_at = now()
       WHERE id = $1 AND user_id = $2 AND status = 'planned' RETURNING id`,
      [id, request.user.id],
    );
    if (!row) throw notFound('Focus session not found (or not in planned state).');
    return { session: rowToFocus((await getFocusRow(id, request.user.id))!) };
  });

  // Integration #8 — the keystone: check-in flows into study_sessions.
  app.post('/api/focus/:id/checkin', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = z
      .object({
        actual_minutes: z.number().int().min(1).max(24 * 60),
        completion_pct: z.number().int().min(0).max(100),
        note: z.string().trim().max(500).nullish(),
      })
      .parse(request.body);

    const focus = await getFocusRow(id, request.user.id);
    if (!focus) throw notFound('Focus session not found.');
    if (focus.status !== 'active' && focus.status !== 'planned') {
      throw badRequest('Only planned or active sessions can be checked in.');
    }

    await query(
      `UPDATE focus_sessions
       SET status = 'done', ended_at = now(),
           started_at = COALESCE(started_at, now() - ($3 || ' minutes')::interval),
           actual_minutes = $4, completion_pct = $5, checkin_note = $6
       WHERE id = $1 AND user_id = $2`,
      [id, request.user.id, String(body.actual_minutes), body.actual_minutes, body.completion_pct, body.note ?? null],
    );

    let studySession: unknown = null;
    if (focus.course_id) {
      // effort = clamp(linked task.cognitive_load, 1, 5), default 3 (CONTRACT #8)
      let effort = 3;
      if (focus.task_id) {
        const task = await queryOne<{ cognitive_load: number }>(
          'SELECT cognitive_load FROM tasks WHERE id = $1',
          [focus.task_id],
        );
        if (task) effort = Math.min(5, Math.max(1, task.cognitive_load));
      }
      studySession = await queryOne(
        `INSERT INTO study_sessions (user_id, course_id, date, minutes, is_self_study, effort, note)
         VALUES ($1, $2, $3, $4, true, $5, $6) RETURNING *`,
        [
          request.user.id,
          focus.course_id,
          todayInTz(request.user.tz).date,
          body.actual_minutes,
          effort,
          focus.goal,
        ],
      );
    }

    return {
      session: rowToFocus((await getFocusRow(id, request.user.id))!),
      study_session: studySession,
    };
  });

  app.patch('/api/focus/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = z
      .object({
        goal: z.string().trim().min(1).max(200).optional(),
        planned_minutes: z.number().int().min(1).max(600).optional(),
        scheduled_for: zInstant.nullable().optional(),
        course_id: z.string().uuid().nullable().optional(),
        task_id: z.string().uuid().nullable().optional(),
        status: z.literal('abandoned').optional(),
      })
      .parse(request.body);

    const current = await getFocusRow(id, request.user.id);
    if (!current) throw notFound('Focus session not found.');

    if (body.status === 'abandoned') {
      if (current.status !== 'planned' && current.status !== 'active') {
        throw badRequest('Only planned or active sessions can be abandoned.');
      }
      await query(
        `UPDATE focus_sessions
         SET status = 'abandoned', ended_at = CASE WHEN status = 'active' THEN now() ELSE ended_at END
         WHERE id = $1 AND user_id = $2`,
        [id, request.user.id],
      );
      return { session: rowToFocus((await getFocusRow(id, request.user.id))!) };
    }

    if (current.status !== 'planned') {
      throw badRequest('Only planned sessions can be edited.');
    }
    await assertOwnedIds(
      request.user.id,
      body.task_id ? [body.task_id] : [],
      body.course_id ? [body.course_id] : [],
    );
    await query(
      `UPDATE focus_sessions
       SET goal = $3, planned_minutes = $4, scheduled_for = $5, course_id = $6, task_id = $7
       WHERE id = $1 AND user_id = $2`,
      [
        id,
        request.user.id,
        body.goal ?? current.goal,
        body.planned_minutes ?? current.planned_minutes,
        body.scheduled_for !== undefined ? body.scheduled_for : current.scheduled_for,
        body.course_id !== undefined ? body.course_id : current.course_id,
        body.task_id !== undefined ? body.task_id : current.task_id,
      ],
    );
    return { session: rowToFocus((await getFocusRow(id, request.user.id))!) };
  });

  app.delete('/api/focus/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const rows = await query(
      'DELETE FROM focus_sessions WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, request.user.id],
    );
    if (!rows.length) throw notFound('Focus session not found.');
    return { ok: true };
  });
}

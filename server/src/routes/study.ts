// Study module — the studyHourCounter port (CONTRACT §4.3) plus the
// pace → time-blocking bridge (§4.7, integration #2).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DateTime } from 'luxon';
import {
  computeCoursePaceV2,
  isValidDateStr,
  paceAdvice,
  type Course,
  type CourseOverview,
  type LectureSlot,
  type Semester,
  type SessionLite,
  type StudyBlockProposal,
} from '@lodestar/shared';
import { query, queryOne } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { generateText, isGeminiConfigured } from '../lib/gemini.js';
import { computeGaps, getLectureBlocks, minutesOf, nowInTz } from '../lib/schedule.js';

const zDate = z.string().refine(isValidDateStr, 'expected YYYY-MM-DD');
const zTime = z.string().regex(/^\d{2}:\d{2}$/, 'expected HH:MM');
const idParams = z.object({ id: z.string().uuid() });

const semesterSchema = z.object({
  name: z.string().trim().min(1).max(80),
  start_date: zDate,
  end_date: zDate,
  is_active: z.boolean().optional(),
});

const courseSchema = z.object({
  semester_id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  ects: z.number().int().min(0).max(60),
  target_hours: z.number().min(0).max(2000).optional(),
  target_grade: z.number().min(1).max(5).nullish(), // German scale (§4.3)
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
});

const slotsSchema = z.object({
  slots: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        start_time: zTime,
        end_time: zTime,
        location: z.string().trim().max(120).nullish(),
      }),
    )
    .max(20),
});

const sessionSchema = z.object({
  course_id: z.string().uuid(),
  date: zDate,
  minutes: z.number().int().min(1).max(24 * 60),
  is_self_study: z.boolean().default(true),
  effort: z.number().int().min(1).max(5).nullish(), // §4.3 v2 — null ⇒ 3
  note: z.string().trim().max(500).nullish(),
});

export async function activeSemester(userId: string): Promise<Semester | null> {
  return queryOne<Semester>(
    `SELECT * FROM semesters WHERE user_id = $1
     ORDER BY is_active DESC, end_date DESC LIMIT 1`,
    [userId],
  );
}

/** Per-course pacing for a semester — the shared §4.3 v2 math over raw sessions. */
export async function courseOverviews(
  userId: string,
  semester: Semester,
  now = new Date(),
): Promise<CourseOverview[]> {
  const courses = await query<Course>(
    'SELECT * FROM courses WHERE user_id = $1 AND semester_id = $2 ORDER BY name',
    [userId, semester.id],
  );
  if (!courses.length) return [];

  const sessions = await query<SessionLite & { course_id: string }>(
    `SELECT course_id, date, minutes, is_self_study, effort
     FROM study_sessions
     WHERE user_id = $1 AND course_id = ANY($2)`,
    [userId, courses.map((c) => c.id)],
  );
  const slots = await query<LectureSlot & { start_time: string; end_time: string }>(
    `SELECT id, course_id, weekday, start_time::text AS start_time, end_time::text AS end_time, location
     FROM lecture_slots WHERE course_id = ANY($1) ORDER BY weekday, start_time`,
    [courses.map((c) => c.id)],
  );

  return courses.map((c) => ({
    ...c,
    target_hours: Number(c.target_hours),
    target_grade: c.target_grade === null ? null : Number(c.target_grade),
    pace: computeCoursePaceV2({
      targetHours: Number(c.target_hours),
      sessions: sessions.filter((s) => s.course_id === c.id),
      semesterStartDate: semester.start_date,
      semesterEndDate: semester.end_date,
      now,
    }),
    slots: slots
      .filter((s) => s.course_id === c.id)
      .map((s) => ({ ...s, start_time: s.start_time.slice(0, 5), end_time: s.end_time.slice(0, 5) })),
  }));
}

/**
 * Propose bookable study blocks over the next 7 days for behind-pace courses
 * (integration #2): lecture gaps ≥ 45 min, an 18:30 evening block on lecture
 * days, one 14:00 block on free days. Round-robin, ≤2 per course, ≤8 total.
 */
export async function proposeStudyBlocks(
  userId: string,
  tz: string,
): Promise<StudyBlockProposal[]> {
  const semester = await activeSemester(userId);
  if (!semester) return [];
  const overviews = await courseOverviews(userId, semester);
  const behind = overviews
    .filter((c) => c.pace.status === 'behind')
    .sort((a, b) => b.pace.deficit_hours - a.pace.deficit_hours);
  if (!behind.length) return [];

  const now = nowInTz(tz);
  const slots: Array<{ date: string; start: string; minutes: number }> = [];

  for (let d = 0; d < 7 && slots.length < 12; d++) {
    const day = now.plus({ days: d });
    const date = day.toISODate()!;
    if (date > semester.end_date) break;
    const weekday = day.weekday % 7;
    const blocks = await getLectureBlocks(userId, date, weekday);

    const pushIfFuture = (start: string, minutes: number) => {
      if (d === 0 && minutesOf(start) <= now.hour * 60 + now.minute + 15) return;
      slots.push({ date, start, minutes });
    };

    if (blocks.length) {
      for (const gap of computeGaps(blocks)) {
        if (gap.minutes >= 45) pushIfFuture(gap.start, Math.min(90, gap.minutes - 15));
      }
      pushIfFuture('18:30', 90);
    } else {
      pushIfFuture('14:00', 120);
    }
  }

  const proposals: StudyBlockProposal[] = [];
  const perCourse = new Map<string, number>();
  let i = 0;
  for (const slot of slots) {
    if (proposals.length >= 8) break;
    const course = behind[i % behind.length]!;
    i++;
    const used = perCourse.get(course.id) ?? 0;
    if (used >= 2) continue;
    perCourse.set(course.id, used + 1);
    proposals.push({
      ...slot,
      end: DateTime.fromISO(`${slot.date}T${slot.start}`)
        .plus({ minutes: slot.minutes })
        .toFormat('HH:mm'),
      course_id: course.id,
      course_name: course.name,
      reason: `${course.pace.deficit_hours}h behind · needs ${course.pace.required_velocity}h/day`,
    });
  }
  return proposals;
}

export async function studyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // ── semesters ─────────────────────────────────────────────────────────────

  app.get('/api/study/semesters', async (request) => {
    const rows = await query<Semester>(
      'SELECT * FROM semesters WHERE user_id = $1 ORDER BY start_date DESC',
      [request.user.id],
    );
    return { semesters: rows };
  });

  app.post('/api/study/semesters', async (request, reply) => {
    const body = semesterSchema.parse(request.body);
    if (body.start_date > body.end_date) throw badRequest('start_date must be ≤ end_date');
    if (body.is_active) {
      await query('UPDATE semesters SET is_active = false WHERE user_id = $1', [request.user.id]);
    }
    const row = await queryOne<Semester>(
      `INSERT INTO semesters (user_id, name, start_date, end_date, is_active)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [request.user.id, body.name, body.start_date, body.end_date, body.is_active ?? false],
    );
    return reply.code(201).send({ semester: row });
  });

  app.patch('/api/study/semesters/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = semesterSchema.partial().parse(request.body);
    const current = await queryOne<Semester>(
      'SELECT * FROM semesters WHERE id = $1 AND user_id = $2',
      [id, request.user.id],
    );
    if (!current) throw notFound('Semester not found.');
    if (body.is_active) {
      await query('UPDATE semesters SET is_active = false WHERE user_id = $1', [request.user.id]);
    }
    const row = await queryOne<Semester>(
      `UPDATE semesters SET name = $3, start_date = $4, end_date = $5, is_active = $6
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [
        id,
        request.user.id,
        body.name ?? current.name,
        body.start_date ?? current.start_date,
        body.end_date ?? current.end_date,
        body.is_active ?? current.is_active,
      ],
    );
    return { semester: row };
  });

  app.delete('/api/study/semesters/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const rows = await query('DELETE FROM semesters WHERE id = $1 AND user_id = $2 RETURNING id', [
      id,
      request.user.id,
    ]);
    if (!rows.length) throw notFound('Semester not found.');
    return { ok: true };
  });

  // ── courses & lecture slots ───────────────────────────────────────────────

  app.get('/api/study/courses', async (request) => {
    const q = z.object({ semester_id: z.string().uuid().optional() }).parse(request.query);
    const rows = q.semester_id
      ? await query<Course>(
          'SELECT * FROM courses WHERE user_id = $1 AND semester_id = $2 ORDER BY name',
          [request.user.id, q.semester_id],
        )
      : await query<Course>('SELECT * FROM courses WHERE user_id = $1 ORDER BY name', [
          request.user.id,
        ]);
    return { courses: rows };
  });

  app.post('/api/study/courses', async (request, reply) => {
    const body = courseSchema.parse(request.body);
    const semester = await queryOne('SELECT 1 FROM semesters WHERE id = $1 AND user_id = $2', [
      body.semester_id,
      request.user.id,
    ]);
    if (!semester) throw badRequest('Unknown semester.');
    const row = await queryOne<Course>(
      `INSERT INTO courses (user_id, semester_id, name, ects, target_hours, target_grade, color)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        request.user.id,
        body.semester_id,
        body.name,
        body.ects,
        body.target_hours ?? body.ects * 30, // 1 ECTS ≈ 30 h
        body.target_grade ?? null,
        body.color ?? null,
      ],
    );
    return reply.code(201).send({ course: row });
  });

  app.patch('/api/study/courses/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = courseSchema.partial().parse(request.body);
    const current = await queryOne<Course>(
      'SELECT * FROM courses WHERE id = $1 AND user_id = $2',
      [id, request.user.id],
    );
    if (!current) throw notFound('Course not found.');
    const row = await queryOne<Course>(
      `UPDATE courses SET name = $3, ects = $4, target_hours = $5, target_grade = $6, color = $7
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [
        id,
        request.user.id,
        body.name ?? current.name,
        body.ects ?? current.ects,
        body.target_hours ?? current.target_hours,
        body.target_grade !== undefined ? body.target_grade : current.target_grade,
        body.color !== undefined ? body.color : current.color,
      ],
    );
    return { course: row };
  });

  app.delete('/api/study/courses/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const rows = await query('DELETE FROM courses WHERE id = $1 AND user_id = $2 RETURNING id', [
      id,
      request.user.id,
    ]);
    if (!rows.length) throw notFound('Course not found.');
    return { ok: true };
  });

  app.put('/api/study/courses/:id/slots', async (request) => {
    const { id } = idParams.parse(request.params);
    const { slots } = slotsSchema.parse(request.body);
    for (const s of slots) {
      if (s.start_time >= s.end_time) throw badRequest('start_time must be before end_time');
    }
    const course = await queryOne('SELECT 1 FROM courses WHERE id = $1 AND user_id = $2', [
      id,
      request.user.id,
    ]);
    if (!course) throw notFound('Course not found.');

    await query('DELETE FROM lecture_slots WHERE course_id = $1', [id]);
    for (const s of slots) {
      await query(
        `INSERT INTO lecture_slots (course_id, weekday, start_time, end_time, location)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, s.weekday, s.start_time, s.end_time, s.location ?? null],
      );
    }
    return { ok: true };
  });

  // ── sessions ──────────────────────────────────────────────────────────────

  app.post('/api/study/sessions', async (request, reply) => {
    const body = sessionSchema.parse(request.body);
    const course = await queryOne('SELECT 1 FROM courses WHERE id = $1 AND user_id = $2', [
      body.course_id,
      request.user.id,
    ]);
    if (!course) throw badRequest('Unknown course.');
    const row = await queryOne(
      `INSERT INTO study_sessions (user_id, course_id, date, minutes, is_self_study, effort, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        request.user.id,
        body.course_id,
        body.date,
        body.minutes,
        body.is_self_study,
        body.effort ?? null,
        body.note ?? null,
      ],
    );
    return reply.code(201).send({ session: row });
  });

  app.get('/api/study/sessions', async (request) => {
    const q = z
      .object({
        course_id: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(20),
      })
      .parse(request.query);
    const rows = q.course_id
      ? await query(
          `SELECT s.*, c.name AS course_name FROM study_sessions s
           JOIN courses c ON c.id = s.course_id
           WHERE s.user_id = $1 AND s.course_id = $2
           ORDER BY s.date DESC, s.created_at DESC LIMIT $3`,
          [request.user.id, q.course_id, q.limit],
        )
      : await query(
          `SELECT s.*, c.name AS course_name FROM study_sessions s
           JOIN courses c ON c.id = s.course_id
           WHERE s.user_id = $1
           ORDER BY s.date DESC, s.created_at DESC LIMIT $2`,
          [request.user.id, q.limit],
        );
    return { sessions: rows };
  });

  app.delete('/api/study/sessions/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const rows = await query(
      'DELETE FROM study_sessions WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, request.user.id],
    );
    if (!rows.length) throw notFound('Session not found.');
    return { ok: true };
  });

  // ── overview (§4.3) & study blocks (§4.7) ─────────────────────────────────

  app.get('/api/study/overview', async (request) => {
    const q = z.object({ semester_id: z.string().uuid().optional() }).parse(request.query);
    const semester = q.semester_id
      ? await queryOne<Semester>('SELECT * FROM semesters WHERE id = $1 AND user_id = $2', [
          q.semester_id,
          request.user.id,
        ])
      : await activeSemester(request.user.id);
    if (!semester) return { semester: null, courses: [] };
    return { semester, courses: await courseOverviews(request.user.id, semester) };
  });

  // §4.3 — re-voice the deterministic advice ladder through the bureau clerk.
  app.post('/api/study/advice', async (request) => {
    const body = z.object({ course_id: z.string().uuid() }).parse(request.body);
    const course = await queryOne<Course>(
      'SELECT * FROM courses WHERE id = $1 AND user_id = $2',
      [body.course_id, request.user.id],
    );
    if (!course) throw notFound('Course not found.');
    const semester = await queryOne<Semester>(
      'SELECT * FROM semesters WHERE id = $1 AND user_id = $2',
      [course.semester_id, request.user.id],
    );
    if (!semester) throw notFound('Semester not found.');

    const overview = (await courseOverviews(request.user.id, semester)).find(
      (c) => c.id === course.id,
    );
    if (!overview) throw notFound('Course not found.');
    const fallback = paceAdvice(overview.pace);

    if (!isGeminiConfigured()) return { advice: fallback, generator: 'fallback' };
    try {
      const advice = await generateText({
        system:
          'You are the Lodestar bureau clerk. In one or two wry, warm telegram sentences, tell ' +
          'the student THE ONE thing to change about how they study this course — grounded ' +
          'strictly in the breakdown given. No markdown, no lists, no sign-off.',
        user: JSON.stringify({
          course: course.name,
          target_grade: overview.target_grade,
          raw_roi_pct: overview.pace.roi,
          adjusted_roi_pct: overview.pace.adjusted_roi,
          predicted_grade: overview.pace.predicted_grade,
          required_hours_per_day: overview.pace.required_velocity,
          deficit_hours: overview.pace.deficit_hours,
          consistency: overview.pace.consistency,
          active_weeks: overview.pace.active_weeks,
          weeks_elapsed: overview.pace.weeks_elapsed,
          avg_effort_1to5: overview.pace.avg_effort,
          deterministic_diagnosis: fallback,
        }),
        temperature: 0.8,
        maxOutputTokens: 256,
      });
      return { advice, generator: 'gemini' };
    } catch (err) {
      console.warn('[study] advice via Gemini failed:', (err as Error).message);
      return { advice: fallback, generator: 'fallback' };
    }
  });

  app.get('/api/study/blocks', async (request) => {
    return { blocks: await proposeStudyBlocks(request.user.id, request.user.tz) };
  });

  app.post('/api/study/blocks/book', async (request, reply) => {
    const body = z
      .object({
        course_id: z.string().uuid(),
        date: zDate,
        start: zTime,
        minutes: z.number().int().min(15).max(8 * 60),
      })
      .parse(request.body);
    const course = await queryOne<{ name: string; color: string | null }>(
      'SELECT name, color FROM courses WHERE id = $1 AND user_id = $2',
      [body.course_id, request.user.id],
    );
    if (!course) throw badRequest('Unknown course.');

    const startLocal = DateTime.fromISO(`${body.date}T${body.start}`, { zone: request.user.tz });
    if (!startLocal.isValid) throw badRequest('Invalid date/time.');
    const endLocal = startLocal.plus({ minutes: body.minutes });

    const row = await queryOne(
      `INSERT INTO events (owner_id, title, all_day, start_utc, end_utc, tz, color, icon, source)
       VALUES ($1, $2, false, $3, $4, $5, $6, '📚', 'study_block')
       RETURNING *`,
      [
        request.user.id,
        `Study: ${course.name}`,
        startLocal.toUTC().toISO(),
        endLocal.toUTC().toISO(),
        request.user.tz,
        course.color,
      ],
    );
    return reply.code(201).send({ event: row });
  });
}

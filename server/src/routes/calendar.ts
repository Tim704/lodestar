// Calendar module — the Whenabouts port (CONTRACT §4.4, §5): shared events,
// terms/breaks, availability, the find-a-date overlap finder, private iCal.

import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DateTime } from 'luxon';
import {
  computeOverlap,
  isValidDateStr,
  MAX_RANGE_DAYS,
  diffDays,
  type AvailabilityPeriod,
  type CalendarEvent,
  type TermPeriod,
} from '@lodestar/shared';
import { query, queryOne } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { buildIcs, type IcsItem } from '../lib/ical.js';
import { userGroupIds } from './auth.js';

const zDate = z.string().refine(isValidDateStr, 'expected YYYY-MM-DD');
const zInstant = z.string().datetime({ offset: true });
const idParams = z.object({ id: z.string().uuid() });

interface EventRow {
  id: string;
  owner_id: string;
  group_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  all_day: boolean;
  start_date: string | null;
  end_date: string | null;
  start_utc: Date | null;
  end_utc: Date | null;
  tz: string;
  color: string | null;
  icon: string | null;
  source: 'manual' | 'study_block';
  owner_name?: string;
  owner_color?: string;
}

export function rowToEvent(r: EventRow): CalendarEvent {
  return {
    ...r,
    start_utc: r.start_utc ? new Date(r.start_utc).toISOString() : null,
    end_utc: r.end_utc ? new Date(r.end_utc).toISOString() : null,
  };
}

const eventBase = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
  location: z.string().trim().max(200).nullish(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  icon: z.string().trim().max(8).nullish(),
  group_id: z.string().uuid().nullish(),
};

const eventSchema = z
  .discriminatedUnion('all_day', [
    z.object({ ...eventBase, all_day: z.literal(true), start_date: zDate, end_date: zDate }),
    z.object({ ...eventBase, all_day: z.literal(false), start_utc: zInstant, end_utc: zInstant }),
  ])
  .superRefine((v, ctx) => {
    if (v.all_day && v.start_date > v.end_date) {
      ctx.addIssue({ code: 'custom', message: 'start_date must be ≤ end_date' });
    }
    if (!v.all_day && v.start_utc > v.end_utc) {
      ctx.addIssue({ code: 'custom', message: 'start_utc must be ≤ end_utc' });
    }
  });

const termSchema = z.object({
  label: z.string().trim().min(1).max(80),
  kind: z.enum(['term', 'break']),
  start_date: zDate,
  end_date: zDate,
});

const availabilitySchema = z.object({
  status: z.enum(['free', 'busy', 'maybe']),
  start_date: zDate,
  end_date: zDate,
  note: z.string().trim().max(500).nullish(),
});

async function assertGroupMembership(userId: string, groupId: string | null | undefined) {
  if (!groupId) return;
  const ok = await queryOne('SELECT 1 FROM memberships WHERE user_id = $1 AND group_id = $2', [
    userId,
    groupId,
  ]);
  if (!ok) throw forbidden('You are not in that group.');
}

/** own events + events shared to any of the user's groups, in a date window */
export async function visibleEvents(
  userId: string,
  from: string,
  to: string,
): Promise<CalendarEvent[]> {
  const rows = await query<EventRow>(
    `SELECT e.*, u.display_name AS owner_name, u.color AS owner_color
     FROM events e JOIN users u ON u.id = e.owner_id
     WHERE (e.owner_id = $1 OR e.group_id IN (SELECT group_id FROM memberships WHERE user_id = $1))
       AND (
         (e.all_day AND e.start_date <= $3::date AND e.end_date >= $2::date)
         OR (NOT e.all_day AND e.start_utc < ($3::date + interval '1 day') AND e.end_utc >= $2::date)
       )
     ORDER BY COALESCE(e.start_utc, e.start_date::timestamptz)`,
    [userId, from, to],
  );
  return rows.map(rowToEvent);
}

export async function calendarRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // ── events ────────────────────────────────────────────────────────────────

  app.get('/api/calendar/events', async (request) => {
    const q = z.object({ from: zDate, to: zDate }).parse(request.query);
    if (q.from > q.to) throw badRequest('from must be ≤ to');
    if (diffDays(q.from, q.to) > MAX_RANGE_DAYS) throw badRequest('range too large');
    return { events: await visibleEvents(request.user.id, q.from, q.to) };
  });

  app.post('/api/calendar/events', async (request, reply) => {
    const body = eventSchema.parse(request.body);
    await assertGroupMembership(request.user.id, body.group_id);
    const row = await queryOne<EventRow>(
      `INSERT INTO events (owner_id, group_id, title, description, location, all_day,
                           start_date, end_date, start_utc, end_utc, tz, color, icon)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        request.user.id,
        body.group_id ?? null,
        body.title,
        body.description ?? null,
        body.location ?? null,
        body.all_day,
        body.all_day ? body.start_date : null,
        body.all_day ? body.end_date : null,
        body.all_day ? null : body.start_utc,
        body.all_day ? null : body.end_utc,
        request.user.tz,
        body.color ?? null,
        body.icon ?? null,
      ],
    );
    return reply.code(201).send({ event: rowToEvent(row!) });
  });

  app.patch('/api/calendar/events/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = eventSchema.parse(request.body); // full replace of the when/what
    await assertGroupMembership(request.user.id, body.group_id);
    const row = await queryOne<EventRow>(
      `UPDATE events
       SET group_id = $3, title = $4, description = $5, location = $6, all_day = $7,
           start_date = $8, end_date = $9, start_utc = $10, end_utc = $11, color = $12, icon = $13
       WHERE id = $1 AND owner_id = $2
       RETURNING *`,
      [
        id,
        request.user.id,
        body.group_id ?? null,
        body.title,
        body.description ?? null,
        body.location ?? null,
        body.all_day,
        body.all_day ? body.start_date : null,
        body.all_day ? body.end_date : null,
        body.all_day ? null : body.start_utc,
        body.all_day ? null : body.end_utc,
        body.color ?? null,
        body.icon ?? null,
      ],
    );
    if (!row) throw notFound('Event not found (only the owner can edit it).');
    return { event: rowToEvent(row) };
  });

  app.delete('/api/calendar/events/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const rows = await query('DELETE FROM events WHERE id = $1 AND owner_id = $2 RETURNING id', [
      id,
      request.user.id,
    ]);
    if (!rows.length) throw notFound('Event not found (only the owner can delete it).');
    return { ok: true };
  });

  // ── terms & availability (own + group members', for context and the finder) ─

  app.get('/api/calendar/terms', async (request) => {
    const rows = await query(
      `SELECT t.*, u.display_name AS user_name, u.color AS user_color
       FROM terms t JOIN users u ON u.id = t.user_id
       WHERE t.user_id = $1 OR t.user_id IN (
         SELECT m2.user_id FROM memberships m1
         JOIN memberships m2 ON m1.group_id = m2.group_id
         WHERE m1.user_id = $1)
       ORDER BY t.start_date`,
      [request.user.id],
    );
    return { terms: rows };
  });

  app.post('/api/calendar/terms', async (request, reply) => {
    const body = termSchema.parse(request.body);
    if (body.start_date > body.end_date) throw badRequest('start_date must be ≤ end_date');
    const row = await queryOne(
      `INSERT INTO terms (user_id, label, kind, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [request.user.id, body.label, body.kind, body.start_date, body.end_date],
    );
    return reply.code(201).send({ term: row });
  });

  app.patch('/api/calendar/terms/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = termSchema.parse(request.body);
    if (body.start_date > body.end_date) throw badRequest('start_date must be ≤ end_date');
    const row = await queryOne(
      `UPDATE terms SET label = $3, kind = $4, start_date = $5, end_date = $6
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, request.user.id, body.label, body.kind, body.start_date, body.end_date],
    );
    if (!row) throw notFound('Term not found.');
    return { term: row };
  });

  app.delete('/api/calendar/terms/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const rows = await query('DELETE FROM terms WHERE id = $1 AND user_id = $2 RETURNING id', [
      id,
      request.user.id,
    ]);
    if (!rows.length) throw notFound('Term not found.');
    return { ok: true };
  });

  app.get('/api/calendar/availability', async (request) => {
    const rows = await query(
      `SELECT a.*, u.display_name AS user_name, u.color AS user_color
       FROM availability a JOIN users u ON u.id = a.user_id
       WHERE a.user_id = $1 OR a.user_id IN (
         SELECT m2.user_id FROM memberships m1
         JOIN memberships m2 ON m1.group_id = m2.group_id
         WHERE m1.user_id = $1)
       ORDER BY a.start_date`,
      [request.user.id],
    );
    return { availability: rows };
  });

  app.post('/api/calendar/availability', async (request, reply) => {
    const body = availabilitySchema.parse(request.body);
    if (body.start_date > body.end_date) throw badRequest('start_date must be ≤ end_date');
    const row = await queryOne(
      `INSERT INTO availability (user_id, status, start_date, end_date, note)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [request.user.id, body.status, body.start_date, body.end_date, body.note ?? null],
    );
    return reply.code(201).send({ availability: row });
  });

  app.patch('/api/calendar/availability/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = availabilitySchema.parse(request.body);
    if (body.start_date > body.end_date) throw badRequest('start_date must be ≤ end_date');
    const row = await queryOne(
      `UPDATE availability SET status = $3, start_date = $4, end_date = $5, note = $6
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, request.user.id, body.status, body.start_date, body.end_date, body.note ?? null],
    );
    if (!row) throw notFound('Availability entry not found.');
    return { availability: row };
  });

  app.delete('/api/calendar/availability/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const rows = await query(
      'DELETE FROM availability WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, request.user.id],
    );
    if (!rows.length) throw notFound('Availability entry not found.');
    return { ok: true };
  });

  // ── find-a-date (CONTRACT §4.4) ───────────────────────────────────────────

  app.get('/api/calendar/find', async (request) => {
    const q = z
      .object({
        start_date: zDate,
        end_date: zDate,
        min_people: z.coerce.number().int().min(1).max(50).default(2),
        only_on_break: z
          .enum(['true', 'false', '1', '0'])
          .default('false')
          .transform((v) => v === 'true' || v === '1'),
        group_id: z.string().uuid().optional(),
      })
      .parse(request.query);
    if (q.start_date > q.end_date) throw badRequest('start_date must be ≤ end_date');
    if (diffDays(q.start_date, q.end_date) + 1 > MAX_RANGE_DAYS) {
      throw badRequest(`Date range too large; the maximum span is ${MAX_RANGE_DAYS} days.`);
    }

    let userIds: string[];
    if (q.group_id) {
      await assertGroupMembership(request.user.id, q.group_id);
      const rows = await query<{ user_id: string }>(
        'SELECT user_id FROM memberships WHERE group_id = $1',
        [q.group_id],
      );
      userIds = rows.map((r) => r.user_id);
    } else {
      const groupIds = await userGroupIds(request.user.id);
      if (groupIds.length) {
        const rows = await query<{ user_id: string }>(
          'SELECT DISTINCT user_id FROM memberships WHERE group_id = ANY($1)',
          [groupIds],
        );
        userIds = rows.map((r) => r.user_id);
      } else {
        userIds = [request.user.id];
      }
    }
    if (!userIds.includes(request.user.id)) userIds.push(request.user.id);

    const availability = await query<AvailabilityPeriod>(
      `SELECT user_id, status, start_date, end_date FROM availability WHERE user_id = ANY($1)`,
      [userIds],
    );
    const terms = await query<TermPeriod>(
      `SELECT user_id, kind, start_date, end_date FROM terms WHERE user_id = ANY($1)`,
      [userIds],
    );
    const users = await query<{ id: string; display_name: string; color: string }>(
      'SELECT id, display_name, color FROM users WHERE id = ANY($1)',
      [userIds],
    );

    const result = computeOverlap({
      userIds,
      availability,
      terms,
      startDate: q.start_date,
      endDate: q.end_date,
      minPeople: q.min_people,
      onlyOnBreak: q.only_on_break,
    });
    return { result, users };
  });

  // ── private iCal feed ─────────────────────────────────────────────────────

  app.get('/api/calendar/ical-url', async (request) => {
    let row = await queryOne<{ token: string }>(
      'SELECT token FROM ical_tokens WHERE user_id = $1',
      [request.user.id],
    );
    if (!row) {
      row = await queryOne<{ token: string }>(
        'INSERT INTO ical_tokens (user_id, token) VALUES ($1, $2) RETURNING token',
        [request.user.id, randomBytes(32).toString('hex')],
      );
    }
    return { path: `/ical/${row!.token}.ics` };
  });

  app.post('/api/calendar/ical-rotate', async (request) => {
    const token = randomBytes(32).toString('hex');
    await query(
      `INSERT INTO ical_tokens (user_id, token) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token`,
      [request.user.id, token],
    );
    return { path: `/ical/${token}.ics` };
  });
}

/** Public-by-token feed — registered without the auth hook. */
export async function icalRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ical/:token.ics', async (request, reply) => {
    const { token } = z.object({ token: z.string().min(16).max(128) }).parse(request.params);
    const owner = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM ical_tokens WHERE token = $1',
      [token],
    );
    if (!owner) throw notFound();

    const from = DateTime.utc().minus({ months: 3 }).toISODate()!;
    const to = DateTime.utc().plus({ months: 12 }).toISODate()!;
    const events = await visibleEvents(owner.user_id, from, to);
    const items: IcsItem[] = events.map((e) => ({
      uid: `${e.id}@lodestar`,
      summary: e.icon ? `${e.icon} ${e.title}` : e.title,
      description: e.description,
      location: e.location,
      allDay: e.all_day,
      startDate: e.start_date,
      endDate: e.end_date,
      startUtc: e.start_utc,
      endUtc: e.end_utc,
    }));
    const ics = buildIcs('Lodestar', items, DateTime.utc().toISO()!);
    return reply.header('Content-Type', 'text/calendar; charset=utf-8').send(ics);
  });
}

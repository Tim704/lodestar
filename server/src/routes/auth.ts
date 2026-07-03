import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { config } from '../config.js';
import { query, queryOne } from '../db.js';
import {
  clearSessionCookie,
  hashPassword,
  requireAuth,
  sanitizeUser,
  setSessionCookie,
  verifyPassword,
  type UserRow,
} from '../lib/auth.js';
import { badRequest, conflict, forbidden, unauthorized } from '../lib/errors.js';

const USER_COLORS = ['#b7791f', '#2f7f6f', '#6b5ba5', '#b0532f', '#33718f', '#4a7c43', '#a5527a'];

const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'letters, digits, _ . - only'),
  password: z.string().min(8).max(200),
  display_name: z.string().trim().min(1).max(50),
  invite_code: z.string().trim().optional(),
});

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

const settingsSchema = z
  .object({
    briefing_hour: z.number().int().min(0).max(23).optional(),
    ntfy_topic: z.string().trim().max(120).nullable().optional(),
  })
  .strict();

const patchMeSchema = z
  .object({
    display_name: z.string().trim().min(1).max(50).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    tz: z
      .string()
      .refine((tz) => DateTime.local().setZone(tz).isValid, 'invalid IANA timezone')
      .optional(),
    settings: settingsSchema.optional(),
  })
  .strict();

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);

    const countRow = await queryOne<{ n: string }>('SELECT count(*)::text AS n FROM users');
    const isFirstUser = Number(countRow?.n ?? 0) === 0;

    let joinGroupId: string | null = null;
    if (!isFirstUser && !config.registrationOpen) {
      if (!body.invite_code) {
        throw forbidden('Registration is invite-only — ask for an invite code.');
      }
      const group = await queryOne<{ id: string }>(
        'SELECT id FROM groups WHERE invite_code = $1',
        [body.invite_code],
      );
      if (!group) throw forbidden('That invite code is not valid.');
      joinGroupId = group.id;
    } else if (body.invite_code) {
      const group = await queryOne<{ id: string }>(
        'SELECT id FROM groups WHERE invite_code = $1',
        [body.invite_code],
      );
      joinGroupId = group?.id ?? null;
    }

    const existing = await queryOne('SELECT 1 FROM users WHERE lower(username) = lower($1)', [
      body.username,
    ]);
    if (existing) throw conflict('That username is taken.');

    const color = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)]!;
    const user = await queryOne<UserRow>(
      `INSERT INTO users (username, display_name, password_hash, color, tz, is_admin, settings)
       VALUES ($1, $2, $3, $4, $5, $6, '{"briefing_hour": 7}')
       RETURNING *`,
      [
        body.username.toLowerCase(),
        body.display_name,
        await hashPassword(body.password),
        color,
        config.defaultTz,
        isFirstUser,
      ],
    );
    if (!user) throw new Error('user insert returned no row');

    if (joinGroupId) {
      await query(
        `INSERT INTO memberships (user_id, group_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [user.id, joinGroupId],
      );
    }

    setSessionCookie(reply, user.id);
    return reply.code(201).send({ user: sanitizeUser(user) });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = await queryOne<UserRow>('SELECT * FROM users WHERE lower(username) = lower($1)', [
      body.username,
    ]);
    if (!user || !(await verifyPassword(body.password, user.password_hash))) {
      throw unauthorized('Wrong username or password.');
    }
    setSessionCookie(reply, user.id);
    return { user: sanitizeUser(user) };
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (request) => {
    return { user: sanitizeUser(request.user) };
  });

  app.patch('/api/auth/me', { preHandler: requireAuth }, async (request) => {
    const body = patchMeSchema.parse(request.body);
    if (Object.keys(body).length === 0) throw badRequest('Nothing to update.');

    const current = request.user;
    const mergedSettings = { ...current.settings, ...(body.settings ?? {}) };

    const updated = await queryOne<UserRow>(
      `UPDATE users
       SET display_name = $2, color = $3, tz = $4, settings = $5
       WHERE id = $1
       RETURNING *`,
      [
        current.id,
        body.display_name ?? current.display_name,
        body.color ?? current.color,
        body.tz ?? current.tz,
        JSON.stringify(mergedSettings),
      ],
    );
    return { user: sanitizeUser(updated!) };
  });
}

export async function groupRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/api/groups', async (request) => {
    const groups = await query<{ id: string; name: string; invite_code: string }>(
      `SELECT g.id, g.name, g.invite_code
       FROM groups g JOIN memberships m ON m.group_id = g.id
       WHERE m.user_id = $1
       ORDER BY g.created_at`,
      [request.user.id],
    );
    const withMembers = await Promise.all(
      groups.map(async (g) => ({
        ...g,
        members: await query<{ id: string; display_name: string; color: string }>(
          `SELECT u.id, u.display_name, u.color
           FROM users u JOIN memberships m ON m.user_id = u.id
           WHERE m.group_id = $1 ORDER BY u.display_name`,
          [g.id],
        ),
      })),
    );
    return { groups: withMembers };
  });

  app.post('/api/groups', async (request, reply) => {
    const body = z.object({ name: z.string().trim().min(1).max(60) }).parse(request.body);
    const inviteCode = randomBytes(6).toString('base64url');
    const group = await queryOne<{ id: string; name: string; invite_code: string }>(
      `INSERT INTO groups (name, invite_code, created_by)
       VALUES ($1, $2, $3) RETURNING id, name, invite_code`,
      [body.name, inviteCode, request.user.id],
    );
    await query(`INSERT INTO memberships (user_id, group_id, role) VALUES ($1, $2, 'owner')`, [
      request.user.id,
      group!.id,
    ]);
    return reply.code(201).send({ group });
  });

  app.post('/api/groups/join', async (request) => {
    const body = z.object({ invite_code: z.string().trim().min(1) }).parse(request.body);
    const group = await queryOne<{ id: string; name: string }>(
      'SELECT id, name FROM groups WHERE invite_code = $1',
      [body.invite_code],
    );
    if (!group) throw badRequest('That invite code is not valid.');
    await query(
      `INSERT INTO memberships (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [request.user.id, group.id],
    );
    return { group };
  });
}

/** ids of all groups the user belongs to — used by calendar/notes visibility. */
export async function userGroupIds(userId: string): Promise<string[]> {
  const rows = await query<{ group_id: string }>(
    'SELECT group_id FROM memberships WHERE user_id = $1',
    [userId],
  );
  return rows.map((r) => r.group_id);
}

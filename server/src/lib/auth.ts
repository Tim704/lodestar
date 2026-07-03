// Password + JWT-cookie auth — CONTRACT §5. bcryptjs (pure JS — no native
// builds on arm64), 30-day JWT {uid} in an httpOnly SameSite=Lax cookie.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User, UserSettings } from '@lodestar/shared';
import { config } from '../config.js';
import { queryOne } from '../db.js';
import { unauthorized } from './errors.js';

export const COOKIE_NAME = 'lodestar_session';
const TOKEN_TTL = '30d';
const BCRYPT_COST = 10;

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  color: string;
  tz: string;
  is_admin: boolean;
  settings: Record<string, unknown>;
  created_at: Date;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(userId: string): string {
  return jwt.sign({ uid: userId }, config.jwtSecret, { expiresIn: TOKEN_TTL });
}

export function verifyToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (typeof payload === 'object' && payload && typeof payload.uid === 'string') {
      return payload.uid;
    }
    return null;
  } catch {
    return null;
  }
}

export function setSessionCookie(reply: FastifyReply, userId: string): void {
  reply.setCookie(COOKIE_NAME, signToken(userId), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd, // behind the tunnel/TLS in prod
    maxAge: 30 * 24 * 60 * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(COOKIE_NAME, { path: '/' });
}

export async function loadUserFromCookies(
  cookies: Record<string, string | undefined>,
): Promise<UserRow | null> {
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const uid = verifyToken(token);
  if (!uid) return null;
  return queryOne<UserRow>('SELECT * FROM users WHERE id = $1', [uid]);
}

/** preHandler for all authed routes: attaches `request.user` or throws 401. */
export async function requireAuth(request: FastifyRequest): Promise<void> {
  const user = await loadUserFromCookies(request.cookies);
  if (!user) throw unauthorized();
  request.user = user;
}

export function userSettings(row: UserRow): UserSettings {
  const s = row.settings ?? {};
  const hour = Number((s as { briefing_hour?: unknown }).briefing_hour);
  return {
    briefing_hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 7,
    ntfy_topic:
      typeof (s as { ntfy_topic?: unknown }).ntfy_topic === 'string'
        ? ((s as { ntfy_topic: string }).ntfy_topic)
        : null,
  };
}

export function sanitizeUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    color: row.color,
    tz: row.tz,
    is_admin: row.is_admin,
    settings: userSettings(row),
    created_at: new Date(row.created_at).toISOString(),
  };
}

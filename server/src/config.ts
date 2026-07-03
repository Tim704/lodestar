// Environment config — CONTRACT §2. Read once at boot.
import 'dotenv/config';

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
}

function int(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const isProd = process.env.NODE_ENV === 'production';

const jwtSecret = process.env.JWT_SECRET || '';
if (!jwtSecret) {
  if (isProd) {
    throw new Error('JWT_SECRET is required in production. Set it in .env.');
  }
  console.warn('[config] JWT_SECRET not set — using an insecure dev fallback.');
}

export const config = {
  isProd,
  databaseUrl:
    process.env.DATABASE_URL || 'postgres://lodestar:lodestar@localhost:5433/lodestar',
  port: int(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: jwtSecret || 'lodestar-dev-secret',
  registrationOpen: bool(process.env.REGISTRATION_OPEN, false),
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    base: (process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com').replace(
      /\/+$/,
      '',
    ),
    timeoutMs: int(process.env.GEMINI_TIMEOUT_MS, 60_000),
  },
  ntfy: {
    server: (process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, ''),
    defaultTopic: process.env.NTFY_DEFAULT_TOPIC || '',
  },
  tmdbApiKey: process.env.TMDB_API_KEY || '',
  defaultTz: process.env.DEFAULT_TZ || 'Europe/Zurich',
} as const;

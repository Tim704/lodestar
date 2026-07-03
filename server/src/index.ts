// Lodestar server — one Fastify process: API + WebSockets + static web build
// + in-process scheduler (CONTRACT §1).

import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { config } from './config.js';
import { pool } from './db.js';
import { migrate } from './migrate.js';
import { HttpError } from './lib/errors.js';
import { flushAllRooms } from './lib/yjs.js';
import { startScheduler, stopScheduler } from './jobs/cron.js';
import { authRoutes, groupRoutes } from './routes/auth.js';
import { taskRoutes } from './routes/tasks.js';
import { calendarRoutes, icalRoutes } from './routes/calendar.js';
import { studyRoutes } from './routes/study.js';
import { noteRoutes, noteSocketRoutes } from './routes/notes.js';
import { mediaRoutes } from './routes/media.js';
import { watcherRoutes } from './routes/watchers.js';
import { habitRoutes } from './routes/habits.js';
import { notificationRoutes } from './routes/notifications.js';
import { assistantRoutes } from './routes/assistant.js';
import { todayRoutes } from './routes/today.js';
import { searchRoutes } from './routes/search.js';

const app = Fastify({
  logger: config.isProd ? { level: 'info' } : { level: 'info', transport: undefined },
  bodyLimit: 1_048_576,
});

app.setErrorHandler((err: unknown, _request, reply) => {
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    return reply.code(400).send({ error: `${where}${issue?.message ?? 'invalid input'}` });
  }
  if (err instanceof HttpError) {
    return reply.code(err.status).send({ error: err.message });
  }
  const e = err as { statusCode?: unknown; message?: unknown };
  const statusCode = typeof e.statusCode === 'number' ? e.statusCode : 500;
  if (statusCode >= 500) app.log.error(err);
  return reply.code(statusCode).send({
    error: statusCode >= 500 ? 'Internal error.' : String(e.message ?? 'Request failed.'),
  });
});

await app.register(cookie);
await app.register(websocket, { options: { maxPayload: 4 * 1024 * 1024 } });

app.get('/healthz', async () => {
  await pool.query('SELECT 1');
  return { ok: true, name: 'lodestar' };
});

await app.register(authRoutes);
await app.register(groupRoutes);
await app.register(taskRoutes);
await app.register(calendarRoutes);
await app.register(icalRoutes);
await app.register(studyRoutes);
await app.register(noteRoutes);
await app.register(noteSocketRoutes);
await app.register(mediaRoutes);
await app.register(watcherRoutes);
await app.register(habitRoutes);
await app.register(notificationRoutes);
await app.register(assistantRoutes);
await app.register(todayRoutes);
await app.register(searchRoutes);

// static web build (prod): server/public (Docker) or ../web/dist (local build)
const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = [path.join(here, '..', 'public'), path.join(here, '..', '..', 'web', 'dist')].find(
  (p) => existsSync(path.join(p, 'index.html')),
);
if (webDist) {
  await app.register(fastifyStatic, { root: webDist, wildcard: false });
  // SPA fallback for client-side routes
  app.setNotFoundHandler((request, reply) => {
    if (
      request.method === 'GET' &&
      !request.url.startsWith('/api') &&
      !request.url.startsWith('/ws') &&
      !request.url.startsWith('/ical')
    ) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not found.' });
  });
  app.log.info(`serving web build from ${webDist}`);
}

await migrate();
await app.listen({ port: config.port, host: config.host });
startScheduler();

const shutdown = async (signal: string) => {
  app.log.info(`${signal} — shutting down`);
  stopScheduler();
  await flushAllRooms().catch(() => {});
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

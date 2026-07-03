// Backlog module — the Hoard port: seven domains, five statuses, ratings,
// and the AI critic. One polymorphic table instead of Hoard's seven (v1
// simplification; the wire shape carries domain-specific bits in `extra`).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MEDIA_DOMAINS, type MediaItem } from '@lodestar/shared';
import { query, queryOne } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { generateText, isGeminiConfigured } from '../lib/gemini.js';
import { searchAvailable, searchMedia } from '../lib/mediaSearch.js';

const idParams = z.object({ id: z.string().uuid() });
const zDomain = z.enum(['book', 'movie', 'tv', 'anime', 'manga', 'game', 'music']);
const zStatus = z.enum(['PLANNED', 'CONSUMING', 'COMPLETED', 'DROPPED', 'ON_HOLD']);

const createSchema = z.object({
  domain: zDomain,
  title: z.string().trim().min(1).max(300),
  creator: z.string().trim().max(200).nullish(),
  year: z.number().int().min(0).max(3000).nullish(),
  image_url: z.string().url().max(500).nullish(),
  description: z.string().trim().max(2000).nullish(),
  external_source: z.string().trim().max(40).nullish(),
  external_id: z.string().trim().max(120).nullish(),
  status: zStatus.optional(),
  extra: z.record(z.unknown()).optional(),
});

const patchSchema = z
  .object({
    status: zStatus.optional(),
    rating: z.number().int().min(1).max(10).nullable().optional(),
    favorite: z.boolean().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    started_at: z.string().nullable().optional(),
    finished_at: z.string().nullable().optional(),
  })
  .strict();

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/api/media', async (request) => {
    const q = z
      .object({
        domain: zDomain.optional(),
        status: zStatus.optional(),
        q: z.string().trim().max(120).optional(),
        sort: z.enum(['recent', 'rating', 'title', 'year']).default('recent'),
      })
      .parse(request.query);

    const where = ['user_id = $1'];
    const params: unknown[] = [request.user.id];
    if (q.domain) {
      params.push(q.domain);
      where.push(`domain = $${params.length}`);
    }
    if (q.status) {
      params.push(q.status);
      where.push(`status = $${params.length}`);
    }
    if (q.q) {
      params.push(`%${q.q}%`);
      where.push(`(title ILIKE $${params.length} OR creator ILIKE $${params.length})`);
    }
    const order = {
      recent: 'updated_at DESC',
      rating: 'rating DESC NULLS LAST, updated_at DESC',
      title: 'title ASC',
      year: 'year DESC NULLS LAST',
    }[q.sort];

    const rows = await query<MediaItem>(
      `SELECT * FROM media_items WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 500`,
      params,
    );
    return { items: rows };
  });

  app.get('/api/media/search', async (request) => {
    const q = z
      .object({ domain: zDomain, q: z.string().trim().min(1).max(200) })
      .parse(request.query);
    if (!searchAvailable(q.domain)) {
      return { results: [], manual_only: true };
    }
    try {
      return { results: await searchMedia(q.domain, q.q), manual_only: false };
    } catch (err) {
      throw badRequest(`Search upstream failed: ${(err as Error).message}`);
    }
  });

  app.post('/api/media', async (request, reply) => {
    const body = createSchema.parse(request.body);
    if (body.external_id) {
      const dupe = await queryOne(
        'SELECT 1 FROM media_items WHERE user_id = $1 AND domain = $2 AND external_id = $3',
        [request.user.id, body.domain, body.external_id],
      );
      if (dupe) throw badRequest('Already in your backlog.');
    }
    const row = await queryOne<MediaItem>(
      `INSERT INTO media_items (user_id, domain, title, creator, year, image_url, description,
                                external_source, external_id, status, extra)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        request.user.id,
        body.domain,
        body.title,
        body.creator ?? null,
        body.year ?? null,
        body.image_url ?? null,
        body.description ?? null,
        body.external_source ?? null,
        body.external_id ?? null,
        body.status ?? 'PLANNED',
        JSON.stringify(body.extra ?? {}),
      ],
    );
    return reply.code(201).send({ item: row });
  });

  app.patch('/api/media/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = patchSchema.parse(request.body);
    const current = await queryOne<MediaItem>(
      'SELECT * FROM media_items WHERE id = $1 AND user_id = $2',
      [id, request.user.id],
    );
    if (!current) throw notFound('Item not found.');

    // status transitions stamp dates automatically (Hoard behaviour)
    let started = body.started_at !== undefined ? body.started_at : current.started_at;
    let finished = body.finished_at !== undefined ? body.finished_at : current.finished_at;
    const today = new Date().toISOString().slice(0, 10);
    if (body.status === 'CONSUMING' && !started) started = today;
    if (body.status === 'COMPLETED' && !finished) finished = today;

    const row = await queryOne<MediaItem>(
      `UPDATE media_items
       SET status = $3, rating = $4, favorite = $5, notes = $6, started_at = $7,
           finished_at = $8, updated_at = now()
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [
        id,
        request.user.id,
        body.status ?? current.status,
        body.rating !== undefined ? body.rating : current.rating,
        body.favorite ?? current.favorite,
        body.notes !== undefined ? body.notes : current.notes,
        started,
        finished,
      ],
    );
    return { item: row };
  });

  app.delete('/api/media/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const rows = await query(
      'DELETE FROM media_items WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, request.user.id],
    );
    if (!rows.length) throw notFound('Item not found.');
    return { ok: true };
  });

  // The AI critic — gently roasts the backlog (Hoard's signature move).
  app.post('/api/media/critic', async (request) => {
    const body = z.object({ domain: zDomain.optional() }).parse(request.body ?? {});
    const params: unknown[] = [request.user.id];
    let domainFilter = '';
    if (body.domain) {
      params.push(body.domain);
      domainFilter = `AND domain = $${params.length}`;
    }
    const stats = await query<{ domain: string; status: string; n: string }>(
      `SELECT domain, status, count(*)::text AS n FROM media_items
       WHERE user_id = $1 ${domainFilter} GROUP BY domain, status ORDER BY domain, status`,
      params,
    );
    const oldest = await query<{ title: string; domain: string; created_at: Date }>(
      `SELECT title, domain, created_at FROM media_items
       WHERE user_id = $1 ${domainFilter} AND status = 'PLANNED'
       ORDER BY created_at ASC LIMIT 5`,
      params,
    );
    if (!stats.length) return { critique: 'Your backlog is empty. Suspiciously virtuous.' };

    const planned = stats.filter((s) => s.status === 'PLANNED').reduce((a, s) => a + Number(s.n), 0);
    const done = stats.filter((s) => s.status === 'COMPLETED').reduce((a, s) => a + Number(s.n), 0);

    if (!isGeminiConfigured()) {
      const eldest = oldest[0];
      return {
        critique:
          `${planned} planned vs ${done} completed. ` +
          (eldest
            ? `"${eldest.title}" has been waiting since ${new Date(eldest.created_at).toISOString().slice(0, 10)}. It has seen things.`
            : 'Balance, of a sort.'),
      };
    }

    try {
      const critique = await generateText({
        system:
          'You are the in-house critic of a personal media backlog app. Write a short, wry, ' +
          'affectionate roast of the user\'s backlog (3-5 sentences, second person). End with ' +
          'ONE concrete recommendation of what to start next from their planned items. No lists, no markdown headers.',
        user: `Backlog stats (domain/status/count): ${JSON.stringify(stats)}. Longest-waiting planned items: ${JSON.stringify(
          oldest.map((o) => ({ title: o.title, domain: o.domain, added: new Date(o.created_at).toISOString().slice(0, 10) })),
        )}.`,
        temperature: 0.9,
        maxOutputTokens: 512,
      });
      return { critique };
    } catch {
      return {
        critique: `${planned} planned vs ${done} completed. The critic is speechless (or offline).`,
      };
    }
  });
}

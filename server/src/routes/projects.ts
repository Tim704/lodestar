// Projects module (CONTRACT §4.12, integration #9) — the vibe-coded project
// manager: ideas → active → shipped, tasks per project, confirmable
// AI/heuristic "next steps". updated_at is the "last touched" signal.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Project, ProjectSuggestion } from '@lodestar/shared';
import { query, queryOne } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { enrichTitles } from '../lib/enrich.js';
import { generateJson, isGeminiConfigured } from '../lib/gemini.js';
import { rowToTask, type TaskRow } from './tasks.js';

const idParams = z.object({ id: z.string().uuid() });

const projectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  blurb: z.string().trim().max(1000).nullish(),
  status: z.enum(['idea', 'active', 'paused', 'shipped', 'shelved']).default('idea'),
  next_action: z.string().trim().max(200).nullish(),
  repo_url: z.string().trim().max(300).nullish(), // free text (§3) — UI adds https://
  live_url: z.string().trim().max(300).nullish(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  tags: z.array(z.string().trim().min(1).max(24)).max(12).optional(),
  pinned: z.boolean().optional(),
  sort: z.number().int().optional(),
});

const LIST_SQL = `
  SELECT p.*,
         (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id AND NOT t.is_completed)
           AS open_tasks
  FROM projects p`;

async function getProject(id: string, userId: string): Promise<Project | null> {
  return queryOne<Project>(`${LIST_SQL} WHERE p.id = $1 AND p.user_id = $2`, [id, userId]);
}

/** §4.12 heuristic next steps — skip titles already open on the project. */
export function heuristicProjectSteps(
  name: string,
  nextAction: string | null,
  openTitles: string[],
): ProjectSuggestion[] {
  const candidates: ProjectSuggestion[] = [];
  if (nextAction?.trim()) {
    candidates.push({ title: nextAction.trim(), reason: 'your stated next action' });
  }
  candidates.push(
    {
      title: `Write a one-page spec for ${name} — scope, non-goals, first slice`,
      reason: 'clarity before code',
    },
    {
      title: `Set up the ${name} repo — scaffold, README, deploy notes`,
      reason: 'make it real',
    },
    {
      title: `Build the smallest end-to-end slice of ${name} and show it to someone`,
      reason: 'momentum beats polish',
    },
  );
  const open = new Set(openTitles.map((t) => t.toLowerCase()));
  return candidates.filter((c) => !open.has(c.title.toLowerCase())).slice(0, 3);
}

const SUGGEST_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    suggestions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { title: { type: 'STRING' }, reason: { type: 'STRING' } },
        required: ['title'],
      },
    },
  },
  required: ['suggestions'],
};

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/api/projects', async (request) => {
    const rows = await query<Project>(
      `${LIST_SQL}
       WHERE p.user_id = $1
       ORDER BY p.pinned DESC,
                CASE p.status WHEN 'active' THEN 0 WHEN 'idea' THEN 1 WHEN 'paused' THEN 2
                              WHEN 'shipped' THEN 3 ELSE 4 END,
                p.sort, p.created_at DESC`,
      [request.user.id],
    );
    return { projects: rows };
  });

  app.post('/api/projects', async (request, reply) => {
    const body = projectSchema.parse(request.body);
    const row = await queryOne<{ id: string }>(
      `INSERT INTO projects (user_id, name, blurb, status, next_action, repo_url, live_url,
                             color, tags, pinned, sort)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               COALESCE($11, (SELECT COALESCE(MAX(sort), 0) + 1 FROM projects WHERE user_id = $1)))
       RETURNING id`,
      [
        request.user.id,
        body.name,
        body.blurb ?? null,
        body.status,
        body.next_action ?? null,
        body.repo_url ?? null,
        body.live_url ?? null,
        body.color ?? null,
        body.tags ?? [],
        body.pinned ?? false,
        body.sort ?? null,
      ],
    );
    return reply.code(201).send({ project: await getProject(row!.id, request.user.id) });
  });

  app.patch('/api/projects/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = projectSchema.partial().parse(request.body);
    const current = await getProject(id, request.user.id);
    if (!current) throw notFound('Project not found.');

    await query(
      `UPDATE projects
       SET name = $3, blurb = $4, status = $5, next_action = $6, repo_url = $7, live_url = $8,
           color = $9, tags = $10, pinned = $11, sort = $12, updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [
        id,
        request.user.id,
        body.name ?? current.name,
        body.blurb !== undefined ? body.blurb : current.blurb,
        body.status ?? current.status,
        body.next_action !== undefined ? body.next_action : current.next_action,
        body.repo_url !== undefined ? body.repo_url : current.repo_url,
        body.live_url !== undefined ? body.live_url : current.live_url,
        body.color !== undefined ? body.color : current.color,
        body.tags ?? current.tags,
        body.pinned ?? current.pinned,
        body.sort ?? current.sort,
      ],
    );
    return { project: await getProject(id, request.user.id) };
  });

  app.delete('/api/projects/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const rows = await query('DELETE FROM projects WHERE id = $1 AND user_id = $2 RETURNING id', [
      id,
      request.user.id,
    ]);
    if (!rows.length) throw notFound('Project not found.');
    return { ok: true };
  });

  app.get('/api/projects/:id/tasks', async (request) => {
    const { id } = idParams.parse(request.params);
    const project = await getProject(id, request.user.id);
    if (!project) throw notFound('Project not found.');
    const rows = await query<TaskRow>(
      `SELECT * FROM tasks WHERE user_id = $1 AND project_id = $2
       ORDER BY is_completed, created_at DESC LIMIT 60`,
      [request.user.id, id],
    );
    return { tasks: rows.map(rowToTask) };
  });

  // inline add — enriched, source='project', bumps last-touched
  app.post('/api/projects/:id/tasks', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = z
      .object({
        title: z.string().trim().min(1).max(300),
        due_at: z.string().datetime({ offset: true }).nullish(),
      })
      .parse(request.body);
    const project = await getProject(id, request.user.id);
    if (!project) throw notFound('Project not found.');

    const e = (await enrichTitles([body.title]))[0]!;
    const row = await queryOne<TaskRow>(
      `INSERT INTO tasks (user_id, title, importance, cognitive_load, duration_min, reasoning,
                          enrichment_source, due_at, source, source_ref, project_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'project', $9::text, $10::uuid)
       RETURNING *`,
      [
        request.user.id,
        body.title,
        e.importance,
        e.cognitive_load,
        e.duration_min,
        e.reasoning,
        e.source,
        body.due_at ?? null,
        id,
        id,
      ],
    );
    await query('UPDATE projects SET updated_at = now() WHERE id = $1', [id]);
    return reply.code(201).send({ task: rowToTask(row!) });
  });

  // §4.12 — suggest next steps (assistant pattern: propose, user confirms)
  app.post('/api/projects/:id/suggest', async (request) => {
    const { id } = idParams.parse(request.params);
    const project = await getProject(id, request.user.id);
    if (!project) throw notFound('Project not found.');
    const open = await query<{ title: string }>(
      `SELECT title FROM tasks WHERE project_id = $1 AND NOT is_completed LIMIT 20`,
      [id],
    );
    const openTitles = open.map((t) => t.title);
    const fallback = heuristicProjectSteps(project.name, project.next_action, openTitles);

    if (!isGeminiConfigured()) return { suggestions: fallback, generator: 'heuristic' };
    try {
      const raw = await generateJson({
        system:
          'You help a student pick the next concrete steps for a personal coding/side project. ' +
          'Given the project name, blurb, stated next action, and its currently-open tasks, ' +
          'propose AT MOST 3 new, small, concrete tasks (each doable in one sitting) that move ' +
          'the project forward. Never repeat an open task. Return ONLY JSON {"suggestions": ' +
          '[{"title": "...", "reason": "..."}]}.',
        user: JSON.stringify({
          name: project.name,
          blurb: project.blurb,
          status: project.status,
          next_action: project.next_action,
          open_tasks: openTitles,
        }),
        responseSchema: SUGGEST_RESPONSE_SCHEMA,
        temperature: 0.6,
      });
      const arr =
        raw && typeof raw === 'object' && Array.isArray((raw as { suggestions?: unknown }).suggestions)
          ? ((raw as { suggestions: unknown[] }).suggestions)
          : [];
      const entry = z.object({ title: z.string().trim().min(1).max(200), reason: z.string().trim().max(200).nullish() });
      const openSet = new Set(openTitles.map((t) => t.toLowerCase()));
      const suggestions: ProjectSuggestion[] = [];
      for (const a of arr) {
        const p = entry.safeParse(a);
        if (!p.success || openSet.has(p.data.title.toLowerCase())) continue;
        suggestions.push({ title: p.data.title, reason: p.data.reason ?? null });
        if (suggestions.length >= 3) break;
      }
      if (!suggestions.length) return { suggestions: fallback, generator: 'heuristic' };
      return { suggestions, generator: 'gemini' };
    } catch (err) {
      console.warn('[projects] suggest via Gemini failed:', (err as Error).message);
      return { suggestions: fallback, generator: 'heuristic' };
    }
  });

  app.post('/api/projects/:id/suggest/confirm', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = z
      .object({ titles: z.array(z.string().trim().min(1).max(200)).min(1).max(5) })
      .parse(request.body);
    const project = await getProject(id, request.user.id);
    if (!project) throw notFound('Project not found.');

    const enrichments = await enrichTitles(body.titles);
    const created: TaskRow[] = [];
    for (let i = 0; i < body.titles.length; i++) {
      const e = enrichments[i]!;
      const row = await queryOne<TaskRow>(
        `INSERT INTO tasks (user_id, title, importance, cognitive_load, duration_min, reasoning,
                            enrichment_source, source, source_ref, project_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'project', $8::text, $9::uuid)
         RETURNING *`,
        [
          request.user.id,
          body.titles[i]!,
          e.importance,
          e.cognitive_load,
          e.duration_min,
          e.reasoning,
          e.source,
          id,
          id,
        ],
      );
      created.push(row!);
    }
    await query('UPDATE projects SET updated_at = now() WHERE id = $1', [id]);
    return reply.code(201).send({ tasks: created.map(rowToTask) });
  });
}

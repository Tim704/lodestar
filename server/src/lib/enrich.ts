// Task enrichment — Gemini scores each title for importance / cognitive load /
// duration (CONTRACT §4.2). Merges the prompts of dynamic-todo and dynamicTo-Do;
// falls back to keyword heuristics so the app works keyless.

import { z } from 'zod';
import type { EnrichmentSource } from '@lodestar/shared';
import { generateJson, isGeminiConfigured } from './gemini.js';

export interface Enrichment {
  importance: number; // 1–10
  cognitive_load: number; // 1–5
  duration_min: number; // 1–1440
  reasoning: string | null;
  source: EnrichmentSource;
}

const SYSTEM_PROMPT = [
  'You are the task enrichment engine for a personal productivity app used by a student.',
  'You will receive a JSON array of task titles, each with an "index".',
  'For EVERY entry return an object with exactly these keys:',
  '{"index": <same integer>, "importance": <1-10>, "cognitiveLoad": <1-5>, "durationMin": <positive integer minutes>, "reasoning": "<one short sentence, under 120 characters>"}',
  'importance: 1 (whenever) to 10 (critical or blocking other things).',
  'cognitiveLoad: 1 (mindless) to 5 (deep focus required).',
  'durationMin: realistic minutes to complete, based only on the title.',
  'Assign STEM and academic tasks (linear algebra, coding, calculus, proofs, debugging, exam prep) high importance (8-10) and high cognitive load (4-5) unless the wording clearly implies otherwise.',
  'Assign domestic tasks (laundry, dishes, cleaning, groceries) low cognitive load (1-2) and lower importance unless explicit urgency is stated.',
  'Respond with ONLY a JSON array covering every input index exactly once.',
].join(' ');

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      index: { type: 'INTEGER' },
      importance: { type: 'INTEGER' },
      cognitiveLoad: { type: 'INTEGER' },
      durationMin: { type: 'INTEGER' },
      reasoning: { type: 'STRING' },
    },
    required: ['index', 'importance', 'cognitiveLoad', 'durationMin', 'reasoning'],
  },
};

const entrySchema = z.object({
  index: z.number().int(),
  importance: z.number(),
  cognitiveLoad: z.number(),
  durationMin: z.number(),
  reasoning: z.string().optional(),
});

const clampInt = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(v)));

const ACADEMIC = ['exam', 'klausur', 'prüfung', 'assignment', 'proof', 'project', 'abgabe', 'study', 'lernen', 'essay', 'thesis', 'debug', 'code'];
const DOMESTIC = ['laundry', 'dishes', 'clean', 'groceries', 'wäsche', 'putzen', 'einkaufen', 'trash', 'müll', 'vacuum'];

/** CONTRACT §4.2 fallback: academic → {8,4,90}, domestic → {3,1,30}, else {5,3,45}. */
export function heuristicEnrich(title: string): Enrichment {
  const t = title.toLowerCase();
  if (ACADEMIC.some((k) => t.includes(k))) {
    return { importance: 8, cognitive_load: 4, duration_min: 90, reasoning: null, source: 'heuristic' };
  }
  if (DOMESTIC.some((k) => t.includes(k))) {
    return { importance: 3, cognitive_load: 1, duration_min: 30, reasoning: null, source: 'heuristic' };
  }
  return { importance: 5, cognitive_load: 3, duration_min: 45, reasoning: null, source: 'heuristic' };
}

/**
 * Enrich a batch of titles. Gemini when configured (one call for the whole
 * batch); the model never gets to drop or invent entries — anything missing
 * from its reply falls back to the heuristic (reconcile-by-index, like
 * dynamic-todo's reconcile-by-id).
 */
export async function enrichTitles(titles: readonly string[]): Promise<Enrichment[]> {
  const fallback = titles.map((t) => heuristicEnrich(t));
  if (!isGeminiConfigured() || titles.length === 0) return fallback;

  try {
    const raw = await generateJson({
      system: SYSTEM_PROMPT,
      user: `Tasks:\n${JSON.stringify(titles.map((title, index) => ({ index, title })), null, 2)}`,
      responseSchema: RESPONSE_SCHEMA,
    });
    const arr = Array.isArray(raw) ? raw : [];
    const byIndex = new Map<number, z.infer<typeof entrySchema>>();
    for (const entry of arr) {
      const parsed = entrySchema.safeParse(entry);
      if (parsed.success) byIndex.set(parsed.data.index, parsed.data);
    }
    return titles.map((_, i) => {
      const e = byIndex.get(i);
      if (!e) return fallback[i]!;
      return {
        importance: clampInt(e.importance, 1, 10),
        cognitive_load: clampInt(e.cognitiveLoad, 1, 5),
        duration_min: clampInt(e.durationMin, 1, 1440),
        reasoning: e.reasoning ? e.reasoning.trim().slice(0, 240) : null,
        source: 'gemini',
      };
    });
  } catch (err) {
    console.warn('[enrich] Gemini failed, using heuristics:', (err as Error).message);
    return fallback;
  }
}

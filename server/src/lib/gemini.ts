// Gemini REST client — ported from dynamic-todo backend/llm.js (CONTRACT §4.2).
// Key travels in the x-goog-api-key header only; structured output via
// responseMimeType + responseSchema; robust parsing with one sterner retry.
// Every caller zod-validates the result and has a heuristic fallback, so the
// whole app works with GEMINI_API_KEY unset.

import { config } from '../config.js';

export class ConfigError extends Error {}
export class LlmHttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export class LlmTimeoutError extends Error {}
export class LlmParseError extends Error {
  constructor(
    message: string,
    public raw: string,
  ) {
    super(message);
  }
}

const RETRY_NUDGE =
  'CRITICAL: your previous reply was not parseable JSON. Respond with ONLY the raw JSON — no code fences, no explanation, no thinking out loud.';

export function isGeminiConfigured(): boolean {
  return Boolean(config.gemini.apiKey);
}

interface GenerateArgs {
  system: string;
  user: string;
  /** Gemini responseSchema (their OpenAPI-flavoured type names: OBJECT/ARRAY/…). */
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
}

async function callOnce(args: GenerateArgs, retry: boolean): Promise<string> {
  const g = config.gemini;
  const url = `${g.base}/v1beta/models/${g.model}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: retry ? `${args.system}\n\n${RETRY_NUDGE}` : args.system }] },
    contents: [{ role: 'user', parts: [{ text: args.user }] }],
    generationConfig: {
      temperature: args.temperature ?? 0.2,
      responseMimeType: 'application/json',
      ...(args.responseSchema ? { responseSchema: args.responseSchema } : {}),
      maxOutputTokens: args.maxOutputTokens ?? 8192,
    },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': g.apiKey, // header, not URL — stays out of request logs
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(g.timeoutMs),
    });
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw new LlmTimeoutError(`Gemini took longer than ${g.timeoutMs}ms to answer`);
    }
    throw new LlmHttpError(
      `could not reach the Gemini API — network down? (${e.cause?.code ?? e.message})`,
      502,
    );
  }

  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    const msg = detail?.error?.message ?? '';
    throw new LlmHttpError(
      `Gemini answered ${res.status}${msg ? `: ${msg}` : ''}`,
      res.status === 429 ? 429 : 502,
    );
  }

  const data = (await res.json().catch(() => {
    throw new LlmParseError('Gemini returned a non-JSON HTTP response', '');
  })) as {
    promptFeedback?: { blockReason?: string };
    candidates?: Array<{
      finishReason?: string;
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const block = data.promptFeedback?.blockReason;
  if (block) throw new LlmHttpError(`Gemini blocked the request (${block})`, 502);

  const finish = data.candidates?.[0]?.finishReason;
  if (finish && finish !== 'STOP') {
    throw new LlmHttpError(
      finish === 'MAX_TOKENS'
        ? 'Gemini hit its output-token cap before finishing'
        : `Gemini stopped early (${finish})`,
      502,
    );
  }

  const parts = data.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('')
    : '';
  if (!text.length) {
    throw new LlmParseError(
      'Gemini returned an empty or unrecognized response',
      JSON.stringify(data).slice(0, 500),
    );
  }
  return text;
}

/** The LLM was told "no markdown, no commentary" — assume it ignored us anyway. */
export function parseLooseJson(raw: string): unknown {
  let text = String(raw).trim();
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1] !== undefined) text = fence[1].trim();

  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };

  let parsed = tryParse(text);
  if (parsed === undefined) {
    // commentary around the payload — take first bracket to last bracket
    for (const [open, close] of [
      ['{', '}'],
      ['[', ']'],
    ] as const) {
      const start = text.indexOf(open);
      const end = text.lastIndexOf(close);
      if (start !== -1 && end > start) {
        parsed = tryParse(text.slice(start, end + 1));
        if (parsed !== undefined) break;
      }
    }
  }
  if (parsed === undefined) throw new LlmParseError('LLM returned invalid JSON', raw);
  return parsed;
}

/**
 * Structured JSON out of Gemini, or throw. One retry with a sterner system
 * prompt if the first reply doesn't parse.
 */
export async function generateJson(args: GenerateArgs): Promise<unknown> {
  if (!isGeminiConfigured()) {
    throw new ConfigError(
      'GEMINI_API_KEY is not set — get one at https://aistudio.google.com/apikey',
    );
  }
  try {
    return parseLooseJson(await callOnce(args, false));
  } catch (err) {
    if (!(err instanceof LlmParseError)) throw err;
    console.warn('[gemini] first response unparseable, retrying once:', err.message);
  }
  return parseLooseJson(await callOnce(args, true));
}

/** Plain-text generation (briefings, reviews, roasts) — same transport. */
export async function generateText(args: Omit<GenerateArgs, 'responseSchema'>): Promise<string> {
  if (!isGeminiConfigured()) {
    throw new ConfigError('GEMINI_API_KEY is not set');
  }
  const g = config.gemini;
  const url = `${g.base}/v1beta/models/${g.model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': g.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: args.system }] },
      contents: [{ role: 'user', parts: [{ text: args.user }] }],
      generationConfig: {
        temperature: args.temperature ?? 0.7,
        maxOutputTokens: args.maxOutputTokens ?? 2048,
      },
    }),
    signal: AbortSignal.timeout(g.timeoutMs),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new LlmHttpError(
      `Gemini answered ${res.status}${detail?.error?.message ? `: ${detail.error.message}` : ''}`,
      res.status === 429 ? 429 : 502,
    );
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = data.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('')
    : '';
  if (!text) throw new LlmParseError('Gemini returned an empty response', '');
  return text.trim();
}

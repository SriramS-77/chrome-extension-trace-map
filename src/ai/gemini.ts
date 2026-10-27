import type { FocusStats } from '../shared/types';
import { buildGeminiPrompt, SUMMARY_SYSTEM_INSTRUCTION } from './prompt';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_ATTEMPTS = 4;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export interface GeminiRequest {
  apiKey: string;
  model: string;
  title: string;
  url: string;
  text: string;
  focus?: FocusStats;
  signal?: AbortSignal;
}

export interface GeminiResult {
  summary: string;
  focus: string;
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

/** Models occasionally wrap JSON in prose or a code fence; recover the object. */
export function parseGeminiJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeResult(value: unknown): GeminiResult | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.summary !== 'string' || !record.summary.trim()) return null;
  const focus = typeof record.focus === 'string' ? record.focus : '';
  return { summary: record.summary.trim(), focus: focus.trim() };
}

function backoffMs(attempt: number): number {
  // Smaller open models such as Gemma 4 31B answer roughly one request in
  // three while busy; exponential backoff rides that out.
  return Math.min(8_000, 1_000 * 2 ** (attempt - 1)) + Math.random() * 400;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Gemini fallback. One request returns both the page summary and the focus
 * line; no temperature/sampling fields and a single user turn, as required by
 * the current Flash-Lite API rules. Transient 429/5xx responses are retried,
 * because smaller models such as Gemma 4 31B are frequently busy.
 */
export async function summarizeWithGemini(request: GeminiRequest): Promise<GeminiResult> {
  const body = {
    systemInstruction: { parts: [{ text: SUMMARY_SYSTEM_INSTRUCTION }] },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: buildGeminiPrompt({
              title: request.title,
              url: request.url,
              text: request.text,
              focus: request.focus,
            }),
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: 'minimal' },
    },
  };

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(
        `${ENDPOINT}/${encodeURIComponent(request.model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': request.apiKey,
          },
          body: JSON.stringify(body),
          signal: request.signal,
        },
      );

      const payload = (await response.json().catch(() => ({}))) as GeminiResponse;
      if (!response.ok) {
        const detail = payload.error?.message ?? `HTTP ${response.status}`;
        if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
          lastError = new Error(`Gemini is busy (${detail}).`);
          await sleep(backoffMs(attempt), request.signal);
          continue;
        }
        throw new Error(`Gemini request failed: ${detail}.`);
      }
      if (payload.promptFeedback?.blockReason) {
        throw new Error(`Gemini blocked the request: ${payload.promptFeedback.blockReason}.`);
      }

      const text =
        payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
      if (!text.trim()) throw new Error('Gemini returned an empty response.');
      const result = normalizeResult(parseGeminiJson(text));
      if (!result) {
        throw new Error(
          'The model did not return the summary JSON. Try again, or pick a Gemini Flash-Lite model.',
        );
      }
      return result;
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      if (request.signal?.aborted) throw cause;
      lastError = cause;
      if (attempt >= MAX_ATTEMPTS) break;
      await sleep(backoffMs(attempt), request.signal);
    }
  }
  const detail = lastError?.message ?? 'no response from the provider';
  throw new Error(
    `${request.model} could not summarize this page (${detail.replace(/\.$/, '')}). ` +
      'Retry, or switch to a Gemini Flash-Lite model in Settings.',
  );
}

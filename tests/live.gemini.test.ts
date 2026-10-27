import { describe, expect, it } from 'vitest';
import { parseGeminiJson, summarizeWithGemini } from '../src/ai/gemini';

/**
 * Live provider check. Skipped unless GEMINI_API_KEY is set:
 *   GEMINI_API_KEY=… GEMINI_MODEL=gemma-4-31b-it pnpm test
 * The key is read from the environment only and never stored in the repo.
 */
const apiKey = process.env.GEMINI_API_KEY ?? '';
const model = process.env.GEMINI_MODEL ?? 'gemma-4-31b-it';

describe('parseGeminiJson', () => {
  it('reads plain JSON', () => {
    expect(parseGeminiJson('{"summary":"a","focus":"b"}')).toEqual({ summary: 'a', focus: 'b' });
  });

  it('unwraps a fenced block', () => {
    expect(parseGeminiJson('```json\n{"summary":"a","focus":"b"}\n```')).toEqual({
      summary: 'a',
      focus: 'b',
    });
  });

  it('recovers an object surrounded by prose', () => {
    expect(parseGeminiJson('Here you go: {"summary":"a","focus":"b"} — done')).toEqual({
      summary: 'a',
      focus: 'b',
    });
  });

  it('returns null for prose without JSON', () => {
    expect(parseGeminiJson('no json here')).toBeNull();
  });
});

describe.skipIf(!apiKey)('Gemini live', () => {
  it(
    `summarizes a page with ${model}`,
    async () => {
      const result = await summarizeWithGemini({
        apiKey,
        model,
        title: 'Retrieval-augmented generation',
        url: 'https://example.com/rag',
        text: [
          'Retrieval-augmented generation (RAG) combines a language model with a search step.',
          'The retriever finds passages from a corpus, and the model grounds its answer in them.',
          'Teams adopt RAG to keep answers current without retraining the model.',
        ].join(' '),
        focus: {
          dwellMs: 120_000,
          activeMs: 95_000,
          maxScrollPct: 68,
          topBlocks: [{ text: 'Retrieval-augmented generation (RAG)', ms: 40_000 }],
          selections: [{ text: 'grounds its answer in them', ts: 1 }],
          clicks: [{ text: 'Docs', href: 'https://example.com/docs', ts: 2 }],
          capturedAt: Date.now(),
        },
      });
      expect(result.summary.length).toBeGreaterThan(20);
      expect(result.focus.length).toBeGreaterThan(5);
    },
    180_000,
  );
});

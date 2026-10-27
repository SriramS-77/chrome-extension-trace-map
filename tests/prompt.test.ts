import { describe, expect, it } from 'vitest';
import {
  buildChromeFocusInput,
  buildChromeSummaryInput,
  buildGeminiPrompt,
  buildSessionSummaryPrompt,
  formatFocusData,
  SUMMARY_SYSTEM_INSTRUCTION,
  truncateToTokens,
} from '../src/ai/prompt';
import type { FocusStats } from '../src/shared/types';

const focus: FocusStats = {
  dwellMs: 120_000,
  activeMs: 90_000,
  maxScrollPct: 73,
  topBlocks: [{ text: 'Retrieval augmented generation', ms: 30_000 }],
  selections: [{ text: 'the model grounds answers in sources', ts: 1 }],
  clicks: [{ text: 'Pricing', href: 'https://example.com/pricing', ts: 2 }],
  capturedAt: 3,
};

describe('formatFocusData', () => {
  it('reports the absence of signals instead of inventing them', () => {
    expect(formatFocusData(undefined)).toBe('none recorded');
  });

  it('includes time, scroll, passages, selections and clicks', () => {
    const text = formatFocusData(focus);
    expect(text).toContain('time on page 2 min, scrolled 73%');
    expect(text).toContain('Retrieval augmented generation');
    expect(text).toContain('the model grounds answers in sources');
    expect(text).toContain('Pricing');
  });
});

describe('buildGeminiPrompt', () => {
  it('contains the page, text and focus block', () => {
    const prompt = buildGeminiPrompt({
      title: 'RAG',
      url: 'https://example.com/rag',
      text: 'Body text',
      focus,
    });
    expect(prompt).toContain('PAGE: RAG (https://example.com/rag)');
    expect(prompt).toContain('TEXT: Body text');
    expect(prompt).toContain('FOCUS DATA:');
  });

  it('truncates long text to about 8000 tokens', () => {
    const prompt = buildGeminiPrompt({
      title: 'Long',
      url: 'https://example.com',
      text: 'a'.repeat(60_000),
    });
    expect(prompt.length).toBeLessThan(40_000);
    expect(prompt).toContain('…');
  });

  it('keeps the system instruction free of sampling advice', () => {
    expect(SUMMARY_SYSTEM_INSTRUCTION).toContain('Return JSON with two fields');
    expect(SUMMARY_SYSTEM_INSTRUCTION.toLowerCase()).not.toContain('temperature');
  });
});

describe('chrome inputs', () => {
  it('keeps the title and URL as context and truncates the body', () => {
    const input = buildChromeSummaryInput({
      title: 'Title',
      url: 'https://example.com',
      text: 'x'.repeat(30_000),
    });
    expect(input.startsWith('Title: Title')).toBe(true);
    expect(input.length).toBeLessThan(13_000);
  });

  it('returns an empty focus input when nothing was recorded', () => {
    expect(
      buildChromeFocusInput({ title: 'T', url: 'https://example.com', text: 'x' }),
    ).toBe('');
  });

  it('describes the passages the reader actually read', () => {
    const input = buildChromeFocusInput({
      title: 'T',
      url: 'https://example.com',
      text: 'x',
      focus,
    });
    expect(input).toContain('Passages read most');
    expect(input).toContain('Retrieval augmented generation');
    expect(input).toContain('Use only this data');
  });
});

describe('session summary prompt', () => {
  it('lists pages in tree order with their summaries', () => {
    const prompt = buildSessionSummaryPrompt(
      { id: 's1', title: 'Research', startedAt: 1 },
      [
        { title: 'A', url: 'https://a.test', summary: 'Alpha' },
        { title: 'B', url: 'https://b.test', summary: 'Beta' },
      ],
    );
    expect(prompt).toContain('Session: Research');
    expect(prompt.indexOf('A (https://a.test)')).toBeLessThan(prompt.indexOf('B (https://b.test)'));
    expect(prompt).toContain('how the reading branched');
  });
});

describe('truncateToTokens', () => {
  it('leaves short text alone and trims long text', () => {
    expect(truncateToTokens('short', 10)).toBe('short');
    expect(truncateToTokens('a'.repeat(100), 10)).toHaveLength(41);
  });
});

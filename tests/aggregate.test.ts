import { describe, expect, it } from 'vitest';
import {
  isTypingTarget,
  MAX_BLOCKS,
  MAX_CLICKS,
  MAX_SELECTIONS,
  mergeFocus,
  scrollPercent,
  truncate,
} from '../src/focus/aggregate';
import type { FocusBatch, FocusStats } from '../src/shared/types';

function batch(overrides: Partial<FocusBatch> = {}): FocusBatch {
  return {
    dwellMs: 1_000,
    activeMs: 1_000,
    maxScrollPct: 20,
    blocks: [],
    selections: [],
    clicks: [],
    capturedAt: 10_000,
    ...overrides,
  };
}

describe('mergeFocus', () => {
  it('creates stats from the first batch', () => {
    const merged = mergeFocus(undefined, batch({ activeMs: 5_000, maxScrollPct: 42 }));
    expect(merged.activeMs).toBe(5_000);
    expect(merged.dwellMs).toBe(1_000);
    expect(merged.maxScrollPct).toBe(42);
  });

  it('adds active time and keeps the deepest scroll', () => {
    const base: FocusStats = {
      dwellMs: 2_000,
      activeMs: 3_000,
      maxScrollPct: 80,
      topBlocks: [],
      selections: [],
      clicks: [],
      capturedAt: 1,
    };
    const merged = mergeFocus(base, batch({ dwellMs: 500, activeMs: 400, maxScrollPct: 30 }));
    expect(merged.dwellMs).toBe(2_500);
    expect(merged.activeMs).toBe(3_400);
    expect(merged.maxScrollPct).toBe(80);
  });

  it('keeps the five longest-read blocks, summed by text', () => {
    const base: FocusStats = {
      dwellMs: 0,
      activeMs: 0,
      maxScrollPct: 0,
      topBlocks: [{ text: 'shared', ms: 500 }],
      selections: [],
      clicks: [],
      capturedAt: 1,
    };
    const incoming = Array.from({ length: 8 }, (_, index) => ({
      text: index === 0 ? 'shared' : `block ${index}`,
      ms: index * 100,
    }));
    const merged = mergeFocus(base, batch({ blocks: incoming }));
    expect(merged.topBlocks).toHaveLength(MAX_BLOCKS);
    expect(merged.topBlocks.find((block) => block.text === 'shared')?.ms).toBe(500);
    const times = merged.topBlocks.map((block) => block.ms);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('caps selections at ten and drops short ones', () => {
    const selections = Array.from({ length: 14 }, (_, index) => ({
      text: `selection number ${index}`,
      ts: index,
    }));
    const merged = mergeFocus(undefined, batch({ selections }));
    expect(merged.selections).toHaveLength(MAX_SELECTIONS);
    expect(merged.selections[0]?.text).toBe('selection number 4');
    expect(mergeFocus(undefined, batch({ selections: [{ text: 'short', ts: 1 }] })).selections).toEqual(
      [],
    );
  });

  it('caps clicks at twenty and keeps the latest', () => {
    const clicks = Array.from({ length: 30 }, (_, index) => ({
      text: `link ${index}`,
      ts: index,
    }));
    const merged = mergeFocus(undefined, batch({ clicks }));
    expect(merged.clicks).toHaveLength(MAX_CLICKS);
    expect(merged.clicks.at(-1)?.text).toBe('link 29');
  });

  it('truncates long block text', () => {
    const merged = mergeFocus(
      undefined,
      batch({ blocks: [{ text: 'x'.repeat(500), ms: 10 }] }),
    );
    expect(merged.topBlocks[0]?.text.length).toBeLessThanOrEqual(301);
  });
});

describe('scrollPercent', () => {
  it('is 100 when the page does not scroll', () => {
    expect(scrollPercent(0, 800, 800)).toBe(100);
  });
  it('is proportional otherwise', () => {
    expect(scrollPercent(450, 800, 1700)).toBe(50);
    expect(scrollPercent(9999, 800, 1700)).toBe(100);
  });
});

describe('isTypingTarget', () => {
  it.each([
    { tagName: 'INPUT' },
    { tagName: 'TEXTAREA' },
    { tagName: 'SELECT' },
    { tagName: 'DIV', isContentEditable: true },
    { tagName: 'INPUT', type: 'password' },
  ])('ignores form fields %o', (target) => {
    expect(isTypingTarget(target)).toBe(true);
  });

  it('allows normal content', () => {
    expect(isTypingTarget({ tagName: 'P' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('truncate', () => {
  it('collapses whitespace and clips long text', () => {
    expect(truncate('  a\n\n b  ', 10)).toBe('a b');
    expect(truncate('abcdefghij', 5)).toBe('abcde…');
  });
});

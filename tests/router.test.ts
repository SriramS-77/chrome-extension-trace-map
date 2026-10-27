import { describe, expect, it } from 'vitest';
import { routeSummarizer } from '../src/ai/router';
import type { SummarizerAvailability } from '../src/ai/router';

const states: SummarizerAvailability[] = [
  'available',
  'downloadable',
  'downloading',
  'unavailable',
];

describe('routeSummarizer — auto', () => {
  it('prefers the on-device model when available', () => {
    expect(routeSummarizer('auto', 'available', false)).toEqual({
      kind: 'provider',
      provider: 'chrome-builtin',
    });
  });

  it('offers the download while the model is not ready and no key is saved', () => {
    expect(routeSummarizer('auto', 'downloadable', false)).toEqual({ kind: 'needs-download' });
    expect(routeSummarizer('auto', 'downloading', false)).toEqual({ kind: 'needs-download' });
  });

  it('uses Gemini while downloading when a key is saved', () => {
    expect(routeSummarizer('auto', 'downloading', true)).toEqual({
      kind: 'provider',
      provider: 'gemini',
    });
  });

  it('falls back to Gemini when the on-device model is unavailable', () => {
    expect(routeSummarizer('auto', 'unavailable', true)).toEqual({
      kind: 'provider',
      provider: 'gemini',
    });
    expect(routeSummarizer('auto', 'unavailable', false)).toEqual({ kind: 'needs-setup' });
  });
});

describe('routeSummarizer — chrome only', () => {
  it('only uses the on-device model when available', () => {
    expect(routeSummarizer('chrome', 'available', false)).toEqual({
      kind: 'provider',
      provider: 'chrome-builtin',
    });
  });

  it('asks for a download when the model can be downloaded', () => {
    expect(routeSummarizer('chrome', 'downloadable', true)).toEqual({ kind: 'needs-download' });
  });

  it('falls back to Gemini when the model is unavailable', () => {
    expect(routeSummarizer('chrome', 'unavailable', true)).toEqual({
      kind: 'provider',
      provider: 'gemini',
    });
    expect(routeSummarizer('chrome', 'unavailable', false)).toEqual({ kind: 'needs-setup' });
  });
});

describe('routeSummarizer — gemini only', () => {
  it('requires a key for every availability state', () => {
    for (const state of states) {
      expect(routeSummarizer('gemini', state, true)).toEqual({
        kind: 'provider',
        provider: 'gemini',
      });
      expect(routeSummarizer('gemini', state, false)).toEqual({ kind: 'needs-setup' });
    }
  });
});

describe('routeSummarizer — never returns an undefined provider', () => {
  it('is total over the matrix', () => {
    for (const mode of ['auto', 'chrome', 'gemini'] as const) {
      for (const state of states) {
        for (const hasKey of [true, false]) {
          const decision = routeSummarizer(mode, state, hasKey);
          expect(['provider', 'needs-download', 'needs-setup']).toContain(decision.kind);
          if (decision.kind === 'provider') {
            expect(['chrome-builtin', 'gemini']).toContain(decision.provider);
          }
        }
      }
    }
  });
});

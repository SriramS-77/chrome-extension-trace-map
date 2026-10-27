import type { ProviderMode, SummaryProvider } from '../shared/types';

export type SummarizerAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

export type RouteDecision =
  | { kind: 'provider'; provider: SummaryProvider }
  | { kind: 'needs-download' }
  | { kind: 'needs-setup' };

/**
 * Choose a summarizer without touching browser APIs, so every availability
 * state is unit-testable.
 *
 * - Chrome built-in is preferred when it is ready.
 * - While its model downloads, Gemini is used only if a key is saved.
 * - Anything unavailable falls back to Gemini, then to a setup message.
 */
export function routeSummarizer(
  mode: ProviderMode,
  availability: SummarizerAvailability,
  hasGeminiKey: boolean,
): RouteDecision {
  if (mode === 'gemini') {
    return hasGeminiKey ? { kind: 'provider', provider: 'gemini' } : { kind: 'needs-setup' };
  }

  if (mode === 'chrome') {
    if (availability === 'available') return { kind: 'provider', provider: 'chrome-builtin' };
    if (availability === 'downloadable' || availability === 'downloading') {
      return { kind: 'needs-download' };
    }
    return hasGeminiKey ? { kind: 'provider', provider: 'gemini' } : { kind: 'needs-setup' };
  }

  // auto
  if (availability === 'available') return { kind: 'provider', provider: 'chrome-builtin' };
  if (availability === 'downloadable' || availability === 'downloading') {
    return hasGeminiKey ? { kind: 'provider', provider: 'gemini' } : { kind: 'needs-download' };
  }
  return hasGeminiKey ? { kind: 'provider', provider: 'gemini' } : { kind: 'needs-setup' };
}

export function providerLabel(provider: SummaryProvider): string {
  return provider === 'chrome-builtin' ? 'On-device' : 'Gemini';
}

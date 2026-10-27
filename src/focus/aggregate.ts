import type { FocusBatch, FocusBlock, FocusStats } from '../shared/types';

export const MAX_BLOCKS = 5;
export const MAX_SELECTIONS = 10;
export const MAX_CLICKS = 20;
export const BLOCK_TEXT_LIMIT = 300;
export const SELECTION_TEXT_LIMIT = 500;

export function emptyFocus(now: number): FocusStats {
  return {
    dwellMs: 0,
    activeMs: 0,
    maxScrollPct: 0,
    topBlocks: [],
    selections: [],
    clicks: [],
    capturedAt: now,
  };
}

export function truncate(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

function mergeBlocks(base: readonly FocusBlock[], incoming: readonly FocusBlock[]): FocusBlock[] {
  const byText = new Map<string, number>();
  for (const block of [...base, ...incoming]) {
    const text = truncate(block.text, BLOCK_TEXT_LIMIT);
    if (!text) continue;
    byText.set(text, (byText.get(text) ?? 0) + Math.max(0, block.ms));
  }
  return [...byText.entries()]
    .map(([text, ms]) => ({ text, ms }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, MAX_BLOCKS);
}

/** Merge a content-script batch into the stats already stored on a node. */
export function mergeFocus(base: FocusStats | undefined, batch: FocusBatch): FocusStats {
  const previous = base ?? emptyFocus(batch.capturedAt);
  const selections = [...previous.selections, ...batch.selections]
    .filter((item) => item.text.trim().length >= 8)
    .map((item) => ({ text: truncate(item.text, SELECTION_TEXT_LIMIT), ts: item.ts }))
    .sort((a, b) => a.ts - b.ts)
    .slice(-MAX_SELECTIONS);
  const clicks = [...previous.clicks, ...batch.clicks]
    .map((item) => ({ ...item, text: truncate(item.text, 200) }))
    .sort((a, b) => a.ts - b.ts)
    .slice(-MAX_CLICKS);

  return {
    dwellMs: Math.max(0, previous.dwellMs + batch.dwellMs),
    activeMs: Math.max(0, previous.activeMs + batch.activeMs),
    maxScrollPct: clampPercent(Math.max(previous.maxScrollPct, batch.maxScrollPct)),
    topBlocks: mergeBlocks(previous.topBlocks, batch.blocks),
    selections,
    clicks,
    capturedAt: Math.max(previous.capturedAt, batch.capturedAt),
  };
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Scroll depth as a percentage of the scrollable page. */
export function scrollPercent(
  scrollY: number,
  viewportHeight: number,
  documentHeight: number,
): number {
  const scrollable = documentHeight - viewportHeight;
  if (scrollable <= 0) return 100;
  return clampPercent((scrollY / scrollable) * 100);
}

export interface TypingTargetLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
}

/** Form fields and editable regions are never captured. */
export function isTypingTarget(target: TypingTargetLike | null | undefined): boolean {
  if (!target) return false;
  const tag = (target.tagName ?? '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable === true) return true;
  return target.type === 'password';
}

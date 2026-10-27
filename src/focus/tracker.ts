import type { FocusBatch, FocusBlock, FocusClick, FocusSelection } from '../shared/types';
import { isTypingTarget, scrollPercent, truncate } from './aggregate';

const TICK_MS = 1000;
const INTERACTION_WINDOW_MS = 30_000;
const FLUSH_MS = 15_000;
const BLOCK_LIMIT = 300;
const SELECTION_LIMIT = 500;
const SELECTION_MIN = 8;
const CLICK_LIMIT = 20;
const MAX_BLOCKS_TRACKED = 400;

/**
 * Turns raw browser events into a small FocusStats batch. Raw event streams are
 * never stored; only the merged summary leaves the page.
 */
export class FocusTracker {
  private dwellMs = 0;
  private activeMs = 0;
  private maxScrollPct = 0;
  private blocks = new Map<string, FocusBlock>();
  private selections: FocusSelection[] = [];
  private clicks: FocusClick[] = [];
  private intersecting = new Set<Element>();
  private lastInteractionAt = 0;
  private started = false;
  private tickTimer: ReturnType<typeof setInterval> | undefined;
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  private observer: IntersectionObserver | undefined;
  private selectionTimer: ReturnType<typeof setTimeout> | undefined;
  private lastScrollAt = 0;

  constructor(private readonly onFlush: (batch: FocusBatch) => void) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    const markInteraction = () => {
      this.lastInteractionAt = Date.now();
    };
    document.addEventListener('pointerdown', markInteraction, { passive: true, capture: true });
    document.addEventListener('keydown', markInteraction, { passive: true, capture: true });
    document.addEventListener('scroll', () => this.onScroll(), { passive: true, capture: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });
    window.addEventListener('pagehide', () => this.flush());
    document.addEventListener('click', (event) => this.onClick(event), true);
    document.addEventListener('selectionchange', () => this.onSelectionChange());

    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) this.intersecting.add(entry.target);
        else this.intersecting.delete(entry.target);
      }
    });
    const candidates = document.querySelectorAll(
      'p, h1, h2, h3, h4, h5, h6, li, blockquote',
    );
    for (const element of [...candidates].slice(0, 1500)) {
      this.observer.observe(element);
    }

    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    this.flushTimer = setInterval(() => this.flush(), FLUSH_MS);
  }

  stop(): void {
    this.started = false;
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.selectionTimer) clearTimeout(this.selectionTimer);
    this.observer?.disconnect();
    this.observer = undefined;
  }

  /** Send the accumulated delta and reset it, so merges never double count. */
  flush(): void {
    const hasData =
      this.dwellMs > 0 ||
      this.activeMs > 0 ||
      this.blocks.size > 0 ||
      this.selections.length > 0 ||
      this.clicks.length > 0;
    if (!hasData) return;
    const batch: FocusBatch = {
      dwellMs: this.dwellMs,
      activeMs: this.activeMs,
      maxScrollPct: this.maxScrollPct,
      blocks: [...this.blocks.values()],
      selections: this.selections,
      clicks: this.clicks,
      capturedAt: Date.now(),
    };
    this.dwellMs = 0;
    this.activeMs = 0;
    this.blocks.clear();
    this.selections = [];
    this.clicks = [];
    this.onFlush(batch);
  }

  private tick(): void {
    if (document.visibilityState !== 'visible') return;
    this.dwellMs += TICK_MS;
    if (Date.now() - this.lastInteractionAt < INTERACTION_WINDOW_MS) {
      this.activeMs += TICK_MS;
      this.addVisibleBlockTime();
    }
  }

  private addVisibleBlockTime(): void {
    for (const element of this.intersecting) {
      if (this.blocks.size >= MAX_BLOCKS_TRACKED) break;
      const text = truncate(element.textContent ?? '', BLOCK_LIMIT);
      if (!text) continue;
      const existing = this.blocks.get(text);
      if (existing) existing.ms += TICK_MS;
      else this.blocks.set(text, { text, ms: TICK_MS });
    }
  }

  private onScroll(): void {
    const now = Date.now();
    if (now - this.lastScrollAt < 200) return;
    this.lastScrollAt = now;
    this.lastInteractionAt = now;
    this.maxScrollPct = Math.max(
      this.maxScrollPct,
      scrollPercent(
        window.scrollY,
        window.innerHeight,
        document.documentElement.scrollHeight,
      ),
    );
  }

  private onClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (isTypingTarget(target.closest('input, textarea, select, [contenteditable]'))) return;
    const actionable = target.closest('a, button, [role="button"]');
    if (!actionable) return;
    const text = truncate(
      (actionable.textContent ?? '').trim() ||
        actionable.getAttribute('aria-label') ||
        actionable.getAttribute('title') ||
        '',
      200,
    );
    if (!text) return;
    const href =
      actionable instanceof HTMLAnchorElement ? actionable.href : undefined;
    this.clicks.push({ text, href, ts: Date.now() });
    if (this.clicks.length > CLICK_LIMIT) this.clicks = this.clicks.slice(-CLICK_LIMIT);
  }

  private onSelectionChange(): void {
    if (this.selectionTimer) clearTimeout(this.selectionTimer);
    this.selectionTimer = setTimeout(() => {
      const text = window.getSelection()?.toString().trim() ?? '';
      if (text.length < SELECTION_MIN) return;
      this.selections.push({ text: truncate(text, SELECTION_LIMIT), ts: Date.now() });
      if (this.selections.length > 10) this.selections = this.selections.slice(-10);
    }, 600);
  }
}

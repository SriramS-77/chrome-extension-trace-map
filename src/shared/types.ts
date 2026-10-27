/**
 * The shared data contract. Every other module imports its types from here.
 * Keep this file free of runtime imports so it can be used from every context
 * (service worker, content script, side panel, sessions page, tests).
 */

export interface Session {
  id: string;
  title: string;
  startedAt: number;
  endedAt?: number;
}

export type EdgeType = 'link' | 'new-tab' | 'typed' | 'spa' | 'back' | 'forward' | 'revisit';

export interface TabNode {
  id: string;
  sessionId: string;
  parentId: string | null;
  url: string;
  normalizedUrl: string;
  title: string;
  favicon?: string;
  tabId: number;
  createdAt: number;
  lastVisitedAt: number;
  visitCount: number;
  /** Flag ids. */
  flags: string[];
  /** Markdown. */
  note: string;
  focus?: FocusStats;
  summary?: Summary;
}

export interface Edge {
  id: string;
  sessionId: string;
  from: string;
  to: string;
  type: EdgeType;
}

export interface Flag {
  id: string;
  name: string;
  color: string;
  builtin: boolean;
}

export interface FocusBlock {
  text: string;
  ms: number;
}

export interface FocusSelection {
  text: string;
  ts: number;
}

export interface FocusClick {
  text: string;
  href?: string;
  ts: number;
}

export interface FocusStats {
  dwellMs: number;
  activeMs: number;
  maxScrollPct: number;
  /** Max 5, sorted by time spent. */
  topBlocks: FocusBlock[];
  /** Max 10. */
  selections: FocusSelection[];
  /** Max 20. */
  clicks: FocusClick[];
  capturedAt: number;
}

export type SummaryProvider = 'chrome-builtin' | 'gemini';

export interface Summary {
  text: string;
  focusText: string;
  provider: SummaryProvider;
  model: string;
  contentHash: string;
  createdAt: number;
}

export interface PageText {
  nodeId: string;
  text: string;
  contentHash: string;
}

export type ProviderMode = 'auto' | 'chrome' | 'gemini';

export interface Settings {
  /** Which summarizer to prefer. */
  providerMode: ProviderMode;
  /** Gemini model id, editable so a newer model is one edit away. */
  geminiModel: string;
  /** Summarize automatically when the reader leaves a page. */
  autoSummarize: boolean;
  /** Minutes without navigation before a new session starts. */
  idleMinutes: number;
  /** Domains that are never recorded. */
  blocklist: string[];
  /** Recording paused by the user. */
  recordingPaused: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  providerMode: 'auto',
  geminiModel: 'gemini-3.5-flash-lite',
  autoSummarize: false,
  idleMinutes: 30,
  recordingPaused: false,
  blocklist: [
    'bank',
    'banking',
    'chase.com',
    'bankofamerica.com',
    'wellsfargo.com',
    'hsbc.com',
    'icicibank.com',
    'hdfcbank.com',
    'paypal.com',
    'stripe.com',
    'wise.com',
    'mail.google.com',
    'outlook.office.com',
    'outlook.live.com',
    'mail.yahoo.com',
    'health.icicilombard.com',
    'myhealthrecord.gov.au',
    'patients.mychart.com',
  ],
};

/**
 * A batch of focus activity produced by the content script for one node.
 * Raw event streams are never persisted; only the merged stats are.
 */
export interface FocusBatch {
  dwellMs: number;
  activeMs: number;
  maxScrollPct: number;
  blocks: FocusBlock[];
  selections: FocusSelection[];
  clicks: FocusClick[];
  capturedAt: number;
}

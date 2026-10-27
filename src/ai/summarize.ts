import { db, getSettings } from '../shared/db';
import { getGeminiApiKey } from '../shared/apiKey';
import { extractTextFromTab } from '../shared/messages';
import { sha256Hex } from '../shared/hash';
import type { Session, Summary, TabNode } from '../shared/types';
import { summarizeWithChrome, summarizerAvailability } from './chromeBuiltin';
import { summarizeWithGemini } from './gemini';
import {
  buildChromeFocusInput,
  buildChromeSessionInput,
  buildChromeSummaryInput,
  buildSessionSummaryPrompt,
} from './prompt';
import { routeSummarizer } from './router';
import { orderNodes } from '../tree/order';

export class SummarySetupError extends Error {
  readonly reason: 'needs-download' | 'needs-setup';

  constructor(reason: 'needs-download' | 'needs-setup', message: string) {
    super(message);
    this.name = 'SummarySetupError';
    this.reason = reason;
  }
}

export interface SummarizeOptions {
  /** Ignore the cached summary for the same content hash. */
  force?: boolean;
  onProgress?: (loaded: number) => void;
}

interface ResolvedPageText {
  text: string;
  contentHash: string;
}

async function pageTextFor(node: TabNode): Promise<ResolvedPageText> {
  const cached = await db.pageText.get(node.id);
  if (cached && cached.text.trim().length > 0) return cached;
  const extracted = await extractTextFromTab(node.tabId);
  const text = extracted.ok && extracted.text ? extracted.text : '';
  if (!text.trim()) {
    throw new Error('Could not read this page’s text. Reopen the page and try again.');
  }
  const contentHash = await sha256Hex(text);
  await db.pageText.put({ nodeId: node.id, text, contentHash });
  return { text, contentHash };
}

/**
 * Summarize one node. Runs in an extension page (side panel / sessions page)
 * because Chrome's Summarizer API is unavailable in the service worker.
 */
export async function summarizeNode(
  nodeId: string,
  options: SummarizeOptions = {},
): Promise<Summary> {
  const node = await db.nodes.get(nodeId);
  if (!node) throw new Error('This page is no longer in the tree.');
  const settings = await getSettings();
  const [availability, apiKey] = await Promise.all([
    summarizerAvailability(),
    getGeminiApiKey(),
  ]);
  const decision = routeSummarizer(settings.providerMode, availability, Boolean(apiKey));
  if (decision.kind === 'needs-download') {
    throw new SummarySetupError(
      'needs-download',
      'Chrome’s on-device model still needs to download. Use “Download on-device model” first, or add a Gemini API key in Settings.',
    );
  }
  if (decision.kind === 'needs-setup') {
    throw new SummarySetupError(
      'needs-setup',
      'No summarizer is available: download Chrome’s on-device model or add a Gemini API key in Settings.',
    );
  }

  const page = await pageTextFor(node);
  const provider = decision.provider;
  if (
    !options.force &&
    node.summary &&
    node.summary.contentHash === page.contentHash &&
    node.summary.provider === provider
  ) {
    return node.summary;
  }

  let summary: Summary;
  if (provider === 'gemini') {
    const result = await summarizeWithGemini({
      apiKey,
      model: settings.geminiModel,
      title: node.title || node.normalizedUrl,
      url: node.url,
      text: page.text,
      focus: node.focus,
    });
    summary = {
      text: result.summary.trim(),
      focusText: result.focus.trim(),
      provider: 'gemini',
      model: settings.geminiModel,
      contentHash: page.contentHash,
      createdAt: Date.now(),
    };
  } else {
    const context = `${node.title || node.normalizedUrl} (${node.url})`;
    const text = await summarizeWithChrome(
      buildChromeSummaryInput({
        title: node.title || node.normalizedUrl,
        url: node.url,
        text: page.text,
        focus: node.focus,
      }),
      { context, onProgress: options.onProgress },
    );
    const focusInput = buildChromeFocusInput({
      title: node.title || node.normalizedUrl,
      url: node.url,
      text: page.text,
      focus: node.focus,
    });
    const focusText = focusInput
      ? await summarizeWithChrome(focusInput, { context, onProgress: options.onProgress })
      : 'Not enough recorded activity to tell what the reader focused on.';
    summary = {
      text: text.trim(),
      focusText: focusText.trim(),
      provider: 'chrome-builtin',
      model: 'chrome-on-device',
      contentHash: page.contentHash,
      createdAt: Date.now(),
    };
  }

  await db.nodes.update(nodeId, { summary });
  return summary;
}

/**
 * "What was researched, how it branched" over the node summaries in tree order.
 * Uses whichever provider routing selects; requires at least one node summary.
 */
export async function summarizeSession(
  sessionId: string,
  options: SummarizeOptions = {},
): Promise<string> {
  const session = await db.sessions.get(sessionId);
  if (!session) throw new Error('Session not found.');
  const nodes = await db.nodes.where('sessionId').equals(sessionId).toArray();
  const withSummaries = orderNodes(nodes).filter((node) => node.summary);
  if (withSummaries.length === 0) {
    throw new Error('Summarize at least one page in this session first.');
  }

  const settings = await getSettings();
  const [availability, apiKey] = await Promise.all([summarizerAvailability(), getGeminiApiKey()]);
  const decision = routeSummarizer(settings.providerMode, availability, Boolean(apiKey));
  if (decision.kind !== 'provider') {
    throw new SummarySetupError(decision.kind, 'Choose a summarizer in Settings first.');
  }

  const items = withSummaries.map((node) => ({
    title: node.title || node.normalizedUrl,
    url: node.url,
    summary: node.summary?.text ?? '',
  }));

  if (decision.provider === 'gemini') {
    const result = await summarizeWithGemini({
      apiKey,
      model: settings.geminiModel,
      title: session.title,
      url: 'tab-tree://session',
      text: buildSessionSummaryPrompt(session, items),
      signal: undefined,
    });
    return `${result.summary}\n\n${result.focus}`.trim();
  }
  return summarizeWithChrome(buildChromeSessionInput(session, items), {
    context: `Session: ${session.title}`,
    onProgress: options.onProgress,
  });
}

export async function sessionBundle(sessionId: string) {
  const session = await db.sessions.get(sessionId);
  if (!session) throw new Error('Session not found.');
  const [nodes, edges, flags] = await Promise.all([
    db.nodes.where('sessionId').equals(sessionId).toArray(),
    db.edges.where('sessionId').equals(sessionId).toArray(),
    db.flags.toArray(),
  ]);
  return { session, nodes: orderNodes(nodes), edges, flags };
}

export type SessionBundleResult = Awaited<ReturnType<typeof sessionBundle>>;

export function sessionOf(nodes: readonly TabNode[]): Session | undefined {
  const first = nodes[0];
  if (!first) return undefined;
  return { id: first.sessionId, title: '', startedAt: first.createdAt };
}

import type { FocusStats, Session, Summary } from '../shared/types';

/** Approximate token budget, using ~4 characters per token. */
export const CHARS_PER_TOKEN = 4;
export const MAX_GEMINI_TOKENS = 8_000;
export const MAX_CHROME_TOKENS = 3_000;

export const SUMMARY_SYSTEM_INSTRUCTION = [
  "You summarize a web page for a researcher's notes.",
  'Return JSON with two fields.',
  'summary: 2-3 plain sentences on what the page is about.',
  'focus: 1-2 sentences on what the reader paid attention to, using only the FOCUS DATA.',
  'If the focus data is empty, say there is not enough activity to tell.',
  'Do not invent facts that are not in the page text.',
].join('\n');

export function truncateToTokens(text: string, maxTokens: number): string {
  const limit = maxTokens * CHARS_PER_TOKEN;
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
}

export function formatFocusData(focus: FocusStats | undefined): string {
  if (!focus) return 'none recorded';
  const activeMinutes = Math.max(1, Math.round(focus.activeMs / 60_000));
  const lines: string[] = [
    `time on page ${activeMinutes} min, scrolled ${focus.maxScrollPct}%`,
  ];
  if (focus.topBlocks.length > 0) {
    lines.push(
      `Most-read passages: ${focus.topBlocks.map((block) => `"${block.text}"`).join(' | ')}`,
    );
  } else {
    lines.push('Most-read passages: none recorded');
  }
  if (focus.selections.length > 0) {
    lines.push(`Selected text: ${focus.selections.map((item) => `"${item.text}"`).join(' | ')}`);
  }
  if (focus.clicks.length > 0) {
    lines.push(`Clicked: ${focus.clicks.map((item) => `"${item.text}"`).join(' | ')}`);
  }
  return lines.join('\n');
}

export interface PagePromptInput {
  title: string;
  url: string;
  text: string;
  focus?: FocusStats;
}

/** One prompt for providers that answer both parts in one call (Gemini). */
export function buildGeminiPrompt(input: PagePromptInput): string {
  return [
    `PAGE: ${input.title} (${input.url})`,
    `TEXT: ${truncateToTokens(input.text, MAX_GEMINI_TOKENS)}`,
    `FOCUS DATA: ${formatFocusData(input.focus)}`,
    '',
    'Return only this JSON object, with no markdown and no commentary before or after it:',
    '{"summary":"<2-3 plain sentences>","focus":"<1-2 sentences or a note that there is not enough activity>"}',
  ].join('\n\n');
}

/** Chrome's summarizer only needs the article text plus light context. */
export function buildChromeSummaryInput(input: PagePromptInput): string {
  return [
    `Title: ${input.title}`,
    `URL: ${input.url}`,
    '',
    truncateToTokens(input.text, MAX_CHROME_TOKENS),
  ].join('\n');
}

/** The focus line is a second summarize() call over what the reader actually read. */
export function buildChromeFocusInput(input: PagePromptInput): string {
  const focus = input.focus;
  if (!focus) return '';
  const parts: string[] = [];
  if (focus.topBlocks.length > 0) {
    parts.push(`Passages read most:\n${focus.topBlocks.map((b) => `- ${b.text}`).join('\n')}`);
  }
  if (focus.selections.length > 0) {
    parts.push(`Text selected:\n${focus.selections.map((s) => `- ${s.text}`).join('\n')}`);
  }
  if (focus.clicks.length > 0) {
    parts.push(`Links and buttons clicked:\n${focus.clicks.map((c) => `- ${c.text}`).join('\n')}`);
  }
  if (parts.length === 0) return '';
  return [
    `These are the parts of "${input.title}" a reader paid attention to ` +
      `(${Math.max(1, Math.round(focus.activeMs / 60_000))} min active, ${focus.maxScrollPct}% scrolled).`,
    '',
    parts.join('\n\n'),
    '',
    'In 1-2 sentences, describe what the reader focused on. Use only this data.',
  ].join('\n');
}

export interface SessionSummaryItem {
  title: string;
  url: string;
  summary: string;
}

/** "What was researched, how it branched" over the session's node summaries. */
export function buildSessionSummaryPrompt(session: Session, items: SessionSummaryItem[]): string {
  const lines = items.map(
    (item, index) => `${index + 1}. ${item.title} (${item.url})\n   ${item.summary}`,
  );
  return [
    `Session: ${session.title}`,
    '',
    'Pages visited in tree order:',
    ...lines,
    '',
    'Summarize what this session researched and how the reading branched. 3-4 plain sentences.',
  ].join('\n');
}

export function buildChromeSessionInput(session: Session, items: SessionSummaryItem[]): string {
  return buildSessionSummaryPrompt(session, items);
}

/** Kept for providers that return the two parts separately. */
export function summaryFromParts(
  summary: string,
  focusText: string,
  provider: Summary['provider'],
  model: string,
  contentHash: string,
  createdAt: number,
): Summary {
  return { text: summary.trim(), focusText: focusText.trim(), provider, model, contentHash, createdAt };
}

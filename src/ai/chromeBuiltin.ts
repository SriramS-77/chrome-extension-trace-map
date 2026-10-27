import type { SummarizerAvailability } from './router';

interface SummarizerInstance {
  summarize(text: string, options?: { context?: string }): Promise<string>;
  destroy?: () => void;
}

interface SummarizerCreateOptions {
  type?: string;
  length?: string;
  format?: string;
  sharedContext?: string;
  expectedInputLanguages?: string[];
  outputLanguage?: string;
  monitor?: (monitor: unknown) => void;
}

interface SummarizerStatic {
  availability(): Promise<SummarizerAvailability | { availability: SummarizerAvailability }>;
  create(options?: SummarizerCreateOptions): Promise<SummarizerInstance>;
}

export type DownloadProgress = (loaded: number) => void;

function createMonitor(onProgress: DownloadProgress) {
  return (monitor: unknown) => {
    const typed = monitor as {
      addEventListener?: (event: string, listener: (e: Event) => void) => void;
    };
    typed.addEventListener?.('downloadprogress', (event: Event) => {
      const progress = event as Event & { loaded?: number };
      onProgress(progress.loaded ?? 0);
    });
  };
}

function getSummarizer(): SummarizerStatic | undefined {
  return (globalThis as unknown as { Summarizer?: SummarizerStatic }).Summarizer;
}

export function isBuiltinSummarizerPresent(): boolean {
  return getSummarizer() !== undefined;
}

export async function summarizerAvailability(): Promise<SummarizerAvailability> {
  const summarizer = getSummarizer();
  if (!summarizer) return 'unavailable';
  try {
    const result = await summarizer.availability();
    return typeof result === 'string' ? result : result.availability;
  } catch {
    return 'unavailable';
  }
}

/**
 * Create and immediately destroy a summarizer, which downloads the on-device
 * model. Must be called from a user gesture (button click).
 */
export async function prepareChromeSummarizer(
  onProgress?: DownloadProgress,
): Promise<void> {
  const summarizer = getSummarizer();
  if (!summarizer) throw new Error('Chrome’s on-device summarizer is not available.');
  const instance = await summarizer.create({
    type: 'tldr',
    length: 'medium',
    format: 'plain-text',
    monitor: onProgress ? createMonitor(onProgress) : undefined,
  });
  instance.destroy?.();
}

/**
 * Run Chrome's on-device summarizer. Must be called from an extension page with
 * a window (side panel / sessions page): the API is unavailable in workers.
 */
export async function summarizeWithChrome(
  text: string,
  options: {
    context?: string;
    onProgress?: DownloadProgress;
  } = {},
): Promise<string> {
  const summarizer = getSummarizer();
  if (!summarizer) throw new Error('Chrome’s on-device summarizer is not available.');

  const instance = await summarizer.create({
    type: 'tldr',
    length: 'medium',
    format: 'plain-text',
    sharedContext: options.context,
    monitor: options.onProgress ? createMonitor(options.onProgress) : undefined,
  });

  try {
    return await instance.summarize(text);
  } finally {
    instance.destroy?.();
  }
}

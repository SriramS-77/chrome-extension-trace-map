import type { FocusBatch } from './types';

/** Messages the content script and pages send to the service worker. */
export type BackgroundMessage =
  | { type: 'focus/flush'; payload: FocusBatch }
  | { type: 'recording/set'; paused: boolean }
  | { type: 'session/new' };

export type BackgroundResponse =
  | { ok: true; nodeId?: string }
  | { ok: false; error: string };

export interface ExtractResponse {
  ok: boolean;
  url?: string;
  title?: string;
  text?: string;
  contentHash?: string;
  error?: string;
}

/** Messages the side panel sends to a content script to extract readable text. */
export type ContentMessage = { type: 'page/extract' };

export async function sendToBackground(
  message: BackgroundMessage,
): Promise<BackgroundResponse> {
  try {
    return (await chrome.runtime.sendMessage(message)) as BackgroundResponse;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function requestExtract(tabId: number): Promise<ExtractResponse> {
  try {
    return (await chrome.tabs.sendMessage(tabId, {
      type: 'page/extract',
    } satisfies ContentMessage)) as ExtractResponse;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function extractTextFromTab(tabId: number): Promise<ExtractResponse> {
  const result = await requestExtract(tabId);
  if (result.ok) return result;
  // No content script (for example after an extension reload): inject it once and retry.
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-scripts/content.js'],
    });
  } catch {
    return result;
  }
  return requestExtract(tabId);
}

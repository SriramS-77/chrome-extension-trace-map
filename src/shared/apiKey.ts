const GEMINI_KEY = 'geminiApiKey';

/** The Gemini key lives in chrome.storage.local, never in Dexie or the repo. */
export async function getGeminiApiKey(): Promise<string> {
  const result = await chrome.storage.local.get(GEMINI_KEY);
  const value = result[GEMINI_KEY];
  return typeof value === 'string' ? value : '';
}

export async function setGeminiApiKey(value: string): Promise<void> {
  const trimmed = value.trim();
  if (trimmed) {
    await chrome.storage.local.set({ [GEMINI_KEY]: trimmed });
  } else {
    await chrome.storage.local.remove(GEMINI_KEY);
  }
}

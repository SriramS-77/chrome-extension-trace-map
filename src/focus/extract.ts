import { Readability } from '@mozilla/readability';

const MAX_TEXT_CHARS = 200_000;

/**
 * Main article text for summaries. Readability first (keeps title and
 * headings), then a plain body fallback. Full HTML is never stored.
 */
export function extractReadableText(doc: Document): { title: string; text: string } {
  try {
    const clone = doc.cloneNode(true) as Document;
    const article = new Readability(clone, { charThreshold: 100 }).parse();
    const text = (article?.textContent ?? '').trim();
    if (text.length > 80) {
      return {
        title: article?.title?.trim() || doc.title,
        text: text.slice(0, MAX_TEXT_CHARS),
      };
    }
  } catch {
    // Fall through to the body text.
  }
  const body = doc.body as HTMLElement | null;
  const fallback = body?.innerText ?? body?.textContent ?? '';
  return { title: doc.title, text: fallback.trim().slice(0, MAX_TEXT_CHARS) };
}

import { FocusTracker } from '../src/focus/tracker';
import { extractReadableText } from '../src/focus/extract';
import type { ContentMessage, ExtractResponse } from '../src/shared/messages';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    const tracker = new FocusTracker((payload) => {
      void chrome.runtime.sendMessage({ type: 'focus/flush', payload }).catch(() => {
        // The extension was reloaded or the worker is gone; the next flush retries.
      });
    });
    tracker.start();

    // SPA route changes: flush what was read on the previous view before the
    // background assigns the next node.
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method].bind(history);
      history[method] = ((...args: Parameters<History['pushState']>) => {
        tracker.flush();
        return original(...args);
      }) as History[typeof method];
    }
    window.addEventListener('popstate', () => tracker.flush());

    chrome.runtime.onMessage.addListener(
      (message: ContentMessage, _sender, sendResponse: (response: ExtractResponse) => void) => {
        if (message?.type !== 'page/extract') return false;
        const extracted = extractReadableText(document);
        sendResponse({
          ok: true,
          url: location.href,
          title: extracted.title,
          text: extracted.text,
        });
        return false;
      },
    );
  },
});

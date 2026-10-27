import { describe, expect, it } from 'vitest';
import { isBlocklisted, isSkippableUrl, normalizeUrl } from '../src/shared/urls';

describe('normalizeUrl', () => {
  it('lowercases the host, drops the hash and trailing slash', () => {
    expect(normalizeUrl('https://Example.COM/Path/?x=1#section')).toBe(
      'https://example.com/Path?x=1',
    );
  });

  it('strips tracking parameters and keeps the rest', () => {
    expect(
      normalizeUrl(
        'https://news.example.com/a?utm_source=x&utm_medium=y&fbclid=z&gclid=q&id=42',
      ),
    ).toBe('https://news.example.com/a?id=42');
  });

  it('keeps query order stable and removes only known trackers', () => {
    expect(normalizeUrl('https://a.test/?b=2&a=1&utm_campaign=c')).toBe('https://a.test?b=2&a=1');
  });

  it('returns an empty string for invalid input', () => {
    expect(normalizeUrl('not a url')).toBe('');
  });
});

describe('isSkippableUrl', () => {
  it.each([
    'chrome://settings',
    'chrome-extension://abc/sidepanel.html',
    'about:blank',
    'devtools://devtools/bundled/inspector.html',
    'chrome-untrusted://newtab/',
  ])('skips browser internal pages: %s', (url) => {
    expect(isSkippableUrl(url)).toBe(true);
  });

  it('skips the Web Store', () => {
    expect(isSkippableUrl('https://chromewebstore.google.com/detail/x')).toBe(true);
    expect(isSkippableUrl('https://chrome.google.com/webstore/category/extensions')).toBe(true);
  });

  it('tracks regular pages', () => {
    expect(isSkippableUrl('https://example.com/article')).toBe(false);
    expect(isSkippableUrl('http://example.com')).toBe(false);
  });
});

describe('isBlocklisted', () => {
  const blocklist = ['bank', 'mail.google.com'];

  it('matches exact hosts and subdomains', () => {
    expect(isBlocklisted('https://mail.google.com/mail/u/0', blocklist)).toBe(true);
    expect(isBlocklisted('https://bank', blocklist)).toBe(true);
    expect(isBlocklisted('https://www.bank/x', blocklist)).toBe(true);
    expect(isBlocklisted('https://bank.example.org', blocklist)).toBe(false);
    expect(isBlocklisted('https://notabank.example.org', blocklist)).toBe(false);
  });

  it('treats unparseable URLs as blocked', () => {
    expect(isBlocklisted('not a url', blocklist)).toBe(true);
  });
});

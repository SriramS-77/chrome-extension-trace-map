const TRACKING_PARAMS = [
  /^utm_/,
  /^fbclid$/,
  /^gclid$/,
  /^dclid$/,
  /^msclkid$/,
  /^igshid$/,
  /^mc_cid$/,
  /^mc_eid$/,
  /^_ga$/,
  /^ref_src$/,
  /^ref_url$/,
  /^vero_id$/,
  /^oly_enc_id$/,
];

const SKIPPED_SCHEMES = [
  'chrome:',
  'chrome-extension:',
  'chrome-untrusted:',
  'edge:',
  'about:',
  'devtools:',
  'view-source:',
];

const WEBSTORE_HOSTS = ['chromewebstore.google.com', 'chrome.google.com'];

function isTrackingParam(name: string): boolean {
  return TRACKING_PARAMS.some((pattern) => pattern.test(name));
}

/**
 * Canonical form of a URL used for revisit lookups and duplicate detection:
 * lowercase host, no hash, no tracking params, no trailing slash.
 */
export function normalizeUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }
  parsed.hash = '';
  for (const name of [...parsed.searchParams.keys()]) {
    if (isTrackingParam(name)) parsed.searchParams.delete(name);
  }
  const path = parsed.pathname.endsWith('/') ? parsed.pathname.slice(0, -1) : parsed.pathname;
  const search = parsed.searchParams.toString();
  return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${search ? `?${search}` : ''}`;
}

/** Pages the extension never records: browser internals, the Web Store and unsupported schemes. */
export function isSkippableUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return true;
  }
  if (SKIPPED_SCHEMES.includes(parsed.protocol)) return true;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
  if (isWebStoreUrl(parsed)) return true;
  return false;
}

export function isWebStoreUrl(parsed: URL): boolean {
  if (!WEBSTORE_HOSTS.includes(parsed.hostname)) return false;
  if (parsed.hostname === 'chrome.google.com') {
    return parsed.pathname.startsWith('/webstore');
  }
  return true;
}

/** True when host is, or is a subdomain of, an entry in the blocklist. */
export function isBlocklisted(raw: string, blocklist: readonly string[]): boolean {
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return true;
  }
  return blocklist.some((entry) => {
    const domain = entry.trim().toLowerCase().replace(/^\./, '');
    if (!domain) return false;
    return host === domain || host.endsWith(`.${domain}`);
  });
}

/** Hostname without a leading `www.`, for display. */
export function displayHost(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return raw;
  }
}

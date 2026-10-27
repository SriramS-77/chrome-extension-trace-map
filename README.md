# Tab Tree

A Chrome (Manifest V3) extension that records your browsing as a tree of pages, lets you annotate
and flag each page, and summarizes what you read and where your attention went — using Chrome's
on-device summarizer first, and Gemini as the fallback.

Built with WXT + React + TypeScript, Cytoscape.js (dagre layout) for the graph, and Dexie
(IndexedDB) for storage. All recording stays in the browser; page text leaves it only when a
summary uses Gemini.

## Quick start

```bash
pnpm install
pnpm build          # -> .output/chrome-mv3
```

Then load `.output/chrome-mv3` as an unpacked extension (instructions below).

| Command | What it does |
| --- | --- |
| `pnpm dev` | WXT dev server with hot reload (loads `.output/chrome-mv3-dev`) |
| `pnpm build` | Production MV3 build in `.output/chrome-mv3` |
| `pnpm typecheck` | `tsc --noEmit`, strict mode |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest unit tests for the pure logic |
| `pnpm smoke` | Real-Chromium smoke test with the built extension (needs `pnpm build`) |
| `pnpm zip` | Store-ready zip |

## Test it locally in Chrome (Windows)

### 1. One-time setup

1. Install **Node.js 20+ LTS**: `winget install OpenJS.NodeJS.LTS` (or from nodejs.org).
2. Install **Git**: `winget install Git.Git`.
3. Enable pnpm (ships with Node via Corepack), in PowerShell:
   ```powershell
   corepack enable
   corepack prepare pnpm@10.28.2 --activate
   ```
4. Update **Google Chrome** to 138 or newer: `chrome://settings/help`. Desktop Chrome on Windows
   can run the built-in summarizer; older versions fall back to Gemini.

### 2. Build the extension

```powershell
git clone https://github.com/SriramS-77/chrome-extension-trace-map.git
cd chrome-extension-trace-map
pnpm install
pnpm build
```

The loadable extension is the folder `.output\chrome-mv3` (not the repository root).

### 3. Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select `chrome-extension-trace-map\.output\chrome-mv3`.
4. Pin **Tab Tree** from the puzzle-piece menu.

### 4. A 5-minute product check

1. Click the Tab Tree icon — the **side panel** opens and the badge dot is green (recording).
2. Open any article, then click a link inside it: two nodes appear, the second under the first.
3. `Ctrl+click` a link to open a new tab: the new page appears as a child with a blue edge.
4. Press Back and Forward: no duplicate nodes; the highlighted node moves.
5. On a single-page app (for example a video site), click through a few views: new nodes appear
   without reloading the panel.
6. Click a node, write a Markdown note and pick a flag. Reload the side panel — both persist.
7. On a long article, scroll and select a passage, then press **Summarize**:
   - With no Gemini key and no on-device model, the panel offers **Download on-device model**.
   - With a key in **Settings**, the fallback runs and the summary shows a `Gemini` badge.
8. Open **Sessions** (button in the panel header): pick the session, filter by flag, search, and
   export JSON/Markdown.
9. Restart Chrome, reopen the side panel: the session and graph are still there (state lives in
   IndexedDB and `chrome.storage.session`, never in the service worker).

### 5. Gemini fallback (optional)

1. Get a key from [Google AI Studio](https://aistudio.google.com/apikey).
2. Tab Tree **Settings** → paste the key → **Save settings** → **Test Gemini key**.
3. The key is stored in `chrome.storage.local`, never in the repo or in exports. Page text is sent
   to Google only for pages you summarize.

**Switching models.** The model id is a setting, not a build constant. `gemini-3.5-flash-lite` is the
default; the field suggests `gemini-3.5-flash-lite`, `gemini-3.5-flash`, `gemini-2.5-flash-lite` and
`gemma-4-31b-it`, and any id that supports `generateContent` can be typed in. After changing the
model, press **Regenerate** — summaries are cached per page content and provider.

`gemma-4-31b-it` was the model used for the browser smoke run in this repository; it is frequently
busy (`HTTP 500/503`) and the client retries with exponential backoff before reporting a clear error.
For everyday use `gemini-3.5-flash-lite` is faster and more reliable.

### 6. Troubleshooting (Windows)

- **Nothing appears in the graph** — only `http(s)` pages are recorded; `chrome://`, the Web Store,
  incognito windows and blocklisted domains are skipped by design. Check the console of the service
  worker (`chrome://extensions` → Tab Tree → *service worker*).
- **Changes do not show up** — click the reload icon on the Tab Tree card in `chrome://extensions`
  after a rebuild, then refresh the pages you are testing (content scripts are re-injected on the
  next load).
- **Side panel is blank** — open `chrome-extension://<extension-id>/sidepanel.html` directly; the
  extension id is on the `chrome://extensions` card.
- **On-device model unavailable** — Chrome needs a supported desktop build and a large amount of free
  disk. Use Gemini while the model is unavailable; the panel always labels the provider.

## Verification

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
GEMINI_API_KEY=… GEMINI_MODEL=gemini-3.5-flash-lite pnpm smoke   # optional live AI check
GEMINI_API_KEY=… GEMINI_MODEL=gemma-4-31b-it pnpm smoke          # smallest open model
```

`scripts/smoke.mjs` drives a real Chromium with the unpacked extension: it opens three local pages,
checks that the tree is written to IndexedDB with the right parent link, that the side panel and
sessions page render the session, opens a node, runs a Gemini summary and checks the provider badge.
The key is read from the environment and never written to disk.

`tests/live.gemini.test.ts` runs one real provider request when `GEMINI_API_KEY` is set and is
skipped otherwise, so unit tests stay offline by default.

## How it works

```
entrypoints/
  background.ts     service worker: navigation -> tree, focus merge, tab map
  content.ts        focus tracking, page text extraction
  sidepanel/        live graph, notes, flags, summarizer
  sessions/         past sessions, search, filters, export
  options/          provider, Gemini key, blocklist, data controls
src/
  shared/           types, Dexie schema, URL normalization, messages, export
  tree/             pure resolver (unit-tested), session rules, ordering
  focus/            aggregation math and DOM tracker
  ai/               router, Chrome built-in, Gemini, prompt builders
  ui/               graph, node panel, live-data hooks
tests/              Vitest unit tests for the pure modules
```

- **Tree rules** live in `src/tree/resolver.ts` as a pure function; every row of the
  navigation table (same-tab link, new tab, typed root, SPA route, back/forward, reload, revisit,
  tab close, skipped schemes) has a unit test.
- **Focus data** is aggregated in the content script and merged into the node by the worker; raw
  events are never stored. Form fields and editable regions are ignored.
- **AI routing** (`src/ai/router.ts`) is pure and unit-tested for every availability state. Chrome's
  Summarizer API only runs in a window, so summaries execute in the side panel / sessions page, never
  in the worker.
- **Recovery**: the worker keeps no state in memory; every change is written to IndexedDB and the
  tab→node map to `chrome.storage.session`, so a stopped worker resumes cleanly.

## Privacy

- Records only while recording is on (badge shows state), never in incognito windows.
- Blocklist defaults cover banking, webmail and health portals; add your own in Settings.
- Never reads form fields, password inputs or contenteditable regions; never stores page HTML.
- Page text is stored locally in IndexedDB and sent to Gemini only for pages you summarize.
- Delete a page, a session, or all data from the UI.

## Known limits (v1)

- Desktop Chrome only; no accounts, sync, mobile or shared sessions.
- `chrome://` pages and the Web Store cannot run content scripts, so those nodes have no focus data.
- Automatic summaries use Gemini (the on-device model cannot be called from the service worker
  without a user gesture).
- The graph re-runs the tree layout when nodes are added; sessions with thousands of nodes will feel
  slower than the 500-node target.

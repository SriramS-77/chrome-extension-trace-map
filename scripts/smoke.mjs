#!/usr/bin/env node
/**
 * End-to-end smoke test in a real Chromium with the built extension loaded.
 *
 *   pnpm build
 *   GEMINI_API_KEY=… node scripts/smoke.mjs
 *
 * It serves three local pages, browses them, and checks that:
 *  - the service worker starts and records a tree in IndexedDB
 *  - the side panel renders the live session
 *  - the sessions page lists the session
 *  - (with a key) the Gemini summary path produces a labelled summary
 *
 * The API key is read from the environment and never written to disk.
 */
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const EXTENSION_PATH = new URL('../.output/chrome-mv3', import.meta.url).pathname;
const PORT = 8787;
const MODEL = process.env.GEMINI_MODEL ?? 'gemma-4-31b-it';
const API_KEY = process.env.GEMINI_API_KEY ?? '';

const pages = {
  '/a': '<h1>Article A</h1><p>Tab Tree records this page as the root of the tree.</p><p><a id="to-b" href="/b">Read article B</a></p>',
  '/b': '<h1>Article B</h1><p>Article B was opened from a link inside article A, so it becomes a child node.</p><p>Retrieval augmented generation grounds answers in retrieved sources.</p>',
  '/c': '<h1>Article C</h1><p>A typed URL becomes a new root node in the same session.</p><p>Focus tracking measures active reading time, scroll depth and chosen passages.</p>',
};

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const body = pages[req.url ?? '/a'] ?? pages['/a'];
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!doctype html><html><head><title>Tab Tree fixture</title></head><body>${body}</body></html>`);
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

function readStore(store) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('tab-tree');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(store, 'readonly');
      const all = tx.objectStore(store).getAll();
      all.onsuccess = () => resolve(all.result);
      all.onerror = () => reject(all.error);
    };
  });
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const server = await startServer();
const profile = mkdtempSync(join(tmpdir(), 'tab-tree-smoke-'));
let context;

try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-gpu',
    ],
  });

  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20_000 });
  const extensionId = new URL(worker.url()).host;
  check('service worker starts', Boolean(extensionId), extensionId);
  worker.on('console', (message) => {
    if (message.type() === 'error') console.log(`  [worker error] ${message.text()}`);
  });
  // Let the worker finish registering its navigation listeners before browsing.
  await new Promise((resolve) => setTimeout(resolve, 1_000));

  const tab = await context.newPage();
  await tab.goto(`http://127.0.0.1:${PORT}/a`);
  await tab.click('#to-b');
  await tab.waitForURL('**/b');
  await tab.goto(`http://127.0.0.1:${PORT}/c`);
  await tab.waitForTimeout(1_500);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const state = await panel.evaluate(async () => {
    const stored = await chrome.storage.session.get('tabTreeState');
    return stored.tabTreeState ?? null;
  });
  check('tab map persisted in chrome.storage.session', Boolean(state?.sessionId), state?.sessionId ?? '');

  let nodes = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    nodes = await panel.evaluate(readStore, 'nodes');
    if (nodes.length >= 3) break;
    await panel.waitForTimeout(500);
  }
  check('three pages recorded as nodes', nodes.length >= 3, `${nodes.length} nodes`);

  const urls = nodes.map((node) => node.normalizedUrl.replace(`http://127.0.0.1:${PORT}`, ''));
  if (nodes.length < 3) {
    const allSessions = await panel.evaluate(readStore, 'sessions');
    console.log('  [debug] nodes:', JSON.stringify(nodes.map((n) => [n.normalizedUrl, n.parentId, n.sessionId])));
    console.log('  [debug] sessions:', JSON.stringify(allSessions.map((s) => [s.id, s.title])));
  }
  check('tree contains /a, /b, /c', ['/a', '/b', '/c'].every((path) => urls.includes(path)), urls.join(', '));

  const b = nodes.find((node) => node.normalizedUrl.endsWith('/b'));
  const a = nodes.find((node) => node.normalizedUrl.endsWith('/a'));
  check('same-tab link is a child of its parent', b?.parentId === a?.id, 'parent link');

  const header = await panel.locator('header').innerText();
  check('side panel shows the live session', /pages/.test(header), header.replace(/\n/g, ' '));

  const sessions = await context.newPage();
  await sessions.goto(`chrome-extension://${extensionId}/sessions.html`);
  let sessionsText = '';
  for (let attempt = 0; attempt < 12; attempt += 1) {
    sessionsText = await sessions.locator('aside').innerText();
    if (/\d+ pages/.test(sessionsText)) break;
    await sessions.waitForTimeout(500);
  }
  check('sessions page lists the session', /\d+ pages/.test(sessionsText), sessionsText.replace(/\n/g, ' ').slice(0, 80));

  if (!API_KEY) {
    check('Gemini summary path', false, 'GEMINI_API_KEY not set; skipped');
  } else {
    await panel.evaluate(
      async ({ key, model }) => {
        await chrome.storage.local.set({ geminiApiKey: key });
        await new Promise((resolve, reject) => {
          const request = indexedDB.open('tab-tree');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('settings', 'readwrite');
            tx.objectStore('settings').put({
              key: 'app',
              value: { providerMode: 'gemini', geminiModel: model },
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          };
        });
      },
      { key: API_KEY, model: MODEL },
    );
    await panel.reload();
    await panel.waitForTimeout(1_500);

    const box = await panel.locator('.graph').boundingBox();
    let selected = false;
    if (box) {
      for (const fx of [0.5, 0.35, 0.65, 0.2, 0.8, 0.5]) {
        for (const fy of [0.5, 0.65, 0.35, 0.8, 0.2]) {
          await panel.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
          if (await panel.locator('section.panel').count()) {
            selected = true;
            break;
          }
        }
        if (selected) break;
      }
    }
    check('clicking a graph node opens the node panel', selected);

    if (selected) {
      await panel.getByRole('button', { name: /Summarize|Regenerate/ }).first().click();
      try {
        await panel.locator('.summary').first().waitFor({ timeout: 150_000 });
        const summary = await panel.locator('.summary').first().innerText();
        check('Gemini summary renders', summary.length > 40, summary.replace(/\n/g, ' ').slice(0, 140));
        check('summary carries the provider badge', /Gemini/.test(await panel.locator('section.panel').innerText()));
      } catch {
        const error = await panel.locator('.notice.error').first().innerText().catch(() => 'timeout');
        check('Gemini summary renders', false, error.replace(/\n/g, ' ').slice(0, 200));
      }
    }
  }
} catch (error) {
  check('smoke test completed', false, error instanceof Error ? error.message : String(error));
} finally {
  await context?.close().catch(() => {});
  server.close();
  rmSync(profile, { recursive: true, force: true });
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);

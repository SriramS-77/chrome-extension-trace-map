import { db, ensureBuiltinFlags, getSettings, saveSettings } from '../src/shared/db';
import type { BackgroundMessage } from '../src/shared/messages';
import { isBlocklisted } from '../src/shared/urls';
import { mergeFocus } from '../src/focus/aggregate';
import type { FocusBatch, TabNode } from '../src/shared/types';
import {
  applyAction,
  DEFAULT_SESSION_TITLE,
  dropTab,
  resolve,
  type NavigationInput,
  type ResolveState,
  type ResolverAction,
} from '../src/tree/resolver';
import { deriveSessionTitle, idleMsFromMinutes } from '../src/tree/sessions';
import { summarizeNode } from '../src/ai/summarize';

const STORAGE_KEY = 'tabTreeState';

interface PersistedState {
  sessionId: string | null;
  lastActivityAt: number;
  pointers: Record<string, string>;
}

async function readState(): Promise<PersistedState> {
  const stored = await chrome.storage.session.get(STORAGE_KEY);
  const value = stored[STORAGE_KEY] as Partial<PersistedState> | undefined;
  return {
    sessionId: typeof value?.sessionId === 'string' ? value.sessionId : null,
    lastActivityAt: typeof value?.lastActivityAt === 'number' ? value.lastActivityAt : 0,
    pointers:
      value?.pointers && typeof value.pointers === 'object'
        ? (value.pointers as Record<string, string>)
        : {},
  };
}

async function writeState(state: PersistedState): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEY]: state });
}

/** Navigations are serialized: two events must never race over the tree. */
let queue: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): void {
  queue = queue.then(task).catch((error: unknown) => {
    console.error('[tab-tree] background task failed', error);
  });
}

function newNodeId(): string {
  return crypto.randomUUID();
}

async function applyActionToDb(action: ResolverAction): Promise<void> {
  await db.transaction('rw', db.sessions, db.nodes, db.edges, async () => {
    switch (action.type) {
      case 'start-session':
        await db.sessions.put(action.session);
        break;
      case 'create-node':
        await db.nodes.put(action.node);
        if (action.edge) await db.edges.put(action.edge);
        break;
      case 'reuse-node': {
        const node = await db.nodes.get(action.nodeId);
        if (!node) break;
        const updated: TabNode = {
          ...node,
          lastVisitedAt: action.at,
          visitCount: node.visitCount + 1,
        };
        await db.nodes.put(updated);
        if (action.edge) await db.edges.put(action.edge);
        break;
      }
      case 'increment-visit': {
        const node = await db.nodes.get(action.nodeId);
        if (!node) break;
        await db.nodes.put({
          ...node,
          lastVisitedAt: action.at,
          visitCount: node.visitCount + 1,
        });
        break;
      }
    }
  });
}

async function buildState(now: number): Promise<{ state: ResolveState; persisted: PersistedState }> {
  const settings = await getSettings();
  const persisted = await readState();
  const session = persisted.sessionId ? await db.sessions.get(persisted.sessionId) : undefined;
  const nodes = session
    ? await db.nodes.where('sessionId').equals(session.id).toArray()
    : [];
  const nodesByUrl: Record<string, TabNode> = {};
  const nodesById: Record<string, TabNode> = {};
  for (const node of nodes) {
    nodesByUrl[node.normalizedUrl] = node;
    nodesById[node.id] = node;
  }
  return {
    persisted,
    state: {
      now,
      idleMs: idleMsFromMinutes(settings.idleMinutes),
      session: session ?? null,
      lastActivityAt: persisted.lastActivityAt,
      pointer: persisted.pointers,
      nodesByUrl,
      nodesById,
      id: newNodeId,
    },
  };
}

/** Recent created-target notifications, so the follow-up onCommitted does not double count. */
const recentTargets = new Map<number, { url: string; at: number }>();

async function handleNavigation(input: NavigationInput): Promise<void> {
  const settings = await getSettings();
  if (settings.recordingPaused) return;
  const tab = await chrome.tabs.get(input.tabId).catch(() => undefined);
  if (tab?.incognito) return;
  if (isBlocklisted(input.url, settings.blocklist)) return;

  const recent = recentTargets.get(input.tabId);
  if (
    recent &&
    input.kind === 'committed' &&
    recent.url === input.url &&
    input.timestamp - recent.at < 2000
  ) {
    recentTargets.delete(input.tabId);
    return;
  }

  const { state } = await buildState(input.timestamp);
  const result = resolve(input, state);
  if (result.skip) return;

  let next = state;
  for (const action of result.actions) {
    await applyActionToDb(action);
    next = applyAction(next, action);
  }
  await writeState({
    sessionId: next.session?.id ?? null,
    lastActivityAt: next.lastActivityAt,
    pointers: next.pointer,
  });
}

async function updateNodeMeta(tabId: number, title?: string, favicon?: string): Promise<void> {
  const persisted = await readState();
  const nodeId = persisted.pointers[String(tabId)];
  if (!nodeId) return;
  const node = await db.nodes.get(nodeId);
  if (!node) return;
  const patch: Partial<TabNode> = {};
  if (title && title !== node.title) patch.title = title;
  if (favicon && favicon !== node.favicon) patch.favicon = favicon;
  if (Object.keys(patch).length === 0) return;
  await db.nodes.update(nodeId, patch);

  const session = await db.sessions.get(node.sessionId);
  if (session && title && session.title === DEFAULT_SESSION_TITLE) {
    const derived = deriveSessionTitle(title, DEFAULT_SESSION_TITLE);
    if (derived !== DEFAULT_SESSION_TITLE) {
      await db.sessions.update(session.id, { title: derived });
    }
  }
}

async function handleFocusFlush(tabId: number | undefined, batch: FocusBatch): Promise<void> {
  if (tabId === undefined) return;
  const persisted = await readState();
  const nodeId = persisted.pointers[String(tabId)];
  if (!nodeId) return;
  const node = await db.nodes.get(nodeId);
  if (!node) return;
  const focus = mergeFocus(node.focus, batch);
  await db.nodes.update(nodeId, { focus });

  const settings = await getSettings();
  if (settings.autoSummarize && !node.summary && focus.activeMs >= 20_000) {
    const { getGeminiApiKey } = await import('../src/shared/apiKey');
    const key = await getGeminiApiKey();
    if (key) {
      try {
        await summarizeNode(nodeId);
      } catch (error) {
        console.warn('[tab-tree] auto summary skipped', error);
      }
    }
  }
}

async function startNewSession(): Promise<void> {
  const persisted = await readState();
  if (persisted.sessionId) {
    const session = await db.sessions.get(persisted.sessionId);
    if (session) await db.sessions.put({ ...session, endedAt: Date.now() });
  }
  await writeState({ sessionId: null, lastActivityAt: 0, pointers: {} });
}

async function refreshBadge(): Promise<void> {
  const settings = await getSettings();
  await chrome.action.setBadgeBackgroundColor({ color: settings.recordingPaused ? '#da3633' : '#1f6feb' });
  await chrome.action.setBadgeText({ text: settings.recordingPaused ? 'II' : '' });
  await chrome.action.setTitle({
    title: settings.recordingPaused ? 'Tab Tree — recording paused' : 'Tab Tree — recording',
  });
}

async function handleMessage(
  message: BackgroundMessage,
  sender: chrome.runtime.MessageSender,
): Promise<{ ok: boolean; error?: string }> {
  switch (message.type) {
    case 'focus/flush':
      await handleFocusFlush(sender.tab?.id, message.payload);
      return { ok: true };
    case 'recording/set':
      await saveSettings({ recordingPaused: message.paused });
      await refreshBadge();
      return { ok: true };
    case 'session/new':
      await startNewSession();
      return { ok: true };
  }
}

export default defineBackground(() => {
  void ensureBuiltinFlags();
  void refreshBadge();
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.warn('[tab-tree] side panel behaviour', error));

  chrome.runtime.onInstalled.addListener(() => {
    void ensureBuiltinFlags();
    void refreshBadge();
  });

  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) return;
    void enqueue(() =>
      handleNavigation({
        kind: 'committed',
        tabId: details.tabId,
        url: details.url,
        timestamp: Date.now(),
        transitionType: details.transitionType,
        transitionQualifiers: details.transitionQualifiers,
        frameId: details.frameId,
      }),
    );
  });

  chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
    recentTargets.set(details.tabId, { url: details.url, at: Date.now() });
    void enqueue(() =>
      handleNavigation({
        kind: 'created-target',
        tabId: details.tabId,
        sourceTabId: details.sourceTabId,
        url: details.url,
        timestamp: Date.now(),
      }),
    );
  });

  chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (details.frameId !== 0) return;
    void enqueue(() =>
      handleNavigation({
        kind: 'history-state',
        tabId: details.tabId,
        url: details.url,
        timestamp: Date.now(),
        transitionType: details.transitionType,
        frameId: details.frameId,
      }),
    );
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!changeInfo.title && !changeInfo.favIconUrl) return;
    void updateNodeMeta(tabId, changeInfo.title, changeInfo.favIconUrl);
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void enqueue(async () => {
      const persisted = await readState();
      const state: ResolveState = {
        now: Date.now(),
        idleMs: 0,
        session: null,
        lastActivityAt: persisted.lastActivityAt,
        pointer: persisted.pointers,
        nodesByUrl: {},
        nodesById: {},
        id: newNodeId,
      };
      const next = dropTab(state, tabId);
      await writeState({
        sessionId: persisted.sessionId,
        lastActivityAt: persisted.lastActivityAt,
        pointers: next.pointer,
      });
    });
  });

  chrome.runtime.onMessage.addListener(
    (message: BackgroundMessage, sender, sendResponse: (response: unknown) => void) => {
      if (
        message.type !== 'focus/flush' &&
        message.type !== 'recording/set' &&
        message.type !== 'session/new'
      ) {
        return false;
      }
      void handleMessage(message, sender)
        .then((result) => sendResponse(result))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          sendResponse({ ok: false, error: message });
        });
      return true;
    },
  );
});

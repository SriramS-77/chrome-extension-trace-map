import { createSession, isIdleExpired } from './sessions';
import type { Edge, EdgeType, Session, TabNode } from '../shared/types';
import { isSkippableUrl, normalizeUrl } from '../shared/urls';

export const DEFAULT_SESSION_TITLE = 'Untitled session';

export interface ResolveState {
  now: number;
  idleMs: number;
  /** Current session, or null when there is none yet. */
  session: Session | null;
  /** Last navigation event timestamp for the current session. */
  lastActivityAt: number;
  /** tabId -> node id, mirrored in chrome.storage.session. */
  pointer: Record<number, string>;
  /** normalizedUrl -> node, for the current session only. */
  nodesByUrl: Record<string, TabNode>;
  nodesById: Record<string, TabNode>;
  /** Injected so tests are deterministic. */
  id: () => string;
}

export interface NavigationInput {
  kind: 'committed' | 'created-target' | 'history-state';
  tabId: number;
  url: string;
  timestamp: number;
  sourceTabId?: number;
  transitionType?: string;
  transitionQualifiers?: string[];
  frameId?: number;
}

export type ResolverAction =
  | { type: 'start-session'; session: Session }
  | { type: 'create-node'; node: TabNode; edge: Edge | null }
  | { type: 'reuse-node'; nodeId: string; edge: Edge | null; at: number }
  | { type: 'increment-visit'; nodeId: string; at: number };

export type SkipReason = 'subframe' | 'unsupported-url';

export interface ResolveResult {
  startSession: Session | null;
  actions: ResolverAction[];
  skip?: SkipReason;
}

const TYPED_TRANSITIONS = new Set(['typed', 'auto_bookmark', 'generated', 'start_page']);
const LINK_TRANSITIONS = new Set(['link', 'form_submit', 'auto_toplevel']);

function edgeId(state: ResolveState, from: string, to: string): string {
  return `${from}:${to}:${state.id()}`;
}

function makeEdge(
  state: ResolveState,
  sessionId: string,
  from: string,
  to: string,
  type: EdgeType,
): Edge {
  return { id: edgeId(state, from, to), sessionId, from, to, type };
}

function makeNode(
  state: ResolveState,
  sessionId: string,
  parentId: string | null,
  input: NavigationInput,
  normalizedUrl: string,
): TabNode {
  return {
    id: state.id(),
    sessionId,
    parentId,
    url: input.url,
    normalizedUrl,
    title: '',
    tabId: input.tabId,
    createdAt: input.timestamp,
    lastVisitedAt: input.timestamp,
    visitCount: 1,
    flags: [],
    note: '',
  };
}

/**
 * Pure tree-building step: given a navigation event and the current session
 * state, decide whether to start a session, create a node, reuse a node or
 * only move the current-node pointer.
 */
export function resolve(input: NavigationInput, state: ResolveState): ResolveResult {
  if (input.frameId !== undefined && input.frameId !== 0) {
    return { startSession: null, actions: [], skip: 'subframe' };
  }
  const normalizedUrl = normalizeUrl(input.url);
  if (!normalizedUrl || isSkippableUrl(input.url)) {
    return { startSession: null, actions: [], skip: 'unsupported-url' };
  }

  const idle = !state.session || isIdleExpired(state.lastActivityAt, input.timestamp, state.idleMs);
  const startSession = idle
    ? createSession(input.timestamp, state.id, DEFAULT_SESSION_TITLE)
    : null;
  const session = startSession ?? state.session;
  if (!session) throw new Error('resolve: a session must exist after the idle check');
  const sessionId = session.id;

  const actions: ResolverAction[] = [];
  if (startSession) actions.push({ type: 'start-session', session: startSession });

  // A new session starts with an empty tree: pointers from the previous
  // session must never become parents in it.
  const pointerId = idle ? undefined : state.pointer[input.tabId];
  const pointerNode = pointerId ? state.nodesById[pointerId] : undefined;
  const existing = idle ? undefined : state.nodesByUrl[normalizedUrl];
  const qualifiers = input.transitionQualifiers ?? [];

  // Reload: no new node, just another visit of the same page.
  if (input.kind === 'committed' && input.transitionType === 'reload' && pointerNode) {
    actions.push({ type: 'increment-visit', nodeId: pointerNode.id, at: input.timestamp });
    return { startSession, actions };
  }

  // Back / forward: move the pointer to the node that already exists.
  if (qualifiers.includes('forward_back') && existing) {
    const type: EdgeType =
      pointerNode && existing.id === pointerNode.parentId
        ? 'back'
        : pointerNode && existing.parentId === pointerNode.id
          ? 'forward'
          : 'forward';
    const edge =
      pointerNode && pointerNode.id !== existing.id
        ? makeEdge(state, sessionId, pointerNode.id, existing.id, type)
        : null;
    actions.push({ type: 'reuse-node', nodeId: existing.id, edge, at: input.timestamp });
    return { startSession, actions };
  }

  // A URL already seen in this session is never duplicated.
  if (existing) {
    const edge =
      pointerNode && pointerNode.id !== existing.id
        ? makeEdge(state, sessionId, pointerNode.id, existing.id, 'revisit')
        : null;
    actions.push({ type: 'reuse-node', nodeId: existing.id, edge, at: input.timestamp });
    return { startSession, actions };
  }

  let parentId: string | null = pointerNode?.id ?? null;
  let type: EdgeType = 'link';

  if (input.kind === 'created-target') {
    const sourceId =
      idle || input.sourceTabId === undefined ? undefined : state.pointer[input.sourceTabId];
    parentId = sourceId ?? null;
    type = 'new-tab';
  } else if (input.kind === 'history-state') {
    parentId = pointerNode?.id ?? null;
    type = 'spa';
  } else {
    const transition = input.transitionType ?? '';
    if (TYPED_TRANSITIONS.has(transition)) {
      parentId = null;
      type = 'typed';
    } else if (LINK_TRANSITIONS.has(transition)) {
      parentId = pointerNode?.id ?? null;
      type = 'link';
    } else if (!pointerNode) {
      parentId = null;
      type = 'typed';
    }
  }

  const node = makeNode(state, sessionId, parentId, input, normalizedUrl);
  const edge = parentId ? makeEdge(state, sessionId, parentId, node.id, type) : null;
  actions.push({ type: 'create-node', node, edge });
  return { startSession, actions };
}

/** Apply a resolver action to an in-memory state, so background and tests share one truth. */
export function applyAction(state: ResolveState, action: ResolverAction): ResolveState {
  switch (action.type) {
    case 'start-session':
      return {
        ...state,
        session: action.session,
        lastActivityAt: action.session.startedAt,
        nodesByUrl: {},
        nodesById: {},
        pointer: {},
      };
    case 'create-node': {
      const { node } = action;
      return {
        ...state,
        lastActivityAt: node.createdAt,
        nodesById: { ...state.nodesById, [node.id]: node },
        nodesByUrl: { ...state.nodesByUrl, [node.normalizedUrl]: node },
        pointer: { ...state.pointer, [node.tabId]: node.id },
      };
    }
    case 'reuse-node': {
      const node = state.nodesById[action.nodeId];
      if (!node) return state;
      const updated: TabNode = {
        ...node,
        lastVisitedAt: action.at,
        visitCount: node.visitCount + 1,
      };
      const tabId = node.tabId;
      return {
        ...state,
        lastActivityAt: action.at,
        nodesById: { ...state.nodesById, [node.id]: updated },
        nodesByUrl: { ...state.nodesByUrl, [updated.normalizedUrl]: updated },
        pointer: { ...state.pointer, [tabId]: updated.id },
      };
    }
    case 'increment-visit': {
      const node = state.nodesById[action.nodeId];
      if (!node) return state;
      const updated: TabNode = {
        ...node,
        lastVisitedAt: action.at,
        visitCount: node.visitCount + 1,
      };
      return {
        ...state,
        lastActivityAt: action.at,
        nodesById: { ...state.nodesById, [node.id]: updated },
        nodesByUrl: { ...state.nodesByUrl, [updated.normalizedUrl]: updated },
      };
    }
  }
}

/** Remove a tab from the pointer map; node history stays. */
export function dropTab(state: ResolveState, tabId: number): ResolveState {
  if (!(tabId in state.pointer)) return state;
  const pointer = { ...state.pointer };
  delete pointer[tabId];
  return { ...state, pointer };
}

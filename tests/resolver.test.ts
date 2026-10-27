import { describe, expect, it } from 'vitest';
import {
  applyAction,
  dropTab,
  resolve,
  type NavigationInput,
  type ResolveState,
  type ResolverAction,
} from '../src/tree/resolver';
import { idleMsFromMinutes } from '../src/tree/sessions';
import type { EdgeType } from '../src/shared/types';

const IDLE = idleMsFromMinutes(30);

function baseState(overrides: Partial<ResolveState> = {}): ResolveState {
  let counter = 0;
  return {
    now: 1_000,
    idleMs: IDLE,
    session: null,
    lastActivityAt: 0,
    pointer: {},
    nodesByUrl: {},
    nodesById: {},
    id: () => `id-${++counter}`,
    ...overrides,
  };
}

function nav(overrides: Partial<NavigationInput>): NavigationInput {
  return {
    kind: 'committed',
    tabId: 1,
    url: 'https://example.com/',
    timestamp: 1_000,
    transitionType: 'link',
    transitionQualifiers: [],
    frameId: 0,
    ...overrides,
  };
}

/** Run one navigation and return the state plus the edge type it created. */
function step(state: ResolveState, input: NavigationInput) {
  const result = resolve(input, state);
  let next = state;
  for (const action of result.actions) next = applyAction(next, action);
  const edgeAction = result.actions.find(
    (action): action is Extract<ResolverAction, { type: 'create-node' | 'reuse-node' }> =>
      (action.type === 'create-node' || action.type === 'reuse-node') && action.edge !== null,
  );
  const edgeType = edgeAction?.edge?.type as EdgeType | undefined;
  return { state: next, result, edgeType };
}

describe('resolve', () => {
  it('creates a root node for a typed URL in a fresh session', () => {
    const { state, result, edgeType } = step(
      baseState(),
      nav({ transitionType: 'typed', timestamp: 5_000 }),
    );
    expect(result.startSession).not.toBeNull();
    const created = state.nodesByUrl['https://example.com'];
    expect(created?.parentId).toBeNull();
    expect(state.session?.id).toBe(created?.sessionId);
    expect(edgeType).toBeUndefined();
  });

  it('creates a child with a link edge for a same-tab link click', () => {
    const first = step(baseState(), nav({ url: 'https://example.com/a', timestamp: 1_000 }));
    expect(first.state.session).not.toBeNull();
    const second = step(first.state, nav({ url: 'https://example.com/b', timestamp: 2_000 }));
    const parent = first.state.nodesByUrl['https://example.com/a'];
    const child = second.state.nodesByUrl['https://example.com/b'];
    expect(child?.parentId).toBe(parent?.id);
    expect(second.edgeType).toBe('link');
  });

  it('parents a new tab under the source tab current node with a new-tab edge', () => {
    const first = step(baseState(), nav({ url: 'https://example.com/a', timestamp: 1_000 }));
    const source = first.state.nodesByUrl['https://example.com/a'];
    const { state, edgeType } = step(
      first.state,
      nav({
        kind: 'created-target',
        tabId: 2,
        sourceTabId: 1,
        url: 'https://example.com/b',
        timestamp: 2_000,
      }),
    );
    expect(state.nodesByUrl['https://example.com/b']?.parentId).toBe(source?.id);
    expect(edgeType).toBe('new-tab');
  });

  it('creates an spa child on a history state update', () => {
    const first = step(baseState(), nav({ url: 'https://app.test/one', timestamp: 1_000 }));
    const { state, edgeType } = step(
      first.state,
      nav({ kind: 'history-state', url: 'https://app.test/two', timestamp: 2_000 }),
    );
    expect(state.nodesByUrl['https://app.test/two']?.parentId).toBe(
      first.state.nodesByUrl['https://app.test/one']?.id,
    );
    expect(edgeType).toBe('spa');
  });

  it('moves the pointer back instead of creating a node', () => {
    const a = step(baseState(), nav({ url: 'https://example.com/a', timestamp: 1_000 }));
    const b = step(a.state, nav({ url: 'https://example.com/b', timestamp: 2_000 }));
    const back = step(
      b.state,
      nav({
        url: 'https://example.com/a',
        timestamp: 3_000,
        transitionType: 'link',
        transitionQualifiers: ['forward_back'],
      }),
    );
    expect(back.result.actions.some((action) => action.type === 'create-node')).toBe(false);
    expect(back.edgeType).toBe('back');
    expect(back.state.pointer[1]).toBe(a.state.nodesByUrl['https://example.com/a']?.id);
    expect(back.state.nodesByUrl['https://example.com/b']).toBeDefined();
  });

  it('moves the pointer forward to an existing child', () => {
    const a = step(baseState(), nav({ url: 'https://example.com/a', timestamp: 1_000 }));
    const b = step(a.state, nav({ url: 'https://example.com/b', timestamp: 2_000 }));
    const back = step(
      b.state,
      nav({
        url: 'https://example.com/a',
        timestamp: 3_000,
        transitionQualifiers: ['forward_back'],
      }),
    );
    const forward = step(
      back.state,
      nav({
        url: 'https://example.com/b',
        timestamp: 4_000,
        transitionQualifiers: ['forward_back'],
      }),
    );
    expect(forward.edgeType).toBe('forward');
    expect(forward.state.pointer[1]).toBe(b.state.nodesByUrl['https://example.com/b']?.id);
  });

  it('only increments visits on reload', () => {
    const first = step(baseState(), nav({ url: 'https://example.com/a', timestamp: 1_000 }));
    const reload = step(
      first.state,
      nav({ url: 'https://example.com/a', timestamp: 2_000, transitionType: 'reload' }),
    );
    const node = reload.state.nodesByUrl['https://example.com/a'];
    expect(reload.result.actions.map((action) => action.type)).toEqual(['increment-visit']);
    expect(node?.visitCount).toBe(2);
    expect(Object.keys(reload.state.nodesById)).toHaveLength(1);
  });

  it('reuses an existing URL and records a revisit edge', () => {
    const a = step(baseState(), nav({ url: 'https://example.com/a', timestamp: 1_000 }));
    const b = step(a.state, nav({ url: 'https://example.com/b', timestamp: 2_000 }));
    const revisit = step(
      b.state,
      nav({ url: 'https://example.com/a?utm_source=newsletter', timestamp: 3_000 }),
    );
    expect(revisit.edgeType).toBe('revisit');
    expect(revisit.state.pointer[1]).toBe(a.state.nodesByUrl['https://example.com/a']?.id);
    expect(Object.keys(revisit.state.nodesByUrl)).toHaveLength(2);
  });

  it('starts a new session after the idle limit', () => {
    const first = step(baseState(), nav({ url: 'https://example.com/a', timestamp: 1_000 }));
    const later = step(
      first.state,
      nav({ url: 'https://example.com/b', timestamp: 1_000 + IDLE + 1 }),
    );
    expect(later.result.startSession).not.toBeNull();
    expect(later.result.startSession?.id).not.toBe(first.state.session?.id);
    expect(later.state.nodesByUrl['https://example.com/b']?.parentId).toBeNull();
  });

  it('starts a new session for a typed root after the idle limit', () => {
    const first = step(baseState(), nav({ url: 'https://example.com/a', timestamp: 1_000 }));
    const typed = step(
      first.state,
      nav({
        url: 'https://example.com/typed',
        timestamp: 1_000 + IDLE + 5,
        transitionType: 'typed',
      }),
    );
    expect(typed.result.startSession).not.toBeNull();
    expect(typed.state.nodesByUrl['https://example.com/typed']?.parentId).toBeNull();
  });

  it('ignores subframes and browser internal pages', () => {
    const frame = resolve(nav({ frameId: 7 }), baseState());
    expect(frame.skip).toBe('subframe');
    const internal = resolve(nav({ url: 'chrome://settings' }), baseState());
    expect(internal.skip).toBe('unsupported-url');
    const store = resolve(nav({ url: 'https://chromewebstore.google.com/detail/x' }), baseState());
    expect(store.skip).toBe('unsupported-url');
  });

  it('drops a closed tab from the pointer map but keeps nodes', () => {
    const first = step(baseState(), nav({ tabId: 3, timestamp: 1_000 }));
    expect(first.state.pointer[3]).toBeDefined();
    const next = dropTab(first.state, 3);
    expect(next.pointer[3]).toBeUndefined();
    expect(Object.keys(next.nodesById)).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import { buildSessionExport, buildSessionJson, buildSessionMarkdown } from '../src/shared/export';
import { nodeDepths, orderNodes } from '../src/tree/order';
import type { TabNode } from '../src/shared/types';

function node(partial: Partial<TabNode> & Pick<TabNode, 'id' | 'parentId'>): TabNode {
  return {
    sessionId: 's1',
    url: `https://example.com/${partial.id}`,
    normalizedUrl: `https://example.com/${partial.id}`,
    title: partial.id.toUpperCase(),
    tabId: 1,
    createdAt: 1,
    lastVisitedAt: 1,
    visitCount: 1,
    flags: [],
    note: '',
    ...partial,
  };
}

const root = node({ id: 'root', parentId: null, createdAt: 1 });
const child = node({ id: 'child', parentId: 'root', createdAt: 2, note: 'Key point' });
const grandchild = node({ id: 'grand', parentId: 'child', createdAt: 3 });
const otherRoot = node({ id: 'other', parentId: null, createdAt: 4 });

const bundle = {
  session: { id: 's1', title: 'Research session', startedAt: 0, endedAt: 10 },
  nodes: [grandchild, child, otherRoot, root],
  edges: [],
  flags: [{ id: 'research', name: 'Research', color: '#fff', builtin: true }],
};

describe('orderNodes', () => {
  it('walks breadth-first from roots, oldest first', () => {
    expect(orderNodes(bundle.nodes).map((item) => item.id)).toEqual([
      'root',
      'other',
      'child',
      'grand',
    ]);
  });

  it('computes depths', () => {
    const depths = nodeDepths(bundle.nodes);
    expect(depths.get('root')).toBe(0);
    expect(depths.get('child')).toBe(1);
    expect(depths.get('grand')).toBe(2);
  });

  it('keeps nodes whose parent is missing', () => {
    const orphan = node({ id: 'orphan', parentId: 'gone', createdAt: 5 });
    expect(orderNodes([orphan]).map((item) => item.id)).toEqual(['orphan']);
  });
});

describe('buildSessionMarkdown', () => {
  it('writes an indented outline with notes', () => {
    const markdown = buildSessionMarkdown(bundle);
    expect(markdown).toContain('# Research session');
    expect(markdown).toContain('- [ROOT](https://example.com/root)');
    expect(markdown).toContain('  - [CHILD](https://example.com/child)');
    expect(markdown).toContain('    - [GRAND](https://example.com/grand)');
    expect(markdown).toContain('Note: Key point');
  });

  it('includes summaries and flags', () => {
    const flagged = node({
      id: 'flagged',
      parentId: null,
      flags: ['research'],
      summary: {
        text: 'A summary.',
        focusText: 'Read the intro.',
        provider: 'gemini',
        model: 'm',
        contentHash: 'h',
        createdAt: 1,
      },
    });
    const markdown = buildSessionMarkdown({ ...bundle, nodes: [flagged] });
    expect(markdown).toContain('Flags: Research');
    expect(markdown).toContain('Summary (gemini): A summary.');
    expect(markdown).toContain('Focus: Read the intro.');
  });
});

describe('buildSessionJson', () => {
  it('exports a versioned, self-contained bundle', () => {
    const parsed = JSON.parse(buildSessionJson(bundle, 123)) as ReturnType<typeof buildSessionExport>;
    expect(parsed.format).toBe('tab-tree-session');
    expect(parsed.version).toBe(1);
    expect(parsed.exportedAt).toBe(123);
    expect(parsed.nodes).toHaveLength(4);
  });
});

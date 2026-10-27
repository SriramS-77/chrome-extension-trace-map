import type { TabNode } from '../shared/types';

/** Breadth-first order from the roots, stable for a given session. */
export function orderNodes(nodes: readonly TabNode[]): TabNode[] {
  const byParent = new Map<string | null, TabNode[]>();
  for (const node of nodes) {
    const key = node.parentId ?? null;
    const list = byParent.get(key);
    if (list) list.push(node);
    else byParent.set(key, [node]);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  const known = new Set(nodes.map((node) => node.id));
  const ordered: TabNode[] = [];
  const queue: TabNode[] = [];
  // Roots, plus orphaned nodes whose parent is not in this session.
  for (const node of nodes) {
    if (node.parentId === null || !known.has(node.parentId)) queue.push(node);
  }
  queue.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

  const seen = new Set<string>();
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || seen.has(node.id)) continue;
    seen.add(node.id);
    ordered.push(node);
    const children = byParent.get(node.id) ?? [];
    queue.push(...children);
  }
  // Defensive: include anything left over (cycles) so nothing is lost.
  for (const node of nodes) if (!seen.has(node.id)) ordered.push(node);
  return ordered;
}

/** Depth of each node in the tree, for indented exports. */
export function nodeDepths(nodes: readonly TabNode[]): Map<string, number> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const depths = new Map<string, number>();
  for (const node of nodes) {
    let depth = 0;
    let cursor = node.parentId;
    const guard = new Set<string>([node.id]);
    while (cursor) {
      const parent = byId.get(cursor);
      if (!parent || guard.has(parent.id)) break;
      guard.add(parent.id);
      depth += 1;
      cursor = parent.parentId;
    }
    depths.set(node.id, depth);
  }
  return depths;
}

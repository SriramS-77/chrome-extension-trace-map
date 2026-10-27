import { db } from '../shared/db';
import type { Flag, TabNode } from '../shared/types';

const FLAG_COLORS = ['#2f81f7', '#f778ba', '#e3b341', '#3fb950', '#a371f7', '#ff7b72'];

export async function patchNote(nodeId: string, note: string): Promise<void> {
  await db.nodes.update(nodeId, { note });
}

export async function patchFlags(nodeId: string, flags: string[]): Promise<void> {
  await db.nodes.update(nodeId, { flags });
}

export async function createFlag(name: string, color?: string): Promise<Flag> {
  const clean = name.trim();
  if (!clean) throw new Error('Flag name is required.');
  const existing = (await db.flags.toArray()).find(
    (flag) => flag.name.toLowerCase() === clean.toLowerCase(),
  );
  if (existing) return existing;
  const used = await db.flags.count();
  const flag: Flag = {
    id: crypto.randomUUID(),
    name: clean,
    color: color ?? FLAG_COLORS[used % FLAG_COLORS.length] ?? '#2f81f7',
    builtin: false,
  };
  await db.flags.put(flag);
  return flag;
}

export async function deleteNode(node: TabNode): Promise<void> {
  await db.transaction('rw', db.nodes, db.edges, db.pageText, async () => {
    await db.nodes.delete(node.id);
    await db.pageText.delete(node.id);
    await db.edges.where('from').equals(node.id).delete();
    await db.edges.where('to').equals(node.id).delete();
    // Re-parent children to keep the tree readable; roots otherwise.
    const children = await db.nodes.where('sessionId').equals(node.sessionId).toArray();
    for (const child of children) {
      if (child.parentId === node.id) {
        await db.nodes.update(child.id, { parentId: node.parentId });
      }
    }
  });
}

export function nodeColor(node: TabNode, flags: readonly Flag[]): string {
  const first = node.flags[0];
  if (!first) return '#30363d';
  return flags.find((flag) => flag.id === first)?.color ?? '#30363d';
}

export function nodeBadge(node: TabNode): string {
  if (node.summary) return 'AI';
  if (node.note.trim()) return 'note';
  return '';
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

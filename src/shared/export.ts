import type { Edge, Flag, Session, TabNode } from '../shared/types';
import { nodeDepths, orderNodes } from '../tree/order';

export interface SessionBundle {
  session: Session;
  nodes: TabNode[];
  edges: Edge[];
  flags: Flag[];
}

export interface SessionExport extends SessionBundle {
  exportedAt: number;
  format: 'tab-tree-session';
  version: 1;
}

export function buildSessionExport(bundle: SessionBundle, exportedAt = Date.now()): SessionExport {
  return { format: 'tab-tree-session', version: 1, exportedAt, ...bundle };
}

export function buildSessionJson(bundle: SessionBundle, exportedAt = Date.now()): string {
  return JSON.stringify(buildSessionExport(bundle, exportedAt), null, 2);
}

function flagNames(ids: readonly string[], flags: readonly Flag[]): string[] {
  return ids
    .map((id) => flags.find((flag) => flag.id === id)?.name)
    .filter((name): name is string => Boolean(name));
}

/** Indented outline of the tree with titles, links, flags, notes and summaries. */
export function buildSessionMarkdown(bundle: SessionBundle): string {
  const { session, nodes, flags } = bundle;
  const ordered = orderNodes(nodes);
  const depths = nodeDepths(nodes);
  const lines: string[] = [`# ${session.title}`, ''];

  const started = new Date(session.startedAt).toISOString();
  const ended = session.endedAt ? new Date(session.endedAt).toISOString() : 'open';
  lines.push(`- Started: ${started}`, `- Ended: ${ended}`, `- Pages: ${nodes.length}`, '');

  for (const node of ordered) {
    const indent = '  '.repeat(depths.get(node.id) ?? 0);
    const title = node.title || node.normalizedUrl;
    lines.push(`${indent}- [${escapeMarkdown(title)}](${node.url})`);
    const names = flagNames(node.flags, flags);
    if (names.length > 0) lines.push(`${indent}  - Flags: ${names.join(', ')}`);
    if (node.note.trim()) {
      for (const noteLine of node.note.trim().split('\n')) {
        lines.push(`${indent}  - Note: ${noteLine}`);
      }
    }
    if (node.summary) {
      lines.push(`${indent}  - Summary (${node.summary.provider}): ${node.summary.text}`);
      if (node.summary.focusText) {
        lines.push(`${indent}  - Focus: ${node.summary.focusText}`);
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\[\]])/g, '\\$1');
}

export function downloadText(filename: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function safeFilename(title: string, extension: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'session'}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

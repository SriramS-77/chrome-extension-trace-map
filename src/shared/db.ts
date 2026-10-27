import Dexie, { type Table } from 'dexie';
import type {
  Edge,
  Flag,
  PageText,
  Session,
  Settings,
  TabNode,
} from './types';
import { DEFAULT_SETTINGS } from './types';

export interface SettingRow {
  key: string;
  value: unknown;
}

export const BUILTIN_FLAGS: Flag[] = [
  { id: 'research', name: 'Research', color: '#2f81f7', builtin: true },
  { id: 'entertainment', name: 'Entertainment', color: '#f778ba', builtin: true },
  { id: 'read-later', name: 'Read later', color: '#e3b341', builtin: true },
  { id: 'reference', name: 'Reference', color: '#3fb950', builtin: true },
];

export class TabTreeDB extends Dexie {
  sessions!: Table<Session, string>;
  nodes!: Table<TabNode, string>;
  edges!: Table<Edge, string>;
  flags!: Table<Flag, string>;
  pageText!: Table<PageText, string>;
  settings!: Table<SettingRow, string>;

  constructor(name = 'tab-tree') {
    super(name);
    // Schema versions from day one: later changes are migrations, not wipes.
    this.version(1).stores({
      sessions: 'id, startedAt',
      nodes: 'id, sessionId, normalizedUrl, tabId, [sessionId+normalizedUrl]',
      edges: 'id, sessionId, from, to',
      flags: 'id',
      pageText: 'nodeId',
      settings: 'key',
    });
    this.on('populate', () => {
      void this.flags.bulkPut(BUILTIN_FLAGS);
    });
  }
}

export const db = new TabTreeDB();

export async function ensureBuiltinFlags(): Promise<void> {
  const count = await db.flags.count();
  if (count === 0) await db.flags.bulkPut(BUILTIN_FLAGS);
}

export async function getSettings(): Promise<Settings> {
  const row = await db.settings.get('app');
  if (!row || typeof row.value !== 'object' || row.value === null) {
    return { ...DEFAULT_SETTINGS };
  }
  return { ...DEFAULT_SETTINGS, ...(row.value as Partial<Settings>) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await db.settings.put({ key: 'app', value: next });
  return next;
}

export async function deleteSessionCascade(sessionId: string): Promise<void> {
  await db.transaction('rw', db.sessions, db.nodes, db.edges, db.pageText, async () => {
    const nodeIds = await db.nodes.where('sessionId').equals(sessionId).primaryKeys();
    await db.pageText.bulkDelete(nodeIds);
    await db.nodes.where('sessionId').equals(sessionId).delete();
    await db.edges.where('sessionId').equals(sessionId).delete();
    await db.sessions.delete(sessionId);
  });
}

export async function deleteAllData(): Promise<void> {
  await db.transaction('rw', db.sessions, db.nodes, db.edges, db.pageText, async () => {
    await Promise.all([
      db.sessions.clear(),
      db.nodes.clear(),
      db.edges.clear(),
      db.pageText.clear(),
    ]);
  });
  await db.transaction('rw', db.flags, db.settings, async () => {
    await db.flags.clear();
    await db.settings.clear();
    await db.flags.bulkPut(BUILTIN_FLAGS);
  });
}

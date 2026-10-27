import { useEffect, useState } from 'react';
import { db, getSettings } from '../shared/db';
import { DEFAULT_SETTINGS } from '../shared/types';
import type { Edge, Flag, Session, Settings, TabNode } from '../shared/types';
import { orderNodes } from '../tree/order';

export interface LiveData {
  session: Session | null;
  nodes: TabNode[];
  edges: Edge[];
  flags: Flag[];
  settings: Settings;
}

export async function loadLatestSession(): Promise<Session | null> {
  const sessions = await db.sessions.orderBy('startedAt').reverse().limit(1).toArray();
  return sessions[0] ?? null;
}

/**
 * Poll the database: the service worker writes from another context, so Dexie
 * change events do not cross over. 900 ms keeps the live graph fresh.
 */
export function useLiveSession(sessionId: string | null, pollMs = 900): LiveData & {
  reload: () => void;
} {
  const [data, setData] = useState<LiveData>({
    session: null,
    nodes: [],
    edges: [],
    flags: [],
    settings: DEFAULT_SETTINGS,
  });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const [session, flags, settings] = await Promise.all([
          sessionId ? db.sessions.get(sessionId) : loadLatestSession(),
          db.flags.toArray(),
          getSettings(),
        ]);
        const activeId = session?.id ?? null;
        const [nodes, edges] = activeId
          ? await Promise.all([
              db.nodes.where('sessionId').equals(activeId).toArray(),
              db.edges.where('sessionId').equals(activeId).toArray(),
            ])
          : [[], []];
        if (!cancelled) {
          setData({
            session: session ?? null,
            nodes: orderNodes(nodes),
            edges,
            flags,
            settings,
          });
        }
      } finally {
        inFlight = false;
      }
    };

    void load();
    const timer = setInterval(() => void load(), pollMs);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [sessionId, pollMs, reloadKey]);

  return { ...data, reload: () => setReloadKey((value) => value + 1) };
}

export function useSessions(pollMs = 2000): {
  sessions: Session[];
  counts: Record<string, number>;
  reload: () => void;
} {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const list = await db.sessions.orderBy('startedAt').reverse().toArray();
      const entries = await Promise.all(
        list.map(async (session) => {
          const count = await db.nodes.where('sessionId').equals(session.id).count();
          return [session.id, count] as const;
        }),
      );
      if (!cancelled) {
        setSessions(list);
        setCounts(Object.fromEntries(entries));
      }
    };
    void load();
    const timer = setInterval(() => void load(), pollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pollMs, reloadKey]);

  return { sessions, counts, reload: () => setReloadKey((value) => value + 1) };
}

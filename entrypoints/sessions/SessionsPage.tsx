import { useMemo, useState } from 'react';
import { Graph } from '../../src/ui/Graph';
import { NodePanel } from '../../src/ui/NodePanel';
import { useLiveSession, useSessions } from '../../src/ui/data';
import { createFlag, deleteNode, patchFlags, patchNote } from '../../src/ui/nodeActions';
import { db, deleteSessionCascade } from '../../src/shared/db';
import {
  buildSessionJson,
  buildSessionMarkdown,
  downloadText,
  safeFilename,
  type SessionBundle,
} from '../../src/shared/export';
import { prepareChromeSummarizer } from '../../src/ai/chromeBuiltin';
import { summarizeNode, summarizeSession, SummarySetupError } from '../../src/ai/summarize';
import type { TabNode } from '../../src/shared/types';

export function SessionsPage() {
  const { sessions, counts, reload: reloadList } = useSessions();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const { session, nodes, edges, flags, reload } = useLiveSession(selectedSessionId);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeFlags, setActiveFlags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupIssue, setSetupIssue] = useState<'needs-download' | 'needs-setup' | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [sessionSummary, setSessionSummary] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);

  const filteredNodes = useMemo(() => {
    const query = search.trim().toLowerCase();
    return nodes.filter((node) => {
      const matchesFlags =
        activeFlags.length === 0 || activeFlags.every((flagId) => node.flags.includes(flagId));
      if (!matchesFlags) return false;
      if (!query) return true;
      return [node.url, node.title, node.note, node.summary?.text ?? '', node.summary?.focusText ?? '']
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [nodes, activeFlags, search]);

  const visibleIds = useMemo(() => new Set(filteredNodes.map((node) => node.id)), [filteredNodes]);
  const visibleEdges = useMemo(
    () => edges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to)),
    [edges, visibleIds],
  );
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;

  const openSession = (id: string) => {
    setSelectedSessionId(id);
    setSelectedNodeId(null);
    setSessionSummary(null);
    setSearch('');
    setActiveFlags([]);
    setTitleDraft(null);
  };

  const bundle = async (): Promise<SessionBundle | null> => {
    if (!session) return null;
    const [allNodes, allEdges, allFlags] = await Promise.all([
      db.nodes.where('sessionId').equals(session.id).toArray(),
      db.edges.where('sessionId').equals(session.id).toArray(),
      db.flags.toArray(),
    ]);
    return { session, nodes: allNodes, edges: allEdges, flags: allFlags };
  };

  const exportSession = async (format: 'json' | 'md') => {
    const data = await bundle();
    if (!data) return;
    const contents =
      format === 'json' ? buildSessionJson(data) : buildSessionMarkdown(data);
    downloadText(
      safeFilename(data.session.title, format === 'json' ? 'json' : 'md'),
      contents,
      format === 'json' ? 'application/json' : 'text/markdown',
    );
  };

  const runSummary = async (nodeId: string, force: boolean) => {
    setBusy(true);
    setError(null);
    setSetupIssue(null);
    try {
      await summarizeNode(nodeId, { force });
      reload();
    } catch (cause) {
      if (cause instanceof SummarySetupError) {
        setSetupIssue(cause.reason);
        setError(cause.message);
      } else {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const downloadModel = async () => {
    setProgress(0);
    setError(null);
    try {
      await prepareChromeSummarizer((loaded) => setProgress(Math.min(1, Math.max(0, loaded))));
      setSetupIssue(null);
      if (selectedNodeId) await runSummary(selectedNodeId, false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 10 }}>
        <h1 style={{ margin: 0 }}>Tab Tree sessions</h1>
        <span className="muted small">{sessions.length} sessions</span>
      </div>

      <div className="split">
        <aside className="sidebar">
          {sessions.length === 0 && (
            <div className="empty small">No sessions yet. Browse with Tab Tree recording.</div>
          )}
          {sessions.map((item) => (
            <div
              key={item.id}
              className={`sidebar-item${item.id === selectedSessionId ? ' active' : ''}`}
              onClick={() => openSession(item.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter') openSession(item.id);
              }}
            >
              <div style={{ fontWeight: 600 }}>{item.title}</div>
              <div className="small muted">
                {new Date(item.startedAt).toLocaleString()} · {counts[item.id] ?? 0} pages
                {item.endedAt ? '' : ' · live'}
              </div>
            </div>
          ))}
        </aside>

        <section className="content">
          {!session && (
            <div className="card empty">
              <strong>Pick a session</strong>
              <span className="small">
                Reopen a past session to revise notes, filter by flag, search pages and export.
              </span>
            </div>
          )}

          {session && (
            <>
              <div className="card">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <input
                      value={titleDraft ?? session.title}
                      onChange={(event) => setTitleDraft(event.target.value)}
                      onBlur={() => {
                        if (titleDraft === null) return;
                        const title = titleDraft.trim();
                        if (title && title !== session.title) {
                          void db.sessions.update(session.id, { title }).then(reloadList);
                        }
                        setTitleDraft(null);
                      }}
                      aria-label="Session title"
                    />
                    <div className="small muted" style={{ marginTop: 4 }}>
                      {nodes.length} pages · started{' '}
                      {new Date(session.startedAt).toLocaleString()} ·{' '}
                      {session.endedAt ? 'ended' : 'live'}
                    </div>
                  </div>
                  <div className="row">
                    <button type="button" onClick={() => void exportSession('json')}>
                      Export JSON
                    </button>
                    <button type="button" onClick={() => void exportSession('md')}>
                      Export Markdown
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        if (!window.confirm('Delete this session and all its pages?')) return;
                        void deleteSessionCascade(session.id).then(() => {
                          setSelectedSessionId(null);
                          reloadList();
                        });
                      }}
                    >
                      Delete session
                    </button>
                  </div>
                </div>

                <div className="row" style={{ marginTop: 10 }}>
                  <input
                    style={{ flex: 1, minWidth: 160 }}
                    placeholder="Search URLs, titles, notes, summaries"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <div className="chips">
                    {flags.map((flag) => {
                      const on = activeFlags.includes(flag.id);
                      return (
                        <button
                          key={flag.id}
                          type="button"
                          className={`chip${on ? ' on' : ''}`}
                          style={{ color: flag.color }}
                          onClick={() =>
                            setActiveFlags((current) =>
                              current.includes(flag.id)
                                ? current.filter((id) => id !== flag.id)
                                : [...current, flag.id],
                            )
                          }
                        >
                          {flag.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <Graph
                nodes={filteredNodes}
                edges={visibleEdges}
                flags={flags}
                selectedId={selectedNodeId}
                onSelect={setSelectedNodeId}
              />

              <div className="row">
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    setError(null);
                    void summarizeSession(session.id)
                      .then(setSessionSummary)
                      .catch((cause: unknown) => {
                        if (cause instanceof SummarySetupError) setSetupIssue(cause.reason);
                        setError(cause instanceof Error ? cause.message : String(cause));
                      })
                      .finally(() => setBusy(false));
                  }}
                >
                  Summarize session
                </button>
                {error && <span className="small muted">{error}</span>}
              </div>

              {sessionSummary && (
                <div className="summary">
                  <strong className="small">Session summary</strong>
                  <p>{sessionSummary}</p>
                </div>
              )}

              {(filteredNodes.length !== nodes.length || search) && (
                <div className="small muted">
                  Showing {filteredNodes.length} of {nodes.length} pages
                </div>
              )}

              {selectedNode && (
                <NodePanel
                  node={selectedNode}
                  flags={flags}
                  busy={busy}
                  setupIssue={setupIssue}
                  progress={progress}
                  error={error}
                  onNote={async (nodeId, note) => {
                    await patchNote(nodeId, note);
                    reload();
                  }}
                  onFlags={async (nodeId, next) => {
                    await patchFlags(nodeId, next);
                    reload();
                  }}
                  onCreateFlag={async (name, color) => {
                    try {
                      return await createFlag(name, color);
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : String(cause));
                      return null;
                    }
                  }}
                  onDelete={async (node: TabNode) => {
                    await deleteNode(node);
                    setSelectedNodeId(null);
                    reload();
                  }}
                  onSummarize={runSummary}
                  onDownloadModel={downloadModel}
                  onClose={() => setSelectedNodeId(null)}
                />
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

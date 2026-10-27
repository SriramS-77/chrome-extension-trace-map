import { useCallback, useEffect, useMemo, useState } from 'react';
import { Graph } from '../../src/ui/Graph';
import { NodePanel } from '../../src/ui/NodePanel';
import { useLiveSession } from '../../src/ui/data';
import { createFlag, deleteNode, patchFlags, patchNote } from '../../src/ui/nodeActions';
import { summarizeNode, SummarySetupError } from '../../src/ai/summarize';
import { prepareChromeSummarizer } from '../../src/ai/chromeBuiltin';
import { sendToBackground } from '../../src/shared/messages';
import type { TabNode } from '../../src/shared/types';

export function App() {
  const { session, nodes, edges, flags, settings, reload } = useLiveSession(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupIssue, setSetupIssue] = useState<'needs-download' | 'needs-setup' | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const selected = useMemo(
    () => nodes.find((node) => node.id === selectedId) ?? null,
    [nodes, selectedId],
  );

  useEffect(() => {
    if (selectedId && !nodes.some((node) => node.id === selectedId)) setSelectedId(null);
  }, [nodes, selectedId]);

  const runSummary = useCallback(
    async (nodeId: string, force: boolean) => {
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
    },
    [reload],
  );

  const downloadModel = useCallback(async () => {
    setProgress(0);
    setError(null);
    try {
      await prepareChromeSummarizer((loaded) => setProgress(Math.min(1, Math.max(0, loaded))));
      setSetupIssue(null);
      if (selectedId) await runSummary(selectedId, false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setProgress(null);
    }
  }, [runSummary, selectedId]);

  const toggleRecording = async () => {
    await sendToBackground({ type: 'recording/set', paused: !settings.recordingPaused });
    reload();
  };

  const startSession = async () => {
    await sendToBackground({ type: 'session/new' });
    setSelectedId(null);
    reload();
  };

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <span className={`dot${settings.recordingPaused ? ' paused' : ''}`} />
          Tab Tree
        </div>
        <span className="badge">{nodes.length} pages</span>
        <button type="button" onClick={() => void toggleRecording()}>
          {settings.recordingPaused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" onClick={() => void startSession()}>
          New session
        </button>
        <button
          type="button"
          onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('sessions.html') })}
        >
          Sessions
        </button>
        <button type="button" onClick={() => void chrome.runtime.openOptionsPage()}>
          Settings
        </button>
      </header>

      {session && (
        <div className="small muted" style={{ padding: '4px 10px' }}>
          {session.title} · started {new Date(session.startedAt).toLocaleTimeString()}
          {settings.recordingPaused ? ' · recording paused' : ''}
        </div>
      )}

      <Graph nodes={nodes} edges={edges} flags={flags} selectedId={selectedId} onSelect={setSelectedId} />

      {selected ? (
        <NodePanel
          node={selected}
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
            setSelectedId(null);
            reload();
          }}
          onSummarize={runSummary}
          onDownloadModel={downloadModel}
          onClose={() => setSelectedId(null)}
        />
      ) : (
        <div className="small muted" style={{ padding: '8px 10px' }}>
          Select a node to add notes, flags and summaries. Double-click opens the tab.
        </div>
      )}
    </div>
  );
}

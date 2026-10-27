import { useEffect, useRef, useState } from 'react';
import type { Flag, TabNode } from '../shared/types';
import { formatDuration } from './nodeActions';
import { providerLabel } from '../ai/router';

export interface NodePanelProps {
  node: TabNode;
  flags: Flag[];
  busy: boolean;
  setupIssue: 'needs-download' | 'needs-setup' | null;
  progress: number | null;
  error: string | null;
  onNote: (nodeId: string, note: string) => Promise<void>;
  onFlags: (nodeId: string, flags: string[]) => Promise<void>;
  onCreateFlag: (name: string, color?: string) => Promise<Flag | null>;
  onDelete: (node: TabNode) => Promise<void>;
  onSummarize: (nodeId: string, force: boolean) => Promise<void>;
  onDownloadModel: () => Promise<void>;
  onClose?: () => void;
}

export function NodePanel({
  node,
  flags,
  busy,
  setupIssue,
  progress,
  error,
  onNote,
  onFlags,
  onCreateFlag,
  onDelete,
  onSummarize,
  onDownloadModel,
  onClose,
}: NodePanelProps) {
  const [note, setNote] = useState(node.note);
  const [newFlag, setNewFlag] = useState('');
  const [newColor, setNewColor] = useState('#a371f7');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteRef = useRef(note);
  const loadedIdRef = useRef(node.id);

  noteRef.current = note;

  useEffect(() => {
    if (loadedIdRef.current === node.id) return;
    loadedIdRef.current = node.id;
    setNote(node.note);
  }, [node.id, node.note]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const changeNote = (value: string) => {
    setNote(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void onNote(node.id, noteRef.current);
    }, 500);
  };

  const toggleFlag = (flagId: string) => {
    const next = node.flags.includes(flagId)
      ? node.flags.filter((id) => id !== flagId)
      : [...node.flags, flagId];
    void onFlags(node.id, next);
  };

  return (
    <section className="panel" aria-label="Selected page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{node.title || node.normalizedUrl}</h2>
        <div className="row">
          <span className="badge">{node.visitCount}×</span>
          <button type="button" className="danger" onClick={() => void onDelete(node)}>
            Delete
          </button>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close panel">
              ✕
            </button>
          )}
        </div>
      </div>
      <div className="small muted" style={{ marginBottom: 8 }}>
        <a href={node.url} target="_blank" rel="noreferrer">
          {node.url}
        </a>
      </div>

      <div className="row small muted" style={{ marginBottom: 8 }}>
        <span>Active {formatDuration(node.focus?.activeMs ?? 0)}</span>
        <span>· {node.focus?.maxScrollPct ?? 0}% scrolled</span>
        {node.focus && <span>· {node.focus.selections.length} selections</span>}
      </div>

      <div className="field">
        <label htmlFor={`note-${node.id}`}>Note (Markdown, autosaved)</label>
        <textarea
          id={`note-${node.id}`}
          value={note}
          onChange={(event) => changeNote(event.target.value)}
          placeholder="What matters on this page?"
          rows={3}
        />
      </div>

      <div className="field">
        <label>Flags</label>
        <div className="chips">
          {flags.map((flag) => {
            const on = node.flags.includes(flag.id);
            return (
              <button
                key={flag.id}
                type="button"
                className={`chip${on ? ' on' : ''}`}
                style={{ color: flag.color }}
                aria-pressed={on}
                onClick={() => toggleFlag(flag.id)}
              >
                {flag.name}
              </button>
            );
          })}
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <input
            style={{ flex: 1 }}
            value={newFlag}
            placeholder="New flag"
            onChange={(event) => setNewFlag(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || !newFlag.trim()) return;
              void onCreateFlag(newFlag, newColor).then((flag) => {
                setNewFlag('');
                if (flag) void onFlags(node.id, [...node.flags, flag.id]);
              });
            }}
          />
          <input
            type="color"
            value={newColor}
            aria-label="Flag colour"
            style={{ width: 36, padding: 0 }}
            onChange={(event) => setNewColor(event.target.value)}
          />
          <button
            type="button"
            onClick={() => {
              if (!newFlag.trim()) return;
              void onCreateFlag(newFlag, newColor).then((flag) => {
                setNewFlag('');
                if (flag) void onFlags(node.id, [...node.flags, flag.id]);
              });
            }}
          >
            Add
          </button>
        </div>
      </div>

      <div className="field">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <label style={{ margin: 0 }}>AI summary</label>
          <div className="row">
            {node.summary && <span className="badge">{providerLabel(node.summary.provider)}</span>}
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void onSummarize(node.id, Boolean(node.summary))}
            >
              {busy ? 'Summarizing…' : node.summary ? 'Regenerate' : 'Summarize'}
            </button>
          </div>
        </div>

        {progress !== null && (
          <div className="progress" aria-label="Downloading on-device model">
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}

        {error && <div className="notice error">{error}</div>}

        {setupIssue && (
          <div className="notice">
            {setupIssue === 'needs-download' ? (
              <>
                <p style={{ margin: '0 0 6px' }}>
                  Chrome’s on-device model needs a one-time download (several GB).
                </p>
                <button type="button" onClick={() => void onDownloadModel()} disabled={busy}>
                  Download on-device model
                </button>
              </>
            ) : (
              <p style={{ margin: 0 }}>
                No summarizer available. Add a Gemini API key in Settings, or update Chrome to 138+
                on a supported desktop for the on-device model.
              </p>
            )}
          </div>
        )}

        {node.summary && (
          <div className="summary">
            <p>{node.summary.text}</p>
            {node.summary.focusText && (
              <p className="muted">
                <strong>Focus:</strong> {node.summary.focusText}
              </p>
            )}
            <div className="small muted">
              {node.summary.model} · {new Date(node.summary.createdAt).toLocaleString()}
            </div>
          </div>
        )}
      </div>

      {node.focus && node.focus.topBlocks.length > 0 && (
        <details>
          <summary className="small muted">Focus details</summary>
          <ul className="small muted" style={{ paddingLeft: 16 }}>
            {node.focus.topBlocks.map((block) => (
              <li key={block.text}>
                {formatDuration(block.ms)} — {block.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

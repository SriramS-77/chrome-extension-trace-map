import { useEffect, useState } from 'react';
import { db, deleteAllData, getSettings, saveSettings } from '../../src/shared/db';
import { getGeminiApiKey, setGeminiApiKey } from '../../src/shared/apiKey';
import { DEFAULT_SETTINGS, type ProviderMode, type Settings } from '../../src/shared/types';
import { downloadText } from '../../src/shared/export';
import { summarizeWithGemini } from '../../src/ai/gemini';

export function OptionsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      setSettings(await getSettings());
      const key = await getGeminiApiKey();
      setHasKey(Boolean(key));
    })();
  }, []);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await saveSettings(settings);
      if (apiKey.trim()) {
        await setGeminiApiKey(apiKey);
        setHasKey(true);
        setApiKey('');
      }
      setStatus('Settings saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const testKey = async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const key = apiKey.trim() || (await getGeminiApiKey());
      if (!key) throw new Error('Enter a Gemini API key first.');
      const result = await summarizeWithGemini({
        apiKey: key,
        model: settings.geminiModel,
        title: 'Tab Tree key check',
        url: 'https://example.com',
        text: 'Tab Tree verifies the Gemini API key with this short, harmless request.',
      });
      setStatus(`Gemini replied: ${result.summary.slice(0, 120)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const clearKey = async () => {
    await setGeminiApiKey('');
    setHasKey(false);
    setStatus('Gemini key removed.');
  };

  const exportAll = async () => {
    const [sessions, nodes, edges, flags, pageText] = await Promise.all([
      db.sessions.toArray(),
      db.nodes.toArray(),
      db.edges.toArray(),
      db.flags.toArray(),
      db.pageText.toArray(),
    ]);
    downloadText(
      `tab-tree-export-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(
        { format: 'tab-tree-export', version: 1, exportedAt: Date.now(), sessions, nodes, edges, flags, pageText },
        null,
        2,
      ),
      'application/json',
    );
  };

  return (
    <div className="page">
      <h1>Tab Tree settings</h1>
      <p className="muted">
        Everything is stored locally in this browser. Page text leaves your browser only when a
        summary uses Gemini.
      </p>

      <div className="card">
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Summaries</h2>
        <div className="field">
          <label htmlFor="provider">Summary provider</label>
          <select
            id="provider"
            value={settings.providerMode}
            onChange={(event) => update('providerMode', event.target.value as ProviderMode)}
          >
            <option value="auto">Auto — Chrome on-device first, Gemini fallback</option>
            <option value="chrome">Chrome on-device only</option>
            <option value="gemini">Gemini only</option>
          </select>
          <span className="small muted">
            Chrome’s on-device model keeps page text on your machine. Gemini sends the page text and
            focus excerpts to Google.
          </span>
        </div>

        <div className="field">
          <label htmlFor="model">Gemini model id</label>
          <input
            id="model"
            list="gemini-models"
            value={settings.geminiModel}
            onChange={(event) => update('geminiModel', event.target.value)}
          />
          <datalist id="gemini-models">
            <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite — default, cheapest</option>
            <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
            <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite</option>
            <option value="gemma-4-31b-it">Gemma 4 31B IT — testing</option>
          </datalist>
          <span className="small muted">
            Any model id that supports <code>generateContent</code> works. Switch freely between
            Gemini and Gemma; summaries are cached per page and provider, so press Regenerate after
            changing the model.
          </span>
        </div>

        <div className="field">
          <label htmlFor="key">
            Gemini API key {hasKey ? '(saved)' : '(not set)'}
          </label>
          <input
            id="key"
            type="password"
            autoComplete="off"
            placeholder={hasKey ? '•••••••• saved — paste a new key to replace' : 'Paste your key'}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <span className="small muted">
            Stored in <code>chrome.storage.local</code>, never in the page tree or exports. Get one
            from Google AI Studio. Gemini receives page text only for pages you summarize.
          </span>
          <div className="row">
            <button type="button" onClick={() => void testKey()} disabled={busy}>
              Test Gemini key
            </button>
            {hasKey && (
              <button type="button" className="danger" onClick={() => void clearKey()}>
                Remove key
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Recording</h2>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="idle">Idle minutes before a new session</label>
            <input
              id="idle"
              type="number"
              min={1}
              max={600}
              value={settings.idleMinutes}
              onChange={(event) => update('idleMinutes', Number(event.target.value) || 30)}
            />
          </div>
          <div className="field">
            <label>Automatic summaries</label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.autoSummarize}
                onChange={(event) => update('autoSummarize', event.target.checked)}
              />
              Summarize after 20 s of active reading (Gemini key required)
            </label>
          </div>
        </div>

        <div className="field">
          <label htmlFor="blocklist">Domain blocklist — never recorded, one per line</label>
          <textarea
            id="blocklist"
            rows={8}
            value={settings.blocklist.join('\n')}
            onChange={(event) =>
              update(
                'blocklist',
                event.target.value
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean),
              )
            }
          />
          <span className="small muted">
            A blocklisted domain and all its subdomains create no nodes and no content capture.
          </span>
        </div>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="primary" onClick={() => void save()} disabled={busy}>
          Save settings
        </button>
        <button type="button" onClick={() => void exportAll()}>
          Export all data
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => {
            if (!window.confirm('Delete every session, note and summary in this browser?')) return;
            void deleteAllData().then(() => setStatus('All Tab Tree data deleted.'));
          }}
        >
          Delete all data
        </button>
      </div>

      {status && <div className="notice success">{status}</div>}
      {error && <div className="notice error">{error}</div>}

      <p className="small muted" style={{ marginTop: 16 }}>
        Tab Tree records only while recording is on, skips incognito windows and blocklisted
        domains, and never reads form fields. Full page HTML is never stored.
      </p>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileDrop } from './components/FileDrop.tsx';
import { Dashboard } from './components/Dashboard.tsx';
import { Compare } from './components/Compare.tsx';
import { extractPdfs, looksScanned, type ExtractProgress } from './lib/pdf.ts';
import { parseProspectus } from './lib/parser.ts';
import { analyse } from './lib/analyzer.ts';
import { applyEdit } from './lib/edit.ts';
import type { ParsedProspectus, SavedAnalysis } from './lib/types.ts';
import './App.css';

const STORAGE_KEY = 'bursa-ipo-analyser/saved-v1';

type Tab = 'report' | 'compare';

function loadSaved(): SavedAnalysis[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedAnalysis[]) : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [parsed, setParsed] = useState<ParsedProspectus | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ExtractProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('report');
  const [saved, setSaved] = useState<SavedAnalysis[]>(() => loadSaved());
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch (err) {
      // Quota exceeded is non-fatal; the current report still works.
      console.warn('Could not persist saved analyses', err);
    }
  }, [saved]);

  const analysis = useMemo(() => (parsed ? { parsed, metrics: analyse(parsed) } : null), [parsed]);

  const handleFiles = useCallback(async (files: File[]) => {
    setBusy(true);
    setError(null);
    setProgress(null);
    setJustSaved(false);
    try {
      const { pages, files: names } = await extractPdfs(files, setProgress);

      if (looksScanned(pages)) {
        setError(
          'This PDF appears to be a scanned image with no selectable text. Scanned prospectuses are not supported — please use the official e-prospectus from Bursa Malaysia, which contains real text.',
        );
        return;
      }

      const result = parseProspectus(pages, names);

      if (result.ipoPrice.value === null && result.periods.length === 0) {
        setError(
          'No IPO details or financial tables were recognised. This tool is built for Bursa Malaysia prospectuses — check that you uploaded the right document, and that all parts are included.',
        );
        return;
      }

      setParsed(result);
      setTab('report');
    } catch (err) {
      console.error(err);
      setError(
        `Could not read the PDFs: ${err instanceof Error ? err.message : 'unknown error'}. If the file is password-protected or corrupted, try re-downloading it.`,
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, []);

  const handleEdit = useCallback((path: string, value: number | string | null) => {
    setParsed((prev) => (prev ? applyEdit(prev, path, value) : prev));
    setJustSaved(false);
  }, []);

  const handleSave = useCallback(() => {
    if (!parsed) return;
    const entry: SavedAnalysis = {
      id: `${Date.now()}`,
      companyName: parsed.companyName.value ?? 'Unnamed IPO',
      savedAt: new Date().toISOString(),
      parsed,
    };
    setSaved((prev) => {
      // Replace an existing entry for the same company rather than duplicating.
      const filtered = prev.filter((s) => s.companyName !== entry.companyName);
      return [...filtered, entry].slice(-6);
    });
    setJustSaved(true);
  }, [parsed]);

  const reset = useCallback(() => {
    setParsed(null);
    setError(null);
    setJustSaved(false);
  }, []);

  return (
    <div className="app">
      <nav className="nav no-print">
        <span className="nav__brand">
          Bursa IPO Analyser
          <span className="nav__tagline">local · free · no AI guesswork</span>
        </span>
        <div className="nav__tabs">
          {parsed && (
            <>
              <button
                type="button"
                className={`nav__tab${tab === 'report' ? ' nav__tab--on' : ''}`}
                onClick={() => setTab('report')}
              >
                Report
              </button>
              <button
                type="button"
                className={`nav__tab${tab === 'compare' ? ' nav__tab--on' : ''}`}
                onClick={() => setTab('compare')}
              >
                Compare{saved.length > 0 ? ` (${saved.length})` : ''}
              </button>
              <button type="button" className="nav__tab" onClick={reset}>
                New prospectus
              </button>
            </>
          )}
          {!parsed && saved.length > 0 && (
            <button
              type="button"
              className={`nav__tab${tab === 'compare' ? ' nav__tab--on' : ''}`}
              onClick={() => setTab(tab === 'compare' ? 'report' : 'compare')}
            >
              Saved ({saved.length})
            </button>
          )}
        </div>
      </nav>

      <main className="main">
        {!parsed && tab === 'compare' ? (
          <Compare
            saved={saved}
            onRemove={(id) => setSaved((prev) => prev.filter((s) => s.id !== id))}
            onClear={() => setSaved([])}
          />
        ) : !parsed ? (
          <FileDrop onFiles={handleFiles} busy={busy} progress={progress} error={error} />
        ) : tab === 'compare' ? (
          <Compare
            saved={saved}
            onRemove={(id) => setSaved((prev) => prev.filter((s) => s.id !== id))}
            onClear={() => setSaved([])}
          />
        ) : (
          analysis && (
            <Dashboard
              analysis={analysis}
              onEdit={handleEdit}
              onSave={handleSave}
              saved={justSaved}
            />
          )
        )}
      </main>
    </div>
  );
}

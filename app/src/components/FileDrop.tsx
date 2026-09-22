/**
 * Upload step: drag in the prospectus parts and everything else is automatic.
 *
 * Files are read locally via the File API — nothing is uploaded anywhere, so
 * there is no size limit beyond available memory and no privacy question about
 * handling regulatory documents.
 */

import { useCallback, useRef, useState } from 'react';
import type { ExtractProgress } from '../lib/pdf.ts';

interface FileDropProps {
  onFiles: (files: File[]) => void;
  busy: boolean;
  progress: ExtractProgress | null;
  error: string | null;
}

export function FileDrop({ onFiles, busy, progress, error }: FileDropProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = useCallback(
    (list: FileList | null) => {
      if (!list) return;
      const pdfs = Array.from(list).filter(
        (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name),
      );
      if (pdfs.length > 0) onFiles(pdfs);
    },
    [onFiles],
  );

  const pct = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;

  return (
    <div className="landing">
      <h1 className="landing__title">Bursa IPO Prospectus Analyser</h1>
      <p className="landing__lead">
        Drop in the prospectus PDF parts. You get a two-page decision sheet with the deal terms,
        financial track record, balance-sheet health and plain-English explanations of every term.
      </p>

      <div
        className={`drop${dragging ? ' drop--active' : ''}${busy ? ' drop--busy' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) handle(e.dataTransfer.files);
        }}
        onClick={() => !busy && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !busy) inputRef.current?.click();
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => handle(e.target.files)}
        />

        {busy ? (
          <div className="drop__busy">
            <div className="progress">
              <div className="progress__bar" style={{ width: `${pct}%` }} />
            </div>
            <p className="drop__status">
              {progress
                ? `Reading ${progress.file} — page ${progress.done} of ${progress.total}`
                : 'Opening PDFs…'}
            </p>
            <p className="drop__hint">Large prospectuses take a few seconds.</p>
          </div>
        ) : (
          <>
            <div className="drop__icon" aria-hidden="true">
              ⇪
            </div>
            <p className="drop__main">Drop prospectus PDFs here, or click to choose</p>
            <p className="drop__hint">
              Select all parts at once — Part 1, 2 and 3 are detected and stitched together
              automatically, in any order.
            </p>
          </>
        )}
      </div>

      {error && <div className="alert">{error}</div>}

      <ul className="landing__points">
        <li>
          <strong>Runs entirely in your browser.</strong> Your PDFs never leave your device.
        </li>
        <li>
          <strong>No AI guesswork.</strong> Figures are read directly from the document&rsquo;s own
          tables, so nothing is invented.
        </li>
        <li>
          <strong>Built for Bursa Malaysia.</strong> Tuned to the standard ACE and Main Market
          prospectus structure.
        </li>
        <li>
          <strong>Every term explained.</strong> Hover anything underlined for a plain-English
          definition.
        </li>
      </ul>

      <p className="landing__disclaimer">
        Informational tool only. It does not give investment advice or recommend whether to
        subscribe — it presents the prospectus&rsquo; own figures so you can judge for yourself.
      </p>
    </div>
  );
}

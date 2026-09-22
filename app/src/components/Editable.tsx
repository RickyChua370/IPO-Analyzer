/**
 * Click-to-edit value.
 *
 * Any figure on the report can be corrected if the parser got it wrong or
 * could not find it. Corrections flow straight back through the analyser so
 * ratios and flags update immediately.
 */

import { useEffect, useRef, useState } from 'react';

interface EditableProps {
  /** Formatted value for display. */
  display: string;
  /** Raw value to seed the input. */
  raw: number | string | null;
  /** Called with the parsed new value (null when cleared). */
  onCommit: (value: number | string | null) => void;
  /** Numeric inputs are parsed as numbers; text inputs stay strings. */
  numeric?: boolean;
  /** Marks a value the user has already overridden. */
  edited?: boolean;
  /** Shown when the parser could not find the value. */
  missing?: boolean;
  /** Extra hint rendered in the edit tooltip, e.g. units. */
  unit?: string;
}

export function Editable({
  display,
  raw,
  onCommit,
  numeric = true,
  edited,
  missing,
  unit,
}: EditableProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const start = () => {
    setDraft(raw === null || raw === undefined ? '' : String(raw));
    setEditing(true);
  };

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === '') {
      onCommit(null);
    } else if (numeric) {
      const n = Number(trimmed.replace(/[,\s]/g, '').replace(/[%×x]/gi, ''));
      onCommit(Number.isFinite(n) ? n : null);
    } else {
      onCommit(trimmed);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="editable__input"
        value={draft}
        inputMode={numeric ? 'decimal' : 'text'}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        aria-label={`Edit value${unit ? ` (${unit})` : ''}`}
      />
    );
  }

  const cls = [
    'editable',
    edited ? 'editable--edited' : '',
    missing ? 'editable--missing' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={cls}
      onClick={start}
      title={
        missing
          ? `Not found in the prospectus — click to enter it${unit ? ` (${unit})` : ''}`
          : `Click to correct this value${unit ? ` (${unit})` : ''}`
      }
    >
      {missing ? 'add' : display}
      {edited && <span className="editable__badge" title="You edited this value">edited</span>}
    </button>
  );
}

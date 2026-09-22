/**
 * Field override support.
 *
 * Deterministic parsing gets most things right, but not everything — rotated
 * tables and unusual layouts do defeat it. Rather than showing a wrong or blank
 * number and hoping, the UI lets the user correct any value, and every derived
 * metric and flag recomputes from the corrected figure. Edited values are
 * marked so the report can show which numbers came from the document and which
 * the user supplied.
 */

import type { FinancialPeriod, ParsedProspectus } from './types.ts';

/**
 * Sets a value by dot path, returning a new object.
 * Supported shapes:
 *   "ipoPrice"            -> scalar Field<T>.value
 *   "periods.2.revenue"   -> a financial period cell
 */
export function applyEdit(
  parsed: ParsedProspectus,
  path: string,
  value: number | string | null,
): ParsedProspectus {
  const next: ParsedProspectus = { ...parsed };
  const parts = path.split('.');

  if (parts.length === 1) {
    const key = parts[0] as keyof ParsedProspectus;
    const current = parsed[key];
    if (current && typeof current === 'object' && 'confidence' in current) {
      (next[key] as unknown) = {
        ...current,
        value,
        confidence: value === null ? 'missing' : 'high',
        edited: true,
      };
    }
    return next;
  }

  if (parts[0] === 'periods' && parts.length === 3) {
    const index = Number(parts[1]);
    const key = parts[2] as keyof FinancialPeriod;
    next.periods = parsed.periods.map((p, i) =>
      i === index ? { ...p, [key]: value } : p,
    );
    return next;
  }

  console.warn('[edit] unsupported path', path);
  return next;
}

/** Counts how many scalar fields the user has corrected. */
export function countEdits(parsed: ParsedProspectus): number {
  return Object.values(parsed).filter(
    (v) => v && typeof v === 'object' && 'edited' in v && v.edited === true,
  ).length;
}

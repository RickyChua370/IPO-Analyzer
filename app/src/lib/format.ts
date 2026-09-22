/** Display formatting helpers. All return '—' for missing values, never 'null'. */

export const DASH = '—';

export function fmtNumber(v: number | null | undefined, dp = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return v.toLocaleString('en-MY', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Formats an RM amount, auto-scaling to million/billion for readability. */
export function fmtRM(v: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  if (opts.compact) {
    const abs = Math.abs(v);
    if (abs >= 1_000_000_000) return `RM${(v / 1_000_000_000).toFixed(2)}bn`;
    if (abs >= 1_000_000) return `RM${(v / 1_000_000).toFixed(2)}m`;
    if (abs >= 1_000) return `RM${(v / 1_000).toFixed(0)}k`;
  }
  return `RM${fmtNumber(v)}`;
}

/** Period figures are stated in RM'000. */
export function fmtThousands(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return fmtNumber(v);
}

export function fmtPct(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return `${v.toFixed(dp)}%`;
}

export function fmtSignedPct(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return `${v >= 0 ? '+' : ''}${v.toFixed(dp)}%`;
}

export function fmtTimes(v: number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return `${v.toFixed(dp)}×`;
}

export function fmtPrice(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return `RM${v.toFixed(v < 1 ? 2 : 2)}`;
}

export function fmtSen(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return `${v.toFixed(2)} sen`;
}

export function fmtYears(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return `${v.toFixed(1)} yrs`;
}

/** Human-readable countdown used in the header strip. */
export function fmtCountdown(days: number | null): string | null {
  if (days === null) return null;
  if (days < 0) return 'Application closed';
  if (days === 0) return 'Closes today';
  if (days === 1) return 'Closes tomorrow';
  return `Closes in ${days} days`;
}

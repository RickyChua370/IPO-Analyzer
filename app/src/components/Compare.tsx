/**
 * Side-by-side comparison of saved IPOs.
 *
 * Saved locally in localStorage, so comparison costs nothing and no account is
 * needed. Useful when several IPOs are open for application at once.
 */

import { useMemo } from 'react';
import type { SavedAnalysis } from '../lib/types.ts';
import { analyse } from '../lib/analyzer.ts';
import { Term } from './Term.tsx';
import {
  DASH,
  fmtPct,
  fmtPrice,
  fmtRM,
  fmtSignedPct,
  fmtTimes,
  fmtYears,
} from '../lib/format.ts';

interface CompareProps {
  saved: SavedAnalysis[];
  onRemove: (id: string) => void;
  onClear: () => void;
}

/** One saved IPO plus its freshly derived metrics. */
type CompareRow = { saved: SavedAnalysis; metrics: ReturnType<typeof analyse> };

interface RowProps {
  label: string;
  glossary?: string;
  rows: CompareRow[];
  pick: (r: CompareRow) => { display: string; sort: number | null };
  /**
   * Which direction is more favourable on this single measure. Used only to
   * tint one cell — never to rank the IPOs overall.
   */
  better?: 'high' | 'low';
}

/**
 * Renders one metric across every saved IPO.
 *
 * Declared at module scope (rather than inside Compare) so React treats it as
 * a stable component type across renders.
 */
function MetricRow({ label, glossary, rows, pick, better }: RowProps) {
  const cells = rows.map(pick);
  let bestIndex = -1;
  if (better) {
    const valid = cells
      .map((c, i) => ({ v: c.sort, i }))
      .filter((x): x is { v: number; i: number } => x.v !== null);
    if (valid.length > 1) {
      valid.sort((a, b) => (better === 'high' ? b.v - a.v : a.v - b.v));
      bestIndex = valid[0].i;
    }
  }
  return (
    <tr>
      <th>{glossary ? <Term k={glossary}>{label}</Term> : label}</th>
      {cells.map((c, i) => (
        <td key={i} className={`num${i === bestIndex ? ' best' : ''}`}>
          {c.display}
        </td>
      ))}
    </tr>
  );
}

export function Compare({ saved, onRemove, onClear }: CompareProps) {
  const rows = useMemo(
    () => saved.map((s) => ({ saved: s, metrics: analyse(s.parsed) })),
    [saved],
  );

  if (saved.length === 0) {
    return (
      <div className="compare compare--empty">
        <h2 className="h2">Compare IPOs</h2>
        <p className="muted">
          Nothing saved yet. Analyse a prospectus and choose{' '}
          <strong>Save for comparison</strong> to line several up side by side.
        </p>
      </div>
    );
  }

  return (
    <div className="compare">
      <div className="compare__head">
        <h2 className="h2">Compare IPOs</h2>
        <button type="button" className="btn btn--subtle" onClick={onClear}>
          Clear all
        </button>
      </div>

      <div className="scroll">
        <table className="data compare__table">
          <thead>
            <tr>
              <th />
              {rows.map((r) => (
                <th key={r.saved.id} className="num">
                  <div className="compare__name">{r.saved.companyName}</div>
                  <div className="compare__sub">
                    {r.saved.parsed.listingBoard.value ?? ''}
                    {r.saved.parsed.listingDate.value ? ` · ${r.saved.parsed.listingDate.value}` : ''}
                  </div>
                  <button
                    type="button"
                    className="compare__remove"
                    onClick={() => onRemove(r.saved.id)}
                    title="Remove from comparison"
                  >
                    remove
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <MetricRow
              rows={rows}
              label="IPO price"
              glossary="ipoPrice"
              pick={(r) => ({
                display: fmtPrice(r.saved.parsed.ipoPrice.value),
                sort: r.saved.parsed.ipoPrice.value,
              })}
            />
            <MetricRow
              rows={rows}
              label="Market cap"
              glossary="marketCap"
              pick={(r) => ({
                display: fmtRM(r.saved.parsed.marketCap.value, { compact: true }),
                sort: r.saved.parsed.marketCap.value,
              })}
            />
            <MetricRow
              rows={rows}
              label="PE multiple"
              glossary="peMultiple"
              better="low"
              pick={(r) => ({
                display: fmtTimes(r.saved.parsed.peMultiple.value, 1),
                sort: r.saved.parsed.peMultiple.value,
              })}
            />
            <MetricRow
              rows={rows}
              label="Price-to-book"
              glossary="priceToBook"
              better="low"
              pick={(r) => ({ display: fmtTimes(r.metrics.priceToBook, 1), sort: r.metrics.priceToBook })}
            />
            <MetricRow
              rows={rows}
              label="Revenue CAGR"
              glossary="cagr"
              better="high"
              pick={(r) => ({ display: fmtPct(r.metrics.revenueCagr), sort: r.metrics.revenueCagr })}
            />
            <MetricRow
              rows={rows}
              label="Latest profit growth"
              glossary="pat"
              better="high"
              pick={(r) => ({
                display: fmtSignedPct(r.metrics.patGrowthLatest),
                sort: r.metrics.patGrowthLatest,
              })}
            />
            <MetricRow
              rows={rows}
              label="Net margin (latest)"
              glossary="patMargin"
              better="high"
              pick={(r) => {
                const v = r.metrics.latestFull?.patMargin ?? null;
                return { display: fmtPct(v), sort: v };
              }}
            />
            <MetricRow
              rows={rows}
              label="Gearing after IPO"
              glossary="gearing"
              better="low"
              pick={(r) => ({ display: fmtTimes(r.metrics.gearingAfter), sort: r.metrics.gearingAfter })}
            />
            <MetricRow
              rows={rows}
              label="Current ratio"
              glossary="currentRatio"
              better="high"
              pick={(r) => ({
                display: fmtTimes(r.metrics.latestCurrentRatio),
                sort: r.metrics.latestCurrentRatio,
              })}
            />
            <MetricRow
              rows={rows}
              label="Revenue visibility"
              glossary="orderBookCoverage"
              better="high"
              pick={(r) => ({
                display: fmtYears(r.metrics.orderBookCoverage),
                sort: r.metrics.orderBookCoverage,
              })}
            />
            <MetricRow
              rows={rows}
              label="Proceeds to growth"
              glossary="proceedsToGrowth"
              better="high"
              pick={(r) => ({
                display: fmtPct(r.metrics.proceedsToGrowthPct),
                sort: r.metrics.proceedsToGrowthPct,
              })}
            />
            <MetricRow
              rows={rows}
              label="Vendor cash-out"
              glossary="vendorCashOut"
              better="low"
              pick={(r) => ({
                display: fmtPct(r.metrics.vendorCashOutPct),
                sort: r.metrics.vendorCashOutPct,
              })}
            />
            <MetricRow
              rows={rows}
              label="Top-5 customers"
              glossary="customerConcentration"
              better="low"
              pick={(r) => ({
                display: fmtPct(r.metrics.topCustomerConcentration),
                sort: r.metrics.topCustomerConcentration,
              })}
            />
            <MetricRow
              rows={rows}
              label="Founder stake after"
              glossary="founderRetained"
              better="high"
              pick={(r) => ({
                display: fmtPct(r.metrics.founderRetainedPct),
                sort: r.metrics.founderRetainedPct,
              })}
            />
            <MetricRow
              rows={rows}
              label="Retail ballot pool"
              glossary="retailBallotPct"
              better="high"
              pick={(r) => ({
                display: fmtPct(r.metrics.retailBallotPct, 2),
                sort: r.metrics.retailBallotPct,
              })}
            />
            <MetricRow
              rows={rows}
              label="Dividend policy"
              glossary="dividendPolicy"
              pick={(r) => ({
                display: r.saved.parsed.dividendPolicy.value ?? DASH,
                sort: null,
              })}
            />
            <tr>
              <th>Signals</th>
              {rows.map((r) => {
                const counts = r.metrics.flags.reduce<Record<string, number>>((acc, f) => {
                  acc[f.level] = (acc[f.level] ?? 0) + 1;
                  return acc;
                }, {});
                return (
                  <td key={r.saved.id} className="num">
                    <span className="chip chip--good">{counts.good ?? 0}</span>{' '}
                    <span className="chip chip--watch">{counts.watch ?? 0}</span>{' '}
                    <span className="chip chip--concern">{counts.concern ?? 0}</span>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="note">
        Highlighted cells mark the more favourable value on that single measure only. They are not a
        ranking and do not indicate which IPO is the better investment — weigh the measures
        according to what matters to you, and read each prospectus in full.
      </p>
    </div>
  );
}

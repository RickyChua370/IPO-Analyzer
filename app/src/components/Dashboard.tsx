/**
 * The two-page IPO decision sheet.
 *
 * Page 1 is the at-a-glance summary an investor can scan in about a minute.
 * Page 2 carries the supporting detail plus an honest audit of what the parser
 * did and did not find. Print CSS maps each page to one sheet of A4.
 */

import { Fragment } from 'react';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Analysis, Flag, ParsedProspectus, RelevanceProfile } from '../lib/types.ts';
import { Term } from './Term.tsx';
import { Editable } from './Editable.tsx';
import {
  DASH,
  fmtCountdown,
  fmtPct,
  fmtPrice,
  fmtRM,
  fmtSignedPct,
  fmtThousands,
  fmtTimes,
  fmtYears,
} from '../lib/format.ts';

interface DashboardProps {
  analysis: Analysis;
  onEdit: (path: string, value: number | string | null) => void;
  onSave: () => void;
  saved: boolean;
}

const FLAG_ICON: Record<string, string> = {
  good: '●',
  watch: '●',
  concern: '●',
  unknown: '○',
};

const CATEGORY_COLOURS: Record<string, string> = {
  growth: '#2f8f5b',
  debt: '#c2683a',
  working_capital: '#3d6ea8',
  expenses: '#8a8f98',
  other: '#6b5b95',
};

const CATEGORY_LABELS: Record<string, string> = {
  growth: 'Growth (capex, tech)',
  debt: 'Repay borrowings',
  working_capital: 'Working capital',
  expenses: 'Listing expenses',
  other: 'Other',
};

export function Dashboard({ analysis, onEdit, onSave, saved }: DashboardProps) {
  const { parsed: p, metrics: m } = analysis;

  const countdown = fmtCountdown(m.daysUntilClose);

  // Signals that do not apply to this business are hidden from the grid so the
  // report does not look like a failed extraction; they are still acknowledged
  // in a small footnote for transparency.
  const shownFlags = m.flags.filter((f) => f.applicability !== 'not_applicable');
  const naFlags = m.flags.filter((f) => f.applicability === 'not_applicable');
  const flagCounts = shownFlags.reduce<Record<string, number>>((acc, f) => {
    acc[f.level] = (acc[f.level] ?? 0) + 1;
    return acc;
  }, {});

  // Chart series: revenue and profit by period, with stub marked.
  const chartData = p.periods.map((period) => ({
    name: period.label.replace('FYE ', "'").replace('FPE ', "'") + (period.isStub ? '*' : ''),
    Revenue: period.revenue,
    PAT: period.pat,
    'GP margin': period.gpMargin,
    'PAT margin': period.patMargin,
  }));

  const proceedsData = Object.entries(
    p.proceedsUses.reduce<Record<string, number>>((acc, u) => {
      acc[u.category] = (acc[u.category] ?? 0) + (u.amount ?? 0);
      return acc;
    }, {}),
  ).map(([category, value]) => ({
    name: CATEGORY_LABELS[category] ?? category,
    value,
    category,
  }));

  const moneySplit = [
    { name: 'New money to company', value: p.publicIssueGrossRM.value ?? 0, category: 'growth' },
    { name: 'To existing owners', value: p.offerForSaleGrossRM.value ?? 0, category: 'debt' },
  ].filter((d) => d.value > 0);

  return (
    <div className="report">
      <div className="report__toolbar no-print">
        <button type="button" className="btn btn--primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
        <button type="button" className="btn" onClick={onSave} disabled={saved}>
          {saved ? 'Saved for comparison ✓' : 'Save for comparison'}
        </button>
        <span className="report__hint">
          Hover any underlined term for a plain-English explanation. Click any number to correct it.
        </span>
      </div>

      {/* ================= PAGE 1 ================= */}
      <section className="sheet">
        {/* Header strip */}
        <header className="head">
          <div className="head__main">
            <h1 className="head__name">{p.companyName.value ?? 'Unknown company'}</h1>
            <div className="head__sub">
              {p.listingBoard.value && (
                <Term k={p.listingBoard.value === 'ACE Market' ? 'aceMarket' : 'mainMarket'}>
                  {p.listingBoard.value}
                </Term>
              )}
              {p.industry.value && <> · {p.industry.value}</>}
              {p.listingDate.value && <> · Lists {p.listingDate.value}</>}
              {p.registrationNo.value && <> · Reg. {p.registrationNo.value}</>}
            </div>
          </div>
          {countdown && (
            <div className={`head__countdown${(m.daysUntilClose ?? 99) <= 2 ? ' head__countdown--urgent' : ''}`}>
              {countdown}
            </div>
          )}
        </header>

        {p.businessDescription.value && (
          <p className="head__desc">{p.businessDescription.value}</p>
        )}

        {/* Headline metrics */}
        <div className="kpis">
          <Kpi
            label="IPO price"
            glossary="ipoPrice"
            value={fmtPrice(p.ipoPrice.value)}
            raw={p.ipoPrice.value}
            path="ipoPrice"
            onEdit={onEdit}
            edited={p.ipoPrice.edited}
            unit="RM per share"
          />
          <Kpi
            label="Market cap"
            glossary="marketCap"
            value={fmtRM(p.marketCap.value, { compact: true })}
            raw={p.marketCap.value}
            path="marketCap"
            onEdit={onEdit}
            edited={p.marketCap.edited}
            unit="RM"
          />
          <Kpi
            label="PE multiple"
            glossary="peMultiple"
            value={fmtTimes(p.peMultiple.value, 1)}
            raw={p.peMultiple.value}
            path="peMultiple"
            onEdit={onEdit}
            edited={p.peMultiple.edited}
            unit="times"
          />
          <Kpi label="Price-to-book" glossary="priceToBook" value={fmtTimes(m.priceToBook, 1)} derived />
          {m.relevance.orderBook !== 'not_applicable' ? (
            <>
              <Kpi
                label="Order book"
                glossary="orderBook"
                value={fmtRM(p.orderBook.value, { compact: true })}
                raw={p.orderBook.value}
                path="orderBook"
                onEdit={onEdit}
                edited={p.orderBook.edited}
                unit="RM"
              />
              <Kpi label="Revenue visibility" glossary="orderBookCoverage" value={fmtYears(m.orderBookCoverage)} derived />
            </>
          ) : (
            // Order book is meaningless for this business; show two universally
            // relevant headline metrics instead so the strip stays useful.
            <>
              <Kpi label="Founder stake" glossary="founderRetained" value={fmtPct(m.founderRetainedPct)} derived />
              <Kpi label="Revenue CAGR" glossary="cagr" value={fmtPct(m.revenueCagr)} derived />
            </>
          )}
        </div>

        {/* Flags */}
        <h2 className="h2">
          Signals <span className="h2__note">measured against stated thresholds — you decide</span>
        </h2>
        <div className="flags">
          <div className="flags__summary">
            <span className="chip chip--good">{flagCounts.good ?? 0} good</span>
            <span className="chip chip--watch">{flagCounts.watch ?? 0} watch</span>
            <span className="chip chip--concern">{flagCounts.concern ?? 0} concern</span>
            {(flagCounts.unknown ?? 0) > 0 && (
              <span className="chip chip--unknown">{flagCounts.unknown} not found</span>
            )}
          </div>
          <div className="flags__grid">
            {shownFlags.map((f) => (
              <FlagCard key={f.id} flag={f} />
            ))}
          </div>
          {naFlags.length > 0 && (
            <p className="flags__na">
              Not shown ({naFlags.length}) — not applicable to this type of business:{' '}
              {naFlags.map((f) => f.label).join(', ')}.
            </p>
          )}
        </div>

        {/* The deal + money split */}
        <div className="cols">
          <div className="col">
            <h2 className="h2">The deal</h2>
            <table className="kv">
              <tbody>
                <tr>
                  <th>Total IPO size</th>
                  <td>
                    {fmtThousands(
                      (p.publicIssueShares.value ?? 0) + (p.offerForSaleShares.value ?? 0) || null,
                    )}{' '}
                    shares
                    {p.enlargedShares.value && (
                      <span className="muted">
                        {' '}
                        ={' '}
                        {fmtPct(
                          (((p.publicIssueShares.value ?? 0) + (p.offerForSaleShares.value ?? 0)) /
                            p.enlargedShares.value) *
                            100,
                        )}{' '}
                        of company
                      </span>
                    )}
                  </td>
                </tr>
                <tr>
                  <th>
                    <Term k="publicIssue">New money to company</Term>
                  </th>
                  <td>
                    <strong>{fmtRM(p.publicIssueGrossRM.value, { compact: true })}</strong>
                    <span className="muted"> ({fmtPct(m.newMoneyPct)} of raise)</span>
                  </td>
                </tr>
                <tr>
                  <th>
                    <Term k="offerForSale">Cash to existing owners</Term>
                  </th>
                  <td>
                    <strong>{fmtRM(p.offerForSaleGrossRM.value, { compact: true })}</strong>
                    <span className="muted"> ({fmtPct(m.vendorCashOutPct)} of raise)</span>
                  </td>
                </tr>
                <tr>
                  <th>
                    <Term k="retailBallotPct">Retail ballot pool</Term>
                  </th>
                  <td>
                    {fmtThousands(m.retailBallotShares)} shares
                    <span className="muted"> ({fmtPct(m.retailBallotPct, 2)} of company)</span>
                  </td>
                </tr>
                <tr>
                  <th>
                    <Term k="enlargedShares">Shares after listing</Term>
                  </th>
                  <td>{fmtThousands(p.enlargedShares.value)}</td>
                </tr>
                <tr>
                  <th>
                    <Term k="dilution">Dilution to new investors</Term>
                  </th>
                  <td>
                    {fmtPct(p.dilutionPct.value)}
                    <span className="muted"> of IPO price</span>
                  </td>
                </tr>
                <tr>
                  <th>
                    <Term k="naPerShare">NA per share after IPO</Term>
                  </th>
                  <td>{p.naPerShareAfter.value !== null ? `RM${p.naPerShareAfter.value.toFixed(2)}` : DASH}</td>
                </tr>
              </tbody>
            </table>

            {moneySplit.length > 0 && (
              <>
                <h3 className="h3">
                  <Term k="vendorCashOut">Who receives the money</Term>
                </h3>
                <div className="chart chart--short">
                  <ResponsiveContainer width="100%" height={120}>
                    <PieChart>
                      <Pie
                        data={moneySplit}
                        dataKey="value"
                        nameKey="name"
                        cx="35%"
                        cy="50%"
                        outerRadius={52}
                        innerRadius={30}
                      >
                        {moneySplit.map((d) => (
                          <Cell key={d.name} fill={CATEGORY_COLOURS[d.category]} />
                        ))}
                      </Pie>
                      <ChartTooltip formatter={(v) => fmtRM(typeof v === 'number' ? v : null, { compact: true })} />
                      <Legend layout="vertical" align="right" verticalAlign="middle" iconSize={8} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>

          <div className="col">
            <h2 className="h2">
              <Term k="proceedsToGrowth">Where the money goes</Term>
            </h2>
            {proceedsData.length > 0 ? (
              <>
                <div className="chart chart--short">
                  <ResponsiveContainer width="100%" height={150}>
                    <PieChart>
                      <Pie
                        data={proceedsData}
                        dataKey="value"
                        nameKey="name"
                        cx="35%"
                        cy="50%"
                        outerRadius={62}
                        innerRadius={34}
                      >
                        {proceedsData.map((d) => (
                          <Cell key={d.name} fill={CATEGORY_COLOURS[d.category] ?? '#999'} />
                        ))}
                      </Pie>
                      <ChartTooltip formatter={(v) => `RM${fmtThousands(typeof v === 'number' ? v : null)}k`} />
                      <Legend layout="vertical" align="right" verticalAlign="middle" iconSize={8} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <p className="callout">
                  <strong>{fmtPct(m.proceedsToGrowthPct)}</strong> of the company&rsquo;s proceeds fund
                  growth; <strong>{fmtPct(m.proceedsToDebtPct)}</strong> repays borrowings.
                </p>
              </>
            ) : (
              <p className="muted">Utilisation of proceeds not found.</p>
            )}

            <h2 className="h2">Financial health</h2>
            <table className="kv">
              <tbody>
                <tr>
                  <th>
                    <Term k="gearing">Gearing</Term>
                  </th>
                  <td>
                    {fmtTimes(m.gearingBefore)} <span className="muted">before</span> →{' '}
                    <strong>{fmtTimes(m.gearingAfter)}</strong> <span className="muted">after IPO</span>
                  </td>
                </tr>
                <tr>
                  <th>
                    <Term k="currentRatio">Current ratio</Term>
                  </th>
                  <td>{fmtTimes(m.latestCurrentRatio)}</td>
                </tr>
                <tr>
                  <th>
                    <Term k="receivablesDays">Customers pay in</Term>
                  </th>
                  <td>
                    {m.latestReceivablesDays !== null ? `${m.latestReceivablesDays} days` : DASH}
                  </td>
                </tr>
                <tr>
                  <th>
                    <Term k="borrowings">Borrowings</Term>
                  </th>
                  <td>
                    {p.proForma.length > 0
                      ? `RM${fmtThousands(p.proForma[p.proForma.length - 1].borrowings)}k`
                      : DASH}
                  </td>
                </tr>
                {m.relevance.customerConcentration !== 'not_applicable' && (
                  <tr>
                    <th>
                      <Term k="customerConcentration">Top-5 customers</Term>
                    </th>
                    <td>{fmtPct(m.topCustomerConcentration)} of revenue</td>
                  </tr>
                )}
                <tr>
                  <th>
                    <Term k="employees">Employees</Term>
                  </th>
                  <td>{fmtThousands(p.employees.value)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Financial track record */}
        <h2 className="h2">
          Track record{' '}
          <span className="h2__note">
            bars = revenue &amp; profit (RM&rsquo;000, left) · lines = margins (%, right)
            {m.stubPeriod && ' · * part-year, not a full 12 months'}
          </span>
        </h2>
        <div className="chart">
          <ResponsiveContainer width="100%" height={190}>
            <ComposedChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 2" stroke="#e8e8e8" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="rm" tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 10 }} unit="%" />
              <ChartTooltip />
              <Legend iconSize={9} wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="rm" dataKey="Revenue" fill="#3d6ea8" radius={[2, 2, 0, 0]} />
              <Bar yAxisId="rm" dataKey="PAT" fill="#2f8f5b" radius={[2, 2, 0, 0]} />
              <Line yAxisId="pct" type="monotone" dataKey="GP margin" stroke="#c2683a" strokeWidth={2} dot={{ r: 2 }} />
              <Line yAxisId="pct" type="monotone" dataKey="PAT margin" stroke="#8a5fa8" strokeWidth={2} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="minirow">
          <MiniStat label="Revenue CAGR" glossary="cagr" value={fmtPct(m.revenueCagr)} note="full years only" />
          <MiniStat label="Latest revenue growth" value={fmtSignedPct(m.revenueGrowthLatest)} note="year on year" />
          <MiniStat label="Latest profit growth" glossary="pat" value={fmtSignedPct(m.patGrowthLatest)} note="year on year" />
          <MiniStat label="Margin trend" glossary="marginTrend" value={m.marginTrend ?? DASH} note={m.gpMarginChange !== null ? `${m.gpMarginChange >= 0 ? '+' : ''}${m.gpMarginChange.toFixed(1)} pp overall` : ''} />
        </div>

        {/* Ownership */}
        <div className="cols">
          <div className="col">
            <h2 className="h2">Control &amp; alignment</h2>
            <table className="kv">
              <tbody>
                <tr>
                  <th>
                    <Term k="founderRetained">Largest holder after IPO</Term>
                  </th>
                  <td>
                    {m.largestShareholder?.name ?? DASH}{' '}
                    <strong>{fmtPct(m.founderRetainedPct)}</strong>
                  </td>
                </tr>
                <tr>
                  <th>
                    <Term k="moratorium">Insider lock-up</Term>
                  </th>
                  <td>{p.moratorium.value ?? DASH}</td>
                </tr>
                <tr>
                  <th>
                    <Term k="independentDirector">Board independence</Term>
                  </th>
                  <td>
                    {fmtPct(m.independentDirectorRatio, 0)}
                    <span className="muted">
                      {' '}
                      ({p.directors.filter((d) => d.isIndependent).length} of {p.directors.length})
                    </span>
                  </td>
                </tr>
                <tr>
                  <th>
                    <Term k="dividendPolicy">Dividend policy</Term>
                  </th>
                  <td>{p.dividendPolicy.value ?? DASH}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="col">
            <h2 className="h2">Key dates</h2>
            <table className="kv">
              <tbody>
                {p.timetable.length > 0 ? (
                  p.timetable.map((t) => (
                    <tr key={t.event}>
                      <th>{t.event}</th>
                      <td>{t.date}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <th>Timetable</th>
                    <td className="muted">Not found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <footer className="foot">
          Generated from {p.sourceFiles.length} file{p.sourceFiles.length === 1 ? '' : 's'} ·{' '}
          {p.pageCount} pages · parsed entirely in your browser. Informational summary only — not
          investment advice. Always read the full prospectus.
        </footer>
      </section>

      {/* ================= PAGE 2 ================= */}
      <section className="sheet sheet--break">
        <h2 className="h2 h2--page">
          Supporting detail — {p.companyName.value ?? 'IPO'}
        </h2>

        <h3 className="h3">Financial track record (RM&rsquo;000 unless stated)</h3>
        <div className="scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Metric</th>
                {p.periods.map((period) => (
                  <th key={period.label} className="num">
                    {period.label}
                    {period.isStub && <span className="stub" title="Part-year period">*</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <FinRow label="Revenue" glossary="revenue" periods={p.periods} k="revenue" onEdit={onEdit} />
              <FinRow label="Gross profit" glossary="grossProfit" periods={p.periods} k="grossProfit" onEdit={onEdit} />
              <FinRow label="Other operating income" periods={p.periods} k="otherIncome" onEdit={onEdit} />
              <FinRow label="Profit before tax" glossary="pbt" periods={p.periods} k="pbt" onEdit={onEdit} />
              <FinRow label="Profit after tax" glossary="pat" periods={p.periods} k="pat" onEdit={onEdit} />
              <FinRow label="EPS (sen)" glossary="eps" periods={p.periods} k="eps" onEdit={onEdit} fmt={(v) => (v === null ? DASH : v.toFixed(2))} />
              <FinRow label="GP margin (%)" glossary="gpMargin" periods={p.periods} k="gpMargin" onEdit={onEdit} fmt={(v) => (v === null ? DASH : v.toFixed(2))} />
              <FinRow label="PAT margin (%)" glossary="patMargin" periods={p.periods} k="patMargin" onEdit={onEdit} fmt={(v) => (v === null ? DASH : v.toFixed(2))} />
              <FinRow label="Gearing (times)" glossary="gearing" periods={p.periods} k="gearing" onEdit={onEdit} fmt={(v) => (v === null ? DASH : v.toFixed(2))} />
              <FinRow label="Current ratio (times)" glossary="currentRatio" periods={p.periods} k="currentRatio" onEdit={onEdit} fmt={(v) => (v === null ? DASH : v.toFixed(2))} />
              <FinRow label="Receivables (days)" glossary="receivablesDays" periods={p.periods} k="receivablesDays" onEdit={onEdit} />
              <FinRow label="Dividends paid" periods={p.periods} k="dividends" onEdit={onEdit} />
            </tbody>
          </table>
        </div>
        {m.stubPeriod && (
          <p className="note">
            * <Term k="stubPeriod">{m.stubPeriod.label}</Term> is a part-year period. It is excluded
            from growth and CAGR calculations, and should not be compared directly with a full
            financial year.
          </p>
        )}

        {p.proForma.length > 0 && (
          <>
            <h3 className="h3">
              <Term k="proForma">Pro forma balance sheet</Term> — effect of the IPO
            </h3>
            <div className="scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>Metric</th>
                    {p.proForma.map((s) => (
                      <th key={s.label} className="num">{s.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th>Total assets (RM&rsquo;000)</th>
                    {p.proForma.map((s) => <td key={s.label} className="num">{fmtThousands(s.totalAssets)}</td>)}
                  </tr>
                  <tr>
                    <th>Total equity (RM&rsquo;000)</th>
                    {p.proForma.map((s) => <td key={s.label} className="num">{fmtThousands(s.totalEquity)}</td>)}
                  </tr>
                  <tr>
                    <th>Total liabilities (RM&rsquo;000)</th>
                    {p.proForma.map((s) => <td key={s.label} className="num">{fmtThousands(s.totalLiabilities)}</td>)}
                  </tr>
                  <tr>
                    <th><Term k="borrowings">Borrowings</Term> (RM&rsquo;000)</th>
                    {p.proForma.map((s) => <td key={s.label} className="num">{fmtThousands(s.borrowings)}</td>)}
                  </tr>
                  <tr>
                    <th><Term k="naPerShare">NA per share</Term> (RM)</th>
                    {p.proForma.map((s) => <td key={s.label} className="num">{s.naPerShare !== null ? s.naPerShare.toFixed(2) : DASH}</td>)}
                  </tr>
                  <tr>
                    <th><Term k="gearing">Gearing</Term> (times)</th>
                    {p.proForma.map((s) => <td key={s.label} className="num">{s.gearing !== null ? s.gearing.toFixed(2) : DASH}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="cols">
          <div className="col">
            <h3 className="h3">Share allocation</h3>
            {p.allocations.length > 0 ? (
              <table className="data data--compact">
                <thead>
                  <tr>
                    <th>Allocation</th>
                    <th className="num">Shares</th>
                    <th className="num">%</th>
                  </tr>
                </thead>
                <tbody>
                  {(['public_issue', 'offer_for_sale'] as const).map((tranche) => {
                    const rows = p.allocations.filter((a) => a.tranche === tranche);
                    if (rows.length === 0) return null;
                    return (
                      <Fragment key={tranche}>
                        <tr className="group">
                          <th colSpan={3}>
                            <Term k={tranche === 'public_issue' ? 'publicIssue' : 'offerForSale'}>
                              {tranche === 'public_issue'
                                ? 'Public Issue (to company)'
                                : 'Offer for Sale (to owners)'}
                            </Term>
                          </th>
                        </tr>
                        {rows.map((a, i) => (
                          <tr key={`${tranche}-${i}`}>
                            <td>
                              {a.label}
                              {a.isRetailBallot && (
                                <>
                                  {' '}
                                  <span className="tag">
                                    <Term k="balloting">ballot</Term>
                                  </span>
                                </>
                              )}
                              {/MITI|Bumiputera/i.test(a.label) && (
                                <>
                                  {' '}
                                  <span className="tag">
                                    <Term k="bumiputeraAllocation">policy</Term>
                                  </span>
                                </>
                              )}
                            </td>
                            <td className="num">{fmtThousands(a.shares)}</td>
                            <td className="num">{fmtPct(a.pctOfCapital, 2)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="muted">Allocation table not found.</p>
            )}
          </div>

          <div className="col">
            <h3 className="h3">Utilisation of proceeds</h3>
            {p.proceedsUses.length > 0 ? (
              <table className="data data--compact">
                <thead>
                  <tr>
                    <th>Purpose</th>
                    <th className="num">RM&rsquo;000</th>
                    <th className="num">%</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {p.proceedsUses.map((u, i) => (
                    <tr key={i}>
                      <td>
                        <span
                          className="dot"
                          style={{ background: CATEGORY_COLOURS[u.category] }}
                          title={CATEGORY_LABELS[u.category]}
                        />
                        {u.label}
                      </td>
                      <td className="num">{fmtThousands(u.amount)}</td>
                      <td className="num">{fmtPct(u.pct, 2)}</td>
                      <td className="tiny">{u.timeframe}</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <th>Total</th>
                    <td className="num">{fmtThousands(p.proceedsTotal.value)}</td>
                    <td className="num">100%</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            ) : (
              <p className="muted">Not found.</p>
            )}
          </div>
        </div>

        <div className="cols">
          <div className="col">
            <h3 className="h3">Board &amp; management</h3>
            {p.directors.length + p.management.length > 0 ? (
              <table className="data data--compact">
                <tbody>
                  {p.directors.map((d) => (
                    <tr key={`d-${d.name}`}>
                      <td>{d.name}</td>
                      <td className="tiny">
                        {d.isIndependent ? (
                          <Term k="independentDirector">{d.role}</Term>
                        ) : (
                          d.role
                        )}
                      </td>
                    </tr>
                  ))}
                  {p.management.map((d) => (
                    <tr key={`m-${d.name}`}>
                      <td>{d.name}</td>
                      <td className="tiny">{d.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">Not found.</p>
            )}
          </div>

          <div className="col">
            <h3 className="h3">Key risks stated by the company</h3>
            {p.riskFactors.length > 0 ? (
              <ul className="risks">
                {p.riskFactors.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">Risk-factor summary not found.</p>
            )}
          </div>
        </div>

        <ParseAudit parsed={p} relevance={m.relevance} />

        <footer className="foot">
          This report was generated locally from the prospectus PDFs. Figures are extracted
          mechanically and may contain errors — verify against the source document before acting.
          Not investment advice.
        </footer>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Kpi({
  label,
  glossary,
  value,
  raw,
  path,
  onEdit,
  edited,
  derived,
  unit,
}: {
  label: string;
  glossary?: string;
  value: string;
  raw?: number | null;
  path?: string;
  onEdit?: (path: string, value: number | string | null) => void;
  edited?: boolean;
  derived?: boolean;
  unit?: string;
}) {
  return (
    <div className="kpi">
      <div className="kpi__label">
        {glossary ? <Term k={glossary}>{label}</Term> : label}
      </div>
      <div className="kpi__value">
        {derived || !path || !onEdit ? (
          value
        ) : (
          <Editable
            display={value}
            raw={raw ?? null}
            missing={raw === null || raw === undefined}
            edited={edited}
            unit={unit}
            onCommit={(v) => onEdit(path, v)}
          />
        )}
      </div>
      {derived && <div className="kpi__calc">calculated</div>}
    </div>
  );
}

function FlagCard({ flag }: { flag: Flag }) {
  return (
    <div className={`flag flag--${flag.level}`}>
      <div className="flag__top">
        <span className="flag__icon" aria-hidden="true">
          {FLAG_ICON[flag.level]}
        </span>
        <span className="flag__label">
          {flag.glossaryKey ? <Term k={flag.glossaryKey}>{flag.label}</Term> : flag.label}
        </span>
      </div>
      <div className="flag__value">{flag.display}</div>
      <div className="flag__rule">{flag.rule}</div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  note,
  glossary,
}: {
  label: string;
  value: string;
  note?: string;
  glossary?: string;
}) {
  return (
    <div className="mini">
      <div className="mini__label">{glossary ? <Term k={glossary}>{label}</Term> : label}</div>
      <div className="mini__value">{value}</div>
      {note && <div className="mini__note">{note}</div>}
    </div>
  );
}

function FinRow({
  label,
  glossary,
  periods,
  k,
  onEdit,
  fmt = fmtThousands,
}: {
  label: string;
  glossary?: string;
  periods: ParsedProspectus['periods'];
  k: 'revenue' | 'grossProfit' | 'otherIncome' | 'pbt' | 'pat' | 'eps' | 'gpMargin' | 'patMargin' | 'gearing' | 'currentRatio' | 'receivablesDays' | 'dividends';
  onEdit: (path: string, value: number | string | null) => void;
  fmt?: (v: number | null) => string;
}) {
  return (
    <tr>
      <th>{glossary ? <Term k={glossary}>{label}</Term> : label}</th>
      {periods.map((period, i) => (
        <td key={period.label} className="num">
          <Editable
            display={fmt(period[k])}
            raw={period[k]}
            missing={period[k] === null}
            onCommit={(v) => onEdit(`periods.${i}.${k}`, v)}
          />
        </td>
      ))}
    </tr>
  );
}

/**
 * Honest reporting of extraction gaps.
 *
 * Showing what the parser missed is more useful than silently rendering blanks:
 * the user can fill the gap in and knows exactly how much of the report is
 * document-derived.
 */
function ParseAudit({
  parsed,
  relevance,
}: {
  parsed: ParsedProspectus;
  relevance: RelevanceProfile;
}) {
  const scalars = Object.entries(parsed).filter(
    ([, v]) => v && typeof v === 'object' && 'confidence' in v,
  ) as [string, { value: unknown; confidence: string; page?: number; edited?: boolean }][];

  // Fields that are empty only because they do not apply to this business are
  // reported separately (and calmly) rather than as extraction failures.
  const naKeys = new Set<string>();
  if (relevance.orderBook === 'not_applicable') {
    naKeys.add('orderBook');
    naKeys.add('orderBookRaw');
  }
  if (relevance.customerConcentration === 'not_applicable') {
    naKeys.add('customerConcentration');
  }

  const missingList = scalars
    .filter(([k, v]) => v.value === null && !naKeys.has(k))
    .map(([k]) => k);
  const naList = scalars.filter(([k, v]) => v.value === null && naKeys.has(k)).map(([k]) => k);
  const lowConfidence = scalars
    .filter(([, v]) => v.value !== null && (v.confidence === 'low' || v.confidence === 'medium'))
    .map(([k]) => k);
  const editedList = scalars.filter(([, v]) => v.edited).map(([k]) => k);

  const LABELS: Record<string, string> = {
    companyName: 'Company name',
    registrationNo: 'Registration number',
    listingBoard: 'Listing board',
    prospectusDate: 'Prospectus date',
    industry: 'Sector',
    businessDescription: 'Business description',
    ipoPrice: 'IPO price',
    marketCap: 'Market capitalisation',
    enlargedShares: 'Enlarged share capital',
    peMultiple: 'PE multiple',
    naPerShareAfter: 'NA per share after IPO',
    dilutionPct: 'Dilution',
    publicIssueShares: 'Public Issue shares',
    publicIssueGrossRM: 'Public Issue proceeds',
    offerForSaleShares: 'Offer for Sale shares',
    offerForSaleGrossRM: 'Offer for Sale proceeds',
    proceedsTotal: 'Total proceeds',
    openDate: 'Opening date',
    closeDate: 'Closing date',
    listingDate: 'Listing date',
    orderBook: 'Order book',
    orderBookRaw: 'Order book (as stated)',
    customerConcentration: 'Customer concentration',
    employees: 'Employee count',
    moratorium: 'Moratorium terms',
    dividendPolicy: 'Dividend policy',
    hasFormalDividendPolicy: 'Formal dividend policy',
  };
  const name = (k: string) => LABELS[k] ?? k;

  // Exclude not-applicable fields from the coverage denominator so the score
  // reflects only what the parser was actually expected to find.
  const applicableCount = scalars.length - naList.length;
  const found = applicableCount - missingList.length;

  return (
    <div className="audit">
      <h3 className="h3">Extraction audit</h3>
      <p className="audit__summary">
        Found <strong>{found}</strong> of {applicableCount} applicable headline fields,{' '}
        <strong>{parsed.periods.length}</strong> financial periods,{' '}
        <strong>{parsed.proceedsUses.length}</strong> proceeds line items and{' '}
        <strong>{parsed.allocations.length}</strong> allocation rows.
      </p>
      {missingList.length > 0 && (
        <p className="audit__line">
          <span className="audit__tag audit__tag--miss">Not found</span>{' '}
          {missingList.map(name).join(', ')}. Click the matching{' '}
          <span className="editable editable--missing editable--demo">add</span> control on the
          report to enter these manually.
        </p>
      )}
      {naList.length > 0 && (
        <p className="audit__line">
          <span className="audit__tag audit__tag--na">Not applicable</span>{' '}
          {naList.map(name).join(', ')} — not relevant to this type of business, so omitted from the
          report rather than missed.
        </p>
      )}
      {lowConfidence.length > 0 && (
        <p className="audit__line">
          <span className="audit__tag audit__tag--low">Worth checking</span>{' '}
          {lowConfidence.map(name).join(', ')} — matched with lower confidence, so verify against
          the prospectus.
        </p>
      )}
      {editedList.length > 0 && (
        <p className="audit__line">
          <span className="audit__tag audit__tag--edit">You edited</span>{' '}
          {editedList.map(name).join(', ')}.
        </p>
      )}
      <p className="audit__line audit__line--files">
        Source: {parsed.sourceFiles.join(' · ') || 'unknown'}
      </p>
    </div>
  );
}

/**
 * Derives decision-relevant metrics and transparent rule-based flags.
 *
 * Deliberate design choices:
 *  - No overall score or buy/sell verdict. The tool surfaces numbers and states
 *    the threshold each one was measured against; the investor decides.
 *  - Stub (part-year) periods are excluded from growth maths so a 4-month
 *    period is never compared against a 12-month year.
 *  - Every flag carries the rule that produced it, so a user can disagree with
 *    the threshold rather than having to trust a black box.
 */

import type {
  Applicability,
  DerivedMetrics,
  Flag,
  FinancialPeriod,
  ParsedProspectus,
  RelevanceProfile,
  Shareholder,
} from './types.ts';

// Units: monetary period figures are RM'000; deal figures are RM.
const THOUSAND = 1_000;

function cagr(first: number, last: number, years: number): number | null {
  if (years <= 0 || first <= 0 || last <= 0) return null;
  return (Math.pow(last / first, 1 / years) - 1) * 100;
}

function pctChange(from: number, to: number): number | null {
  if (from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((b - a) / 86_400_000);
}

/** Parses "22 September 2026" into an ISO date. */
function dateToIso(s: string | null): string | null {
  if (!s) return null;
  const months: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  const m = s.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (!m) return null;
  const mo = months[m[2].toLowerCase()];
  if (!mo) return null;
  return `${m[3]}-${String(mo).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
}

function describeTrend(values: number[]): string | null {
  if (values.length < 2) return null;
  const diffs: number[] = [];
  for (let i = 1; i < values.length; i++) diffs.push(values[i] - values[i - 1]);
  const ups = diffs.filter((d) => d > 0.25).length;
  const downs = diffs.filter((d) => d < -0.25).length;
  const net = values[values.length - 1] - values[0];

  if (ups > 0 && downs > 0) {
    // Mixed direction: describe by where it ended up versus the peak.
    const peak = Math.max(...values);
    const last = values[values.length - 1];
    if (peak - last > 1) return 'peaked then compressing';
    return 'volatile';
  }
  if (net > 1) return 'improving';
  if (net < -1) return 'compressing';
  return 'stable';
}

export function analyse(p: ParsedProspectus, now: Date = new Date()): DerivedMetrics {
  const fullPeriods = p.periods.filter((x) => !x.isStub);
  const latestFull = fullPeriods.length > 0 ? fullPeriods[fullPeriods.length - 1] : null;
  const stubPeriod = p.periods.find((x) => x.isStub) ?? null;

  // --- Growth -------------------------------------------------------------
  let revenueCagr: number | null = null;
  let patCagr: number | null = null;
  const withRevenue = fullPeriods.filter((x) => x.revenue !== null);
  if (withRevenue.length >= 2) {
    const a = withRevenue[0];
    const b = withRevenue[withRevenue.length - 1];
    revenueCagr = cagr(a.revenue!, b.revenue!, withRevenue.length - 1);
  }
  const withPat = fullPeriods.filter((x) => x.pat !== null && x.pat > 0);
  if (withPat.length >= 2) {
    const a = withPat[0];
    const b = withPat[withPat.length - 1];
    patCagr = cagr(a.pat!, b.pat!, withPat.length - 1);
  }

  let revenueGrowthLatest: number | null = null;
  let patGrowthLatest: number | null = null;
  if (withRevenue.length >= 2) {
    const prev = withRevenue[withRevenue.length - 2];
    const last = withRevenue[withRevenue.length - 1];
    revenueGrowthLatest = pctChange(prev.revenue!, last.revenue!);
  }
  const patSeries = fullPeriods.filter((x) => x.pat !== null);
  if (patSeries.length >= 2) {
    const prev = patSeries[patSeries.length - 2];
    const last = patSeries[patSeries.length - 1];
    patGrowthLatest = pctChange(prev.pat!, last.pat!);
  }

  // --- Margins ------------------------------------------------------------
  const gpMargins = p.periods
    .map((x) => x.gpMargin)
    .filter((v): v is number => v !== null);
  const marginTrend = describeTrend(gpMargins);
  const gpMarginChange =
    gpMargins.length >= 2 ? gpMargins[gpMargins.length - 1] - gpMargins[0] : null;

  // --- Revenue visibility -------------------------------------------------
  let orderBookCoverage: number | null = null;
  if (p.orderBook.value !== null && latestFull?.revenue) {
    orderBookCoverage = p.orderBook.value / (latestFull.revenue * THOUSAND);
  }

  // --- Valuation ----------------------------------------------------------
  let priceToBook: number | null = null;
  if (p.ipoPrice.value !== null && p.naPerShareAfter.value) {
    priceToBook = p.ipoPrice.value / p.naPerShareAfter.value;
  }

  // --- Proceeds quality ---------------------------------------------------
  const totalProceeds =
    p.proceedsTotal.value ??
    (p.proceedsUses.length > 0
      ? p.proceedsUses.reduce((s, u) => s + (u.amount ?? 0), 0)
      : null);

  const sumCategory = (cat: string) =>
    p.proceedsUses.filter((u) => u.category === cat).reduce((s, u) => s + (u.amount ?? 0), 0);

  let proceedsToGrowthPct: number | null = null;
  let proceedsToDebtPct: number | null = null;
  if (totalProceeds && totalProceeds > 0 && p.proceedsUses.length > 0) {
    proceedsToGrowthPct = (sumCategory('growth') / totalProceeds) * 100;
    proceedsToDebtPct = (sumCategory('debt') / totalProceeds) * 100;
  }

  // --- Who gets the money -------------------------------------------------
  const piRM = p.publicIssueGrossRM.value;
  const ofsRM = p.offerForSaleGrossRM.value;
  let totalIpoValueRM: number | null = null;
  let vendorCashOutPct: number | null = null;
  let newMoneyPct: number | null = null;
  if (piRM !== null || ofsRM !== null) {
    totalIpoValueRM = (piRM ?? 0) + (ofsRM ?? 0);
    if (totalIpoValueRM > 0) {
      vendorCashOutPct = ((ofsRM ?? 0) / totalIpoValueRM) * 100;
      newMoneyPct = ((piRM ?? 0) / totalIpoValueRM) * 100;
    }
  }

  // --- Retail access ------------------------------------------------------
  const retailBallotShares = p.allocations
    .filter((a) => a.isRetailBallot)
    .reduce<number | null>((acc, a) => (a.shares === null ? acc : (acc ?? 0) + a.shares), null);
  let retailBallotPct: number | null = null;
  if (retailBallotShares !== null && p.enlargedShares.value) {
    retailBallotPct = (retailBallotShares / p.enlargedShares.value) * 100;
  }

  // --- Balance sheet ------------------------------------------------------
  // "Before" = audited column; "after" = final pro forma column.
  let gearingBefore: number | null = null;
  let gearingAfter: number | null = null;
  if (p.proForma.length > 0) {
    gearingBefore = p.proForma[0].gearing;
    for (let i = p.proForma.length - 1; i >= 0; i--) {
      if (p.proForma[i].gearing !== null) {
        gearingAfter = p.proForma[i].gearing;
        break;
      }
    }
  }
  if (gearingBefore === null) {
    const withGearing = p.periods.filter((x) => x.gearing !== null);
    gearingBefore = withGearing.length
      ? withGearing[withGearing.length - 1].gearing
      : null;
  }

  const lastWith = <K extends keyof FinancialPeriod>(key: K): number | null => {
    for (let i = p.periods.length - 1; i >= 0; i--) {
      const v = p.periods[i][key];
      if (typeof v === 'number') return v;
    }
    return null;
  };
  const latestCurrentRatio = lastWith('currentRatio');
  const latestReceivablesDays = lastWith('receivablesDays');

  // --- Concentration ------------------------------------------------------
  const conc = p.customerConcentration.value;
  let topCustomerConcentration: number | null = null;
  if (conc && conc.length > 0) {
    // Use the most recent full-year figure, capping reporting artefacts >100%.
    const usable = conc.map((c) => Math.min(c, 100));
    topCustomerConcentration = usable[usable.length - 1] ?? null;
  }

  // --- Ownership ----------------------------------------------------------
  let largestShareholder: Shareholder | null = null;
  for (const s of p.shareholders) {
    if (s.afterPct === null) continue;
    if (largestShareholder === null || s.afterPct > (largestShareholder.afterPct ?? 0)) {
      largestShareholder = s;
    }
  }
  const founderRetainedPct = largestShareholder?.afterPct ?? null;

  const independentDirectorRatio =
    p.directors.length > 0
      ? (p.directors.filter((d) => d.isIndependent).length / p.directors.length) * 100
      : null;

  // --- Timing -------------------------------------------------------------
  let daysUntilClose: number | null = null;
  const closeIso = dateToIso(p.closeDate.value);
  if (closeIso) {
    const d = daysBetween(now.toISOString().slice(0, 10), closeIso);
    daysUntilClose = Number.isNaN(d) ? null : d;
  }

  const metrics: DerivedMetrics = {
    fullPeriods,
    latestFull,
    stubPeriod,
    revenueCagr,
    patCagr,
    revenueGrowthLatest,
    patGrowthLatest,
    marginTrend,
    gpMarginChange,
    orderBookCoverage,
    priceToBook,
    proceedsToGrowthPct,
    proceedsToDebtPct,
    vendorCashOutPct,
    newMoneyPct,
    totalIpoValueRM,
    retailBallotPct,
    retailBallotShares,
    gearingBefore,
    gearingAfter,
    latestCurrentRatio,
    latestReceivablesDays,
    topCustomerConcentration,
    founderRetainedPct,
    largestShareholder,
    independentDirectorRatio,
    daysUntilClose,
    flags: [],
    relevance: computeRelevance(p),
  };

  metrics.flags = buildFlags(p, metrics);
  return metrics;
}

// ---------------------------------------------------------------------------
// Relevance: which sector-specific metrics apply to this business
// ---------------------------------------------------------------------------

/**
 * Decides whether the sector-specific metrics (order book, customer
 * concentration) apply to this company.
 *
 * Design rule — a metric is 'not_applicable' only because of the *business
 * type*, never merely because it is empty:
 *   - If the value was found, it is 'present' (always shown).
 *   - Else if the business is one where the metric is a normal disclosure
 *     (project/contract work for order book; concentrated B2B for customers)
 *     but it is empty, it is 'missed' (kept visible as a real gap).
 *   - Else the metric does not belong to this business, so 'not_applicable'
 *     (safe to hide).
 *
 * Detection leans on the parsed business description and the whole-document
 * signal already captured, so it is conservative: when unsure, it errs toward
 * 'missed' (keep visible) rather than hiding something that might be real.
 */
function computeRelevance(p: ParsedProspectus): RelevanceProfile {
  const text = `${p.businessDescription.value ?? ''} ${p.industry.value ?? ''}`.toLowerCase();

  // Businesses whose revenue is contract/project-based and therefore normally
  // report an order book / unbilled contract value.
  const projectBased =
    /construction|contractor|engineering|epcc|epc\b|fabrication|infrastructure|building works|civil works|shipbuild|turnkey|design and build|oil and gas|marine|property develop|order book|unbilled/.test(
      text,
    );

  // Businesses that typically disclose customer concentration are B2B / project
  // / manufacturing / distribution. Mass consumer/retail/healthcare serve many
  // end customers and do not report a "top-5 customers" share.
  const massConsumer =
    /retail|mini[- ]?market|convenience store|grocery|hospital|healthcare|medical centre|clinic|restaurant|consumer|f&b|e-commerce|education|tuition|vending|massage|leisure|wellness|spa|fitness|gym|entertainment|rental plan|hospitality/.test(
      text,
    );
  const concentrationLikely =
    projectBased ||
    /manufactur|fabricat|distribut|wholesale|supply|b2b|original equipment|oem|contract/.test(text);

  const relevance: RelevanceProfile = {
    orderBook: p.orderBook.value !== null
      ? 'present'
      : projectBased
        ? 'missed'
        : 'not_applicable',
    customerConcentration: (p.customerConcentration.value?.length ?? 0) > 0
      ? 'present'
      : concentrationLikely && !massConsumer
        ? 'missed'
        : 'not_applicable',
  };
  return relevance;
}

// ---------------------------------------------------------------------------
// Flag rules
// ---------------------------------------------------------------------------

const UNKNOWN = 'Not found in prospectus';
const NOT_APPLICABLE = 'Not applicable to this type of business';

function buildFlags(p: ParsedProspectus, m: DerivedMetrics): Flag[] {
  const flags: Flag[] = [];
  const add = (f: Flag) => flags.push(f);

  // Applicability for a universal signal: present when found, else a genuine
  // gap ('missed'). Universal signals are never 'not_applicable'.
  const univ = (found: boolean): Applicability => (found ? 'present' : 'missed');

  // Customer concentration (sector-specific applicability)
  {
    const v = m.topCustomerConcentration;
    const applicability =
      v !== null ? 'present' : m.relevance.customerConcentration;
    add({
      id: 'concentration',
      label: 'Customer concentration',
      glossaryKey: 'customerConcentration',
      applicability,
      display:
        v !== null
          ? `Top 5 = ${v.toFixed(1)}% of revenue`
          : applicability === 'not_applicable'
            ? 'n/a for this business'
            : '—',
      level: v === null ? 'unknown' : v > 70 ? 'concern' : v >= 40 ? 'watch' : 'good',
      rule:
        v !== null
          ? 'Concern above 70%, watch 40–70%, good below 40% of revenue from the top 5 customers'
          : applicability === 'not_applicable'
            ? NOT_APPLICABLE
            : UNKNOWN,
    });
  }

  // Gearing after IPO
  {
    const v = m.gearingAfter ?? m.gearingBefore;
    const isAfter = m.gearingAfter !== null;
    add({
      id: 'gearing',
      label: `Gearing${isAfter ? ' (post-IPO)' : ''}`,
      glossaryKey: 'gearing',
      applicability: univ(v !== null),
      display: v === null ? '—' : `${v.toFixed(2)}×`,
      level: v === null ? 'unknown' : v > 2 ? 'concern' : v >= 1 ? 'watch' : 'good',
      rule:
        v === null ? UNKNOWN : 'Concern above 2×, watch 1–2×, good below 1× of debt to equity',
    });
  }

  // Current ratio
  {
    const v = m.latestCurrentRatio;
    add({
      id: 'currentRatio',
      label: 'Current ratio',
      glossaryKey: 'currentRatio',
      applicability: univ(v !== null),
      display: v === null ? '—' : `${v.toFixed(2)}×`,
      level: v === null ? 'unknown' : v < 1 ? 'concern' : v < 1.2 ? 'watch' : 'good',
      rule: v === null ? UNKNOWN : 'Concern below 1.0×, watch 1.0–1.2×, good above 1.2×',
    });
  }

  // Margin trend
  {
    const t = m.marginTrend;
    const chg = m.gpMarginChange;
    const level =
      t === null
        ? 'unknown'
        : t === 'improving'
          ? 'good'
          : t === 'stable'
            ? 'good'
            : 'watch';
    add({
      id: 'marginTrend',
      label: 'Gross margin trend',
      glossaryKey: 'marginTrend',
      applicability: univ(t !== null),
      display:
        t === null ? '—' : `${t}${chg !== null ? ` (${chg >= 0 ? '+' : ''}${chg.toFixed(1)} pp)` : ''}`,
      level,
      rule:
        t === null
          ? UNKNOWN
          : 'Good if improving or stable; watch if compressing or volatile across reported periods',
    });
  }

  // Order book coverage (sector-specific applicability)
  {
    const v = m.orderBookCoverage;
    const applicability = v !== null ? 'present' : m.relevance.orderBook;
    add({
      id: 'orderBook',
      label: 'Revenue visibility',
      glossaryKey: 'orderBookCoverage',
      applicability,
      display:
        v !== null
          ? `${v.toFixed(1)} years secured`
          : applicability === 'not_applicable'
            ? 'n/a for this business'
            : '—',
      level: v === null ? 'unknown' : v >= 2 ? 'good' : v >= 1 ? 'watch' : 'concern',
      rule:
        v !== null
          ? 'Good above 2 years of order book coverage, watch 1–2 years, concern below 1 year'
          : applicability === 'not_applicable'
            ? NOT_APPLICABLE
            : UNKNOWN,
    });
  }

  // Profit direction in the latest full year
  {
    const v = m.patGrowthLatest;
    add({
      id: 'profitTrend',
      label: 'Latest-year profit',
      glossaryKey: 'pat',
      applicability: univ(v !== null),
      display: v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}% YoY`,
      level: v === null ? 'unknown' : v >= 0 ? 'good' : 'watch',
      rule: v === null ? UNKNOWN : 'Watch if profit fell in the most recent full financial year',
    });
  }

  // Proceeds to growth
  {
    const v = m.proceedsToGrowthPct;
    add({
      id: 'proceedsGrowth',
      label: 'Proceeds to growth',
      glossaryKey: 'proceedsToGrowth',
      applicability: univ(v !== null),
      display: v === null ? '—' : `${v.toFixed(1)}% of raise`,
      level: v === null ? 'unknown' : v >= 50 ? 'good' : 'watch',
      rule:
        v === null
          ? UNKNOWN
          : 'Good if at least half the company proceeds fund growth rather than debt, working capital or listing fees',
    });
  }

  // Vendor cash-out
  {
    const v = m.vendorCashOutPct;
    add({
      id: 'vendorCashOut',
      label: 'Vendor cash-out',
      glossaryKey: 'vendorCashOut',
      applicability: univ(v !== null),
      display: v === null ? '—' : `${v.toFixed(1)}% to existing owners`,
      level: v === null ? 'unknown' : v > 50 ? 'concern' : v > 30 ? 'watch' : 'good',
      rule:
        v === null
          ? UNKNOWN
          : 'Concern above 50% of the raise going to existing shareholders, watch 30–50%, good below 30%',
    });
  }

  // Dividend policy
  {
    const formal = p.hasFormalDividendPolicy.value;
    add({
      id: 'dividend',
      label: 'Dividend policy',
      glossaryKey: 'dividendPolicy',
      applicability: univ(formal !== null),
      display:
        formal === null ? '—' : formal ? (p.dividendPolicy.value ?? 'Formal policy') : 'None formal',
      level: formal === null ? 'unknown' : formal ? 'good' : 'watch',
      rule:
        formal === null
          ? UNKNOWN
          : 'Watch if there is no formal dividend policy, since returns then rely entirely on price appreciation',
    });
  }

  // Founder retained stake
  {
    const v = m.founderRetainedPct;
    add({
      id: 'founderStake',
      label: 'Founder retained stake',
      glossaryKey: 'founderRetained',
      applicability: univ(v !== null),
      display: v === null ? '—' : `${v.toFixed(1)}% after IPO`,
      level: v === null ? 'unknown' : v >= 50 ? 'good' : v >= 30 ? 'watch' : 'concern',
      rule:
        v === null
          ? UNKNOWN
          : 'Good at 50% or more retained (strong alignment), watch 30–50%, concern below 30%',
    });
  }

  // Board independence
  {
    const v = m.independentDirectorRatio;
    add({
      id: 'boardIndependence',
      label: 'Board independence',
      glossaryKey: 'independentDirector',
      applicability: univ(v !== null),
      display: v === null ? '—' : `${v.toFixed(0)}% independent`,
      level: v === null ? 'unknown' : v >= 50 ? 'good' : v >= 33.3 ? 'watch' : 'concern',
      rule:
        v === null
          ? UNKNOWN
          : 'Bursa requires at least one-third independent; good at 50% or above',
    });
  }

  // Valuation context
  {
    const v = p.peMultiple.value;
    add({
      id: 'valuation',
      label: 'PE multiple',
      glossaryKey: 'peMultiple',
      applicability: univ(v !== null),
      display: v === null ? '—' : `${v.toFixed(1)}×`,
      level: v === null ? 'unknown' : v > 25 ? 'watch' : 'good',
      rule:
        v === null
          ? UNKNOWN
          : 'Watch above 25×. Always compare against listed peers in the same industry',
    });
  }

  // Retail access
  {
    const v = m.retailBallotPct;
    add({
      id: 'retailAccess',
      label: 'Retail ballot pool',
      glossaryKey: 'retailBallotPct',
      applicability: univ(v !== null),
      display: v === null ? '—' : `${v.toFixed(2)}% of company`,
      level: v === null ? 'unknown' : v >= 5 ? 'good' : 'watch',
      rule:
        v === null
          ? UNKNOWN
          : 'Watch below 5% of enlarged capital reserved for public balloting, as allotment odds are lower',
    });
  }

  return flags;
}

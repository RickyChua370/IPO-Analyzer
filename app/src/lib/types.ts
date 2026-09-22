/**
 * Data model for Bursa Malaysia IPO prospectus analysis.
 *
 * Design principle: every extracted value carries provenance (page number,
 * raw matched text) and a confidence level, so the UI can be honest about
 * what it found, what it guessed, and what it missed. Users can override
 * any field and all derived metrics recompute.
 */

export type Confidence = 'high' | 'medium' | 'low' | 'missing';

/** A single extracted value with provenance. */
export interface Field<T> {
  value: T | null;
  /** Raw text snippet the value was parsed from (for the audit trail). */
  raw?: string;
  /** 1-indexed page number in the stitched document. */
  page?: number;
  confidence: Confidence;
  /** True if the user manually corrected this value. */
  edited?: boolean;
}

export function field<T>(
  value: T | null,
  opts: { raw?: string; page?: number; confidence?: Confidence } = {},
): Field<T> {
  return {
    value,
    raw: opts.raw,
    page: opts.page,
    confidence: opts.confidence ?? (value === null ? 'missing' : 'high'),
  };
}

export function missing<T>(): Field<T> {
  return { value: null, confidence: 'missing' };
}

// ---------------------------------------------------------------------------
// Financial periods
// ---------------------------------------------------------------------------

/**
 * One reporting period from the prospectus financial highlights.
 * `isStub` marks a partial period (FPE = financial period ended), which must
 * never be silently compared against a full 12-month year.
 */
export interface FinancialPeriod {
  /** e.g. "FYE 2022", "FPE 2026" */
  label: string;
  /** Calendar year, parsed from the label where possible. */
  year: number | null;
  /** True for FPE / partial periods. */
  isStub: boolean;
  /** All monetary figures in RM'000. */
  revenue: number | null;
  grossProfit: number | null;
  otherIncome: number | null;
  pbt: number | null;
  pat: number | null;
  /** Earnings per share in sen. */
  eps: number | null;
  /** Percentages, as reported. */
  gpMargin: number | null;
  patMargin: number | null;
  /** Dividends declared and paid, RM'000. */
  dividends: number | null;
  // Key ratios, where reported per-period
  receivablesDays: number | null;
  currentRatio: number | null;
  gearing: number | null;
}

export function emptyPeriod(label: string): FinancialPeriod {
  const m = label.match(/(\d{4})/);
  return {
    label,
    year: m ? Number(m[1]) : null,
    isStub: /^FPE/i.test(label),
    revenue: null,
    grossProfit: null,
    otherIncome: null,
    pbt: null,
    pat: null,
    eps: null,
    gpMargin: null,
    patMargin: null,
    dividends: null,
    receivablesDays: null,
    currentRatio: null,
    gearing: null,
  };
}

// ---------------------------------------------------------------------------
// IPO structure
// ---------------------------------------------------------------------------

/** One line of the IPO share allocation table. */
export interface Allocation {
  label: string;
  /** Which half of the offering this line belongs to. */
  tranche: 'public_issue' | 'offer_for_sale';
  shares: number | null;
  /** Amount raised, in RM (not thousands). */
  amountRM: number | null;
  /** Percent of enlarged share capital. */
  pctOfCapital: number | null;
  /** True when reserved for the retail public via balloting. */
  isRetailBallot: boolean;
}

/** One line of the utilisation-of-proceeds table. */
export interface ProceedsUse {
  label: string;
  /** RM'000 */
  amount: number | null;
  pct: number | null;
  timeframe: string | null;
  /**
   * Classification used to compute "proceeds quality":
   *  - growth: capex, expansion, R&D, acquisitions, software
   *  - debt: repayment of borrowings
   *  - working_capital: general working capital
   *  - expenses: listing / issue expenses
   */
  category: 'growth' | 'debt' | 'working_capital' | 'expenses' | 'other';
}

export interface TimetableEntry {
  event: string;
  date: string;
  /** ISO date if parseable. */
  iso: string | null;
}

export interface Shareholder {
  name: string;
  /** Percent held directly before the IPO. */
  beforePct: number | null;
  /** Percent held directly after the IPO. */
  afterPct: number | null;
}

export interface Person {
  name: string;
  role: string;
  isIndependent: boolean;
  isExecutive: boolean;
}

// ---------------------------------------------------------------------------
// Pro forma balance sheet (post-IPO effects)
// ---------------------------------------------------------------------------

export interface ProFormaSnapshot {
  /** Column label, e.g. "Audited", "After IPO", "After utilisation". */
  label: string;
  totalAssets: number | null;
  totalEquity: number | null;
  totalLiabilities: number | null;
  borrowings: number | null;
  /** RM per share. */
  naPerShare: number | null;
  gearing: number | null;
  /** Shares in issue, in thousands. */
  shares: number | null;
}

// ---------------------------------------------------------------------------
// Top-level parsed document
// ---------------------------------------------------------------------------

export interface ParsedProspectus {
  // Identity
  companyName: Field<string>;
  registrationNo: Field<string>;
  /** "ACE Market" | "Main Market" | "LEAP Market" */
  listingBoard: Field<string>;
  prospectusDate: Field<string>;
  industry: Field<string>;
  businessDescription: Field<string>;

  // Deal terms
  ipoPrice: Field<number>;
  marketCap: Field<number>;
  enlargedShares: Field<number>;
  peMultiple: Field<number>;
  naPerShareAfter: Field<number>;
  dilutionPct: Field<number>;

  // Structure
  allocations: Allocation[];
  publicIssueShares: Field<number>;
  publicIssueGrossRM: Field<number>;
  offerForSaleShares: Field<number>;
  offerForSaleGrossRM: Field<number>;

  // Proceeds
  proceedsUses: ProceedsUse[];
  proceedsTotal: Field<number>;

  // Dates
  timetable: TimetableEntry[];
  openDate: Field<string>;
  closeDate: Field<string>;
  listingDate: Field<string>;

  // Financials
  periods: FinancialPeriod[];
  proForma: ProFormaSnapshot[];

  // Operational
  orderBook: Field<number>;
  orderBookRaw: Field<string>;
  customerConcentration: Field<number[]>;
  employees: Field<number>;

  // People & ownership
  shareholders: Shareholder[];
  directors: Person[];
  management: Person[];
  moratorium: Field<string>;

  // Policy
  dividendPolicy: Field<string>;
  hasFormalDividendPolicy: Field<boolean>;

  // Risk
  riskFactors: string[];

  // Meta
  /** Total pages across all uploaded parts. */
  pageCount: number;
  /** Names of the source files, in stitched order. */
  sourceFiles: string[];
  parsedAt: string;
}

// ---------------------------------------------------------------------------
// Derived analysis
// ---------------------------------------------------------------------------

export type FlagLevel = 'good' | 'watch' | 'concern' | 'unknown';

/**
 * Why a value is empty — the distinction that drives what the UI does with it.
 *
 *  - 'present'         the value was found; show it normally.
 *  - 'missed'          the value applies to this business but the parser did
 *                      not find it; must stay visible as a genuine gap.
 *  - 'not_applicable'  the metric does not exist for this kind of business
 *                      (e.g. order book for a hospital); safe to hide so the
 *                      report does not look like a failed extraction.
 *
 * The rule: a field is only ever 'not_applicable' by virtue of the business
 * type, never merely because it is empty. An applicable-but-empty field is
 * always 'missed', so we never hide a real extraction failure.
 */
export type Applicability = 'present' | 'missed' | 'not_applicable';

export interface Flag {
  id: string;
  label: string;
  level: FlagLevel;
  /** The measured value, formatted for display. */
  display: string;
  /** The rule that produced this level, in plain language. */
  rule: string;
  /** Glossary key for the hover explainer. */
  glossaryKey?: string;
  /** Whether this signal applies to the company's business (see Applicability). */
  applicability: Applicability;
}

export interface DerivedMetrics {
  /** Full (non-stub) periods only. */
  fullPeriods: FinancialPeriod[];
  latestFull: FinancialPeriod | null;
  stubPeriod: FinancialPeriod | null;

  revenueCagr: number | null;
  patCagr: number | null;
  revenueGrowthLatest: number | null;
  patGrowthLatest: number | null;

  /** 'improving' | 'compressing' | 'volatile' | 'stable' */
  marginTrend: string | null;
  gpMarginChange: number | null;

  /** Order book ÷ latest annual revenue, in years. */
  orderBookCoverage: number | null;

  /** IPO price ÷ pro forma NA per share. */
  priceToBook: number | null;

  /** Growth capex ÷ gross proceeds. */
  proceedsToGrowthPct: number | null;
  proceedsToDebtPct: number | null;

  /** Offer for sale ÷ total IPO value. */
  vendorCashOutPct: number | null;
  /** New money to company ÷ total IPO value. */
  newMoneyPct: number | null;
  totalIpoValueRM: number | null;

  /** Retail ballot shares as % of enlarged capital. */
  retailBallotPct: number | null;
  retailBallotShares: number | null;

  gearingBefore: number | null;
  gearingAfter: number | null;

  latestCurrentRatio: number | null;
  latestReceivablesDays: number | null;

  topCustomerConcentration: number | null;

  founderRetainedPct: number | null;
  largestShareholder: Shareholder | null;

  independentDirectorRatio: number | null;

  daysUntilClose: number | null;

  flags: Flag[];

  /** Which optional metrics apply to this company's business (see analyzer). */
  relevance: RelevanceProfile;
}

/**
 * Records, per optional metric, whether it is relevant to this company's
 * business. Metrics that are common to all IPOs (price, profit, gearing, …)
 * are not listed here — only the ones that are sector-specific and therefore
 * candidates for hiding when not applicable.
 */
export interface RelevanceProfile {
  /** Order book / revenue visibility — only project/contract businesses. */
  orderBook: Applicability;
  /** Customer concentration — only where the prospectus discloses it. */
  customerConcentration: Applicability;
}

export interface Analysis {
  parsed: ParsedProspectus;
  metrics: DerivedMetrics;
}

/** A saved analysis for the comparison view. */
export interface SavedAnalysis {
  id: string;
  companyName: string;
  savedAt: string;
  parsed: ParsedProspectus;
}

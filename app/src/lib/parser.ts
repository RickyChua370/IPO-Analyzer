/**
 * Deterministic parser for Bursa Malaysia IPO prospectuses.
 *
 * This is intentionally rule-based rather than AI-driven: Bursa mandates a
 * standard section structure and table vocabulary, so regex extraction is both
 * free and — critically — incapable of inventing a number that is not in the
 * document. Every extractor records the page it matched so the UI can show an
 * audit trail, and anything it cannot find is reported as missing rather than
 * silently defaulted.
 *
 * Pure module: no DOM, no network. Runs in the browser and under Node tests.
 */

import {
  type Allocation,
  type Field,
  type FinancialPeriod,
  type ParsedProspectus,
  type Person,
  type ProFormaSnapshot,
  type ProceedsUse,
  type Shareholder,
  type TimetableEntry,
  emptyPeriod,
  field,
  missing,
} from './types.ts';
import { type StitchedDocument, pageForOffset, stitch } from './textLayout.ts';

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

/** Parses a prospectus number: "220,735" -> 220735, "(1,234)" -> -1234, "-" -> null. */
export function toNumber(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  let s = raw.trim();
  if (s === '' || s === '-' || s === '–' || s === 'N/A' || s === 'n/a') return null;
  const negative = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, '').replace(/RM/gi, '').replace(/,/g, '').replace(/%/g, '').trim();
  if (s === '' || s === '-') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Extracts every number token from a table row, in order. */
function rowNumbers(line: string): (number | null)[] {
  // Matches 1,234.56 | (1,234) | 1234 | - | 0.28
  const tokens = line.match(/\(?-?\d[\d,]*(?:\.\d+)?\)?|(?<=\s)-(?=\s|$)/g);
  if (!tokens) return [];
  return tokens.map((t) => toNumber(t));
}

interface LineHit {
  line: string;
  /** Index into doc.lines */
  index: number;
  page: number;
  match: RegExpMatchArray;
}

/** Indexed line view over the stitched document. */
interface DocIndex {
  doc: StitchedDocument;
  lines: string[];
  /** Page number for each line. */
  linePages: number[];
  /** Whole document with newlines flattened to spaces, for prose matching. */
  flat: string;
}

function buildIndex(pages: string[]): DocIndex {
  const doc = stitch(pages);
  const lines: string[] = [];
  const linePages: number[] = [];
  doc.pages.forEach((page, i) => {
    for (const line of page.split('\n')) {
      if (line.trim() === '') continue;
      lines.push(line);
      linePages.push(i + 1);
    }
  });
  return { doc, lines, linePages, flat: doc.text.replace(/\n/g, ' ') };
}

function findLine(idx: DocIndex, re: RegExp, from = 0): LineHit | null {
  for (let i = from; i < idx.lines.length; i++) {
    const m = idx.lines[i].match(re);
    if (m) return { line: idx.lines[i], index: i, page: idx.linePages[i], match: m };
  }
  return null;
}

function findAllLines(idx: DocIndex, re: RegExp): LineHit[] {
  const hits: LineHit[] = [];
  for (let i = 0; i < idx.lines.length; i++) {
    const m = idx.lines[i].match(re);
    if (m) hits.push({ line: idx.lines[i], index: i, page: idx.linePages[i], match: m });
  }
  return hits;
}

/** Matches prose that may wrap across lines. */
function findProse(idx: DocIndex, re: RegExp): { match: RegExpMatchArray; page: number } | null {
  const m = idx.flat.match(re);
  if (!m || m.index === undefined) return null;
  // Map the flat offset back to a page (offsets align because we only swapped
  // newlines for spaces, preserving length).
  return { match: m, page: pageForOffset(idx.doc, m.index) };
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

function parseCompanyName(idx: DocIndex): Field<string> {
  // The cover/notice page names the company followed by BERHAD, often with an
  // abbreviation in quotes: 'SLGC BERHAD ("SLGC" OR THE "COMPANY")'
  const hit = findProse(
    idx,
    /(?:ELECTRONIC\s+)?PROSPECTUS\s+OF\s+([A-Z][A-Z0-9\s&.'-]{2,60}?\s+BERHAD)\b/i,
  );
  if (hit) {
    return field(tidyName(hit.match[1]), { page: hit.page, raw: hit.match[0] });
  }

  // Fallback: first standalone all-caps line ending in BERHAD.
  const line = findLine(idx, /^([A-Z][A-Z0-9\s&.'-]{2,60}\s+BERHAD)\b/);
  if (line) return field(tidyName(line.match[1]), { page: line.page, confidence: 'medium' });

  const anyBhd = findProse(idx, /\b([A-Z][A-Za-z0-9\s&.'-]{2,50}\s+Berhad)\b/);
  if (anyBhd) return field(tidyName(anyBhd.match[1]), { page: anyBhd.page, confidence: 'low' });

  return missing<string>();
}

/**
 * Title-cases a company name while preserving acronyms.
 *
 * Prospectus covers are set in full caps ("SLGC BERHAD"), so naive title
 * casing would produce "Slgc Berhad". Short all-caps tokens are treated as
 * acronyms and left alone.
 */
function tidyName(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => {
      if (/^[A-Z0-9&.-]{2,5}$/.test(word)) return word; // acronym, e.g. SLGC, YTL, MBSB
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

function parseRegistrationNo(idx: DocIndex): Field<string> {
  const hit = findProse(idx, /Registration\s+No\.?:?\s*(\d{12}\s*\([\dA-Z-]+\))/i);
  if (hit) return field(hit.match[1].replace(/\s+/g, ' ').trim(), { page: hit.page });
  return missing<string>();
}

function parseListingBoard(idx: DocIndex): Field<string> {
  if (/\bACE\s+Market\b/i.test(idx.flat)) {
    const hit = findProse(idx, /\bACE\s+Market\b/i);
    return field('ACE Market', { page: hit?.page });
  }
  if (/\bLEAP\s+Market\b/i.test(idx.flat)) return field('LEAP Market');
  if (/\bMain\s+Market\b/i.test(idx.flat)) {
    const hit = findProse(idx, /\bMain\s+Market\b/i);
    return field('Main Market', { page: hit?.page });
  }
  return missing<string>();
}

function parseProspectusDate(idx: DocIndex): Field<string> {
  const hit = findProse(idx, /PROSPECTUS\s+(?:OF\s+[^)]{0,80}\s+)?DATED\s+(\d{1,2}\s+\w+\s+\d{4})/i);
  if (hit) return field(hit.match[1], { page: hit.page });
  const alt = findProse(idx, /\bdated\s+(\d{1,2}\s+\w+\s+\d{4})\b/i);
  if (alt) return field(alt.match[1], { page: alt.page, confidence: 'low' });
  return missing<string>();
}

function parseBusinessDescription(idx: DocIndex): Field<string> {
  // Section 3.2 states the principal activity in a consistent form.
  const hit = findProse(
    idx,
    /Through our subsidiar(?:y|ies),?\s+we are\s+principally involved in\s+(?:the\s+)?([^.]{10,300}?)\./i,
  );
  if (hit) return field(cleanProse(hit.match[1]), { page: hit.page });

  const alt = findProse(
    idx,
    /we are\s+principally involved in\s+(?:the\s+)?([^.]{10,300}?)\./i,
  );
  if (alt) return field(cleanProse(alt.match[1]), { page: alt.page, confidence: 'medium' });
  return missing<string>();
}

function cleanProse(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').trim();
}

/**
 * Infers a broad sector label from the stated principal activities.
 *
 * Prospectuses do not print a standard sector code, so this is a keyword
 * heuristic and is reported with medium confidence. It is used only for the
 * comparison view's grouping, never for any threshold or flag.
 */
function parseIndustry(idx: DocIndex, description: string | null): Field<string> {
  const haystack = `${description ?? ''} ${idx.flat.slice(0, 40_000)}`.toLowerCase();
  const sectors: [string, RegExp][] = [
    ['Construction & Engineering', /building construction|civil engineering|contractor|earthworks|infrastructure works/],
    ['Property Development', /property develop|real estate develop|township develop/],
    ['Manufacturing', /manufactur|fabricat|assembly plant|production facilit/],
    ['Technology', /software|information technology|\bsaas\b|semiconductor|data cent/],
    ['Healthcare', /healthcare|hospital|clinic|pharmaceutic|medical device/],
    ['Oil & Gas', /oil and gas|petroleum|upstream|downstream|offshore support/],
    ['Logistics & Transport', /logistics|freight|haulage|warehousing services|shipping/],
    ['Food & Beverage', /food and beverage|\bf&b\b|restaurant|catering|confectioner/],
    ['Retail & Consumer', /retail outlet|consumer products|e-commerce|trading of consumer/],
    ['Agriculture', /plantation|palm oil|agricultur|aquacultur|poultry/],
    ['Education', /education|tuition|training centre|private college/],
    ['Financial Services', /money lending|insurance broking|fund management|payment services/],
    ['Renewable Energy', /solar|renewable energy|photovoltaic|\bepcc\b/],
  ];
  for (const [label, re] of sectors) {
    if (re.test(haystack)) return field(label, { confidence: 'medium' });
  }
  return missing<string>();
}

// ---------------------------------------------------------------------------
// Deal terms
// ---------------------------------------------------------------------------

function parseIpoPrice(idx: DocIndex): Field<number> {
  const patterns: RegExp[] = [
    /IPO\s+Price\s+per\s+Share\s+RM\s?([\d.]+)/i,
    /IPO\s+Price\s+of\s+RM\s?([\d.]+)/i,
    /at\s+our\s+IPO\s+Price\s+of\s+RM\s?([\d.]+)/i,
    /issue\s+price\s+of\s+RM\s?([\d.]+)\s+per\s+(?:share|unit)/i,
  ];
  for (const re of patterns) {
    const hit = findProse(idx, re);
    const v = toNumber(hit?.match[1]);
    if (hit && v !== null && v > 0 && v < 100) {
      return field(v, { page: hit.page, raw: hit.match[0] });
    }
  }
  return missing<number>();
}

function parseMarketCap(idx: DocIndex): Field<number> {
  const patterns: RegExp[] = [
    /Market\s+capitalisation\s*(?:\(\d\))?\s*RM\s?([\d,]+)/i,
    /total\s+market\s+capitalisation\s+will\s+be\s+RM\s?([\d,]+)/i,
    /market\s+capitalisation\s+(?:upon\s+Listing\s+)?of\s+RM\s?([\d,]+)/i,
  ];
  for (const re of patterns) {
    const hit = findProse(idx, re);
    const v = toNumber(hit?.match[1]);
    if (hit && v !== null && v > 1000) return field(v, { page: hit.page, raw: hit.match[0] });
  }
  return missing<number>();
}

function parseEnlargedShares(idx: DocIndex): Field<number> {
  const patterns: RegExp[] = [
    /Enlarged\s+(?:number\s+of\s+Shares|share\s+capital)\s+upon\s+Listing\s+([\d,]{7,})/i,
    /enlarged\s+(?:number\s+of\s+)?share\s+capital\s+of\s+([\d,]{7,})\s+Shares/i,
    /enlarged\s+issued\s+share\s+capital\s+of\s+([\d,]{7,})/i,
  ];
  for (const re of patterns) {
    const hit = findProse(idx, re);
    const v = toNumber(hit?.match[1]);
    if (hit && v !== null && v > 1000) return field(v, { page: hit.page, raw: hit.match[0] });
  }
  return missing<number>();
}

function parsePeMultiple(idx: DocIndex): Field<number> {
  const patterns: RegExp[] = [
    /PE\s+Multiple\s+of\s+our\s+IPO\s+Price\s+of\s+approximately\s+([\d.]+)\s+times/i,
    /PE\s+Multiple\s+of\s+(?:approximately\s+)?([\d.]+)\s+times/i,
    /price[-\s]to[-\s]earnings\s+multiple\s+of\s+(?:approximately\s+)?([\d.]+)\s+times/i,
  ];
  for (const re of patterns) {
    const hit = findProse(idx, re);
    const v = toNumber(hit?.match[1]);
    if (hit && v !== null && v > 0 && v < 500) {
      return field(v, { page: hit.page, raw: hit.match[0] });
    }
  }
  return missing<number>();
}

function parseDilution(idx: DocIndex): Field<number> {
  const hit = findProse(
    idx,
    /Dilution\s+in\s+pro\s+forma\s+NA\s+per\s+Share\s+as\s+a\s+percentage\s+of\s+our\s+IPO\s+Price\s+([\d.]+)%/i,
  );
  const v = toNumber(hit?.match[1]);
  if (hit && v !== null) return field(v, { page: hit.page, raw: hit.match[0] });
  return missing<number>();
}

// ---------------------------------------------------------------------------
// Allocation table (Section 3.1)
// ---------------------------------------------------------------------------

function parseAllocations(idx: DocIndex): {
  allocations: Allocation[];
  publicIssueShares: Field<number>;
  publicIssueGrossRM: Field<number>;
  offerForSaleShares: Field<number>;
  offerForSaleGrossRM: Field<number>;
} {
  const allocations: Allocation[] = [];

  // Anchor on the "Public Issue" heading inside the summary allocation table.
  const anchor = findLine(idx, /^Public\s+Issue\s*$/i);
  let tranche: Allocation['tranche'] = 'public_issue';

  if (anchor) {
    for (let i = anchor.index + 1; i < Math.min(anchor.index + 30, idx.lines.length); i++) {
      const line = idx.lines[i];
      if (/^Offer\s+for\s+Sale\s*$/i.test(line)) {
        tranche = 'offer_for_sale';
        continue;
      }
      if (/^(Enlarged|IPO\s+Price|Market\s+capitalisation|Notes?:)/i.test(line)) break;

      // A data row: label followed by shares, amount, percentage.
      const m = line.match(/^(.+?)\s+([\d,]{5,})\s+([\d,]{4,})\s+([\d.]+)\s*$/);
      if (!m) continue;
      const label = m[1].replace(/^[-–•]\s*/, '').replace(/\s+/g, ' ').trim();
      if (/^Total/i.test(label)) continue;

      allocations.push({
        label,
        tranche,
        shares: toNumber(m[2]),
        amountRM: toNumber(m[3]),
        pctOfCapital: toNumber(m[4]),
        isRetailBallot:
          tranche === 'public_issue' &&
          /public\s+investor|Malaysian\s+Public/i.test(label) &&
          !/placement/i.test(label),
      });
    }
  }

  const sum = (t: Allocation['tranche'], key: 'shares' | 'amountRM') =>
    allocations
      .filter((a) => a.tranche === t)
      .reduce<number | null>((acc, a) => {
        const v = a[key];
        if (v === null) return acc;
        return (acc ?? 0) + v;
      }, null);

  const piShares = sum('public_issue', 'shares');
  const piRM = sum('public_issue', 'amountRM');
  const ofsShares = sum('offer_for_sale', 'shares');
  const ofsRM = sum('offer_for_sale', 'amountRM');

  // Cross-check against the prose statements, which are often clearer.
  const piProse = findProse(
    idx,
    /gross\s+proceeds\s+(?:to\s+be\s+raised\s+)?(?:by\s+our\s+Company\s+)?from\s+the\s+Public\s+Issue\s+of\s+RM\s?([\d.]+)\s*(million|billion)?/i,
  );
  const ofsProse = findProse(
    idx,
    /gross\s+proceeds\s+from\s+the\s+Offer\s+for\s+Sale\s+of\s+approximately\s+RM\s?([\d.]+)\s*(million|billion)?/i,
  );

  const scale = (n: number | null, unit: string | undefined) => {
    if (n === null) return null;
    if (/billion/i.test(unit ?? '')) return n * 1_000_000_000;
    if (/million/i.test(unit ?? '')) return n * 1_000_000;
    return n;
  };

  const piProseRM = scale(toNumber(piProse?.match[1]), piProse?.match[2]);
  const ofsProseRM = scale(toNumber(ofsProse?.match[1]), ofsProse?.match[2]);

  const issueSharesProse = findProse(
    idx,
    /A\s+total\s+of\s+([\d,]{7,})\s+Issue\s+Shares,\s+representing/i,
  );
  const ofsSharesProse = findProse(
    idx,
    /([\d,]{7,})\s+Offer\s+Shares,\s+representing/i,
  );

  return {
    allocations,
    publicIssueShares: field(toNumber(issueSharesProse?.match[1]) ?? piShares, {
      page: issueSharesProse?.page,
      confidence: piShares !== null ? 'high' : 'medium',
    }),
    publicIssueGrossRM: field(piProseRM ?? piRM, {
      page: piProse?.page,
      confidence: piProseRM !== null ? 'high' : 'medium',
    }),
    offerForSaleShares: field(toNumber(ofsSharesProse?.match[1]) ?? ofsShares, {
      page: ofsSharesProse?.page,
      confidence: ofsShares !== null ? 'high' : 'medium',
    }),
    offerForSaleGrossRM: field(ofsProseRM ?? ofsRM, {
      page: ofsProse?.page,
      confidence: ofsProseRM !== null ? 'high' : 'medium',
    }),
  };
}

// ---------------------------------------------------------------------------
// Utilisation of proceeds (Section 3.7 / 4.9)
// ---------------------------------------------------------------------------

function classifyProceeds(label: string): ProceedsUse['category'] {
  const l = label.toLowerCase();
  if (/listing\s+expense|issue\s+expense|estimated\s+expenses/.test(l)) return 'expenses';
  if (/repay|reduction\s+of\s+(?:bank\s+)?borrowing|settle.*borrowing/.test(l)) return 'debt';
  if (/working\s+capital/.test(l)) return 'working_capital';
  if (
    /machinery|equipment|capital\s+expenditure|capex|expansion|new\s+(?:factory|plant|outlet|branch)|software|automation|renovation|construction\s+of|acquisition|research|development|fleet|vehicle|upgrade/.test(
      l,
    )
  ) {
    return 'growth';
  }
  return 'other';
}

function parseProceeds(idx: DocIndex): { uses: ProceedsUse[]; total: Field<number> } {
  const header = findLine(idx, /Description\s+of\s+utilisation/i);
  if (!header) return { uses: [], total: missing<number>() };

  const uses: ProceedsUse[] = [];
  let total: Field<number> = missing<number>();

  for (let i = header.index + 1; i < Math.min(header.index + 40, idx.lines.length); i++) {
    const line = idx.lines[i];
    if (/^Notes?:/i.test(line)) break;

    // Total row.
    const tm = line.match(/^Total\s+([\d,]+)\s+([\d.]+)\s*$/i);
    if (tm) {
      total = field(toNumber(tm[1]), { page: idx.linePages[i], raw: line });
      break;
    }

    // Data row: label [optional note ref] amount pct timeframe
    const m = line.match(
      /^(.+?)\s+(?:\([a-z]\)\s+)?([\d,]+)\s+([\d.]+)\s+(Within[^\d]*\d+\s*\w+|Immediate\w*|Upon[^$]*)$/i,
    );
    if (!m) continue;

    let label = m[1].replace(/\s*\([a-z]\)\s*$/i, '').replace(/\s+/g, ' ').trim();
    // The label often wraps, leaving its tail on the following line
    // ("Purchase of construction machinery and" / "equipment"). Absorb a short
    // all-lowercase continuation line that is not itself a table row.
    const next = idx.lines[i + 1];
    if (
      next &&
      /^[a-z][a-z\s]{1,40}$/.test(next.trim()) &&
      !/^(total|notes?|within|there|description|immediate|upon)\b/i.test(next.trim())
    ) {
      label = `${label} ${next.trim()}`;
    }

    uses.push({
      label,
      amount: toNumber(m[2]),
      pct: toNumber(m[3]),
      timeframe: m[4].replace(/\s+/g, ' ').trim(),
      category: classifyProceeds(label),
    });
  }

  return { uses, total };
}

// ---------------------------------------------------------------------------
// Timetable
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function toIso(dateStr: string): string | null {
  const m = dateStr.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  const day = Number(m[1]);
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseTimetable(idx: DocIndex): {
  timetable: TimetableEntry[];
  open: Field<string>;
  close: Field<string>;
  listing: Field<string>;
} {
  const header = findLine(idx, /^Events\s+Indicative\s+date\s*$/i);
  const timetable: TimetableEntry[] = [];

  if (header) {
    for (let i = header.index + 1; i < Math.min(header.index + 15, idx.lines.length); i++) {
      const m = idx.lines[i].match(/^(.+?)\s+(\d{1,2}\s+\w+\s+\d{4})\s*$/);
      if (!m) {
        if (timetable.length > 0) break;
        continue;
      }
      timetable.push({
        event: m[1].replace(/\s+/g, ' ').trim(),
        date: m[2],
        iso: toIso(m[2]),
      });
    }
  }

  const pick = (re: RegExp): Field<string> => {
    const entry = timetable.find((t) => re.test(t.event));
    if (entry) return field(entry.date, { page: header?.page });
    return missing<string>();
  };

  return {
    timetable,
    open: pick(/opening\s+of\s+application/i),
    close: pick(/clos(?:ing|e)\s+(?:date|of\s+application)/i),
    listing: pick(/date\s+of\s+listing|listing\s+on\s+the/i),
  };
}

// ---------------------------------------------------------------------------
// Financial highlights
// ---------------------------------------------------------------------------

/** Recognises a period-header row such as "FYE 2022 FYE 2023 ... FPE 2026". */
function parsePeriodHeader(line: string): string[] | null {
  const tokens = line.match(/\b(FYE|FPE|FYA)\s*(\d{4})\b/gi);
  if (!tokens || tokens.length < 2) return null;
  // Reject lines that also contain lots of other prose.
  const consumed = tokens.join(' ').length;
  if (consumed < line.replace(/\s+/g, ' ').length * 0.5) return null;
  return tokens.map((t) => t.replace(/\s+/g, ' ').toUpperCase().trim());
}

interface RowSpec {
  key: keyof FinancialPeriod;
  patterns: RegExp[];
}

/**
 * Row matchers for the financial highlights table.
 *
 * Order matters: the first matching spec wins for a given line, so the
 * negative lookaheads are essential — without them "GP margin (%) 9.20 ..."
 * would be captured as gross profit, silently overwriting the real figure.
 */
const FINANCIAL_ROWS: RowSpec[] = [
  { key: 'revenue', patterns: [/^Revenue\b/i, /^Turnover\b/i] },
  { key: 'gpMargin', patterns: [/^GP\s+margin\b/i, /^Gross\s+profit\s+margin\b/i] },
  { key: 'patMargin', patterns: [/^PAT\s+margin\b/i, /^Net\s+profit\s+margin\b/i] },
  { key: 'grossProfit', patterns: [/^GP(?!\s*margin)\b/i, /^Gross\s+profit(?!\s*margin)\b/i] },
  { key: 'otherIncome', patterns: [/^Other\s+operating\s+income\b/i, /^Other\s+operating\b/i, /^Other\s+income\b/i] },
  { key: 'pbt', patterns: [/^PBT(?!\s*margin)\b/i, /^Profit\s+before\s+tax(?:ation)?\b/i] },
  { key: 'pat', patterns: [/^PAT(?!\s*margin)\b/i, /^Profit\s+after\s+tax(?:ation)?\b/i, /^Net\s+profit(?!\s*margin)\b/i] },
  {
    key: 'eps',
    patterns: [
      /^Basic\s+and\s+diluted\s+EPS\b/i,
      // The label frequently wraps, leaving the data row as "Basic and diluted <numbers>".
      /^Basic\s+and\s+diluted\s+[\d(.]/i,
      /^EPS\s*(?:\(sen\))?\s+[\d(.]/i,
      /^Basic\s+EPS\b/i,
    ],
  },
];

const RATIO_ROWS: RowSpec[] = [
  { key: 'receivablesDays', patterns: [/^Trade\s+receivables\s+turnover\b/i] },
  { key: 'currentRatio', patterns: [/^Current\s+ratio\b/i] },
  { key: 'gearing', patterns: [/^Gearing\s+ratio\b/i] },
];

/**
 * Finds the best financial-highlights table.
 *
 * A prospectus repeats these figures in several sections (summary, IPO basis,
 * MD&A). We score each candidate by how many rows it yields and prefer the
 * most complete one, which keeps extraction robust if one section is formatted
 * unusually.
 */
function parseFinancialPeriods(idx: DocIndex): FinancialPeriod[] {
  const headers = findAllLines(idx, /\b(?:FYE|FPE)\s*\d{4}\b/i)
    .map((hit) => ({ hit, labels: parsePeriodHeader(hit.line) }))
    .filter((c): c is { hit: LineHit; labels: string[] } => c.labels !== null);

  let best: { periods: FinancialPeriod[]; score: number } | null = null;

  for (const { hit, labels } of headers) {
    const periods = labels.map((l) => emptyPeriod(l.replace(/\s+/g, ' ')));
    let score = 0;

    for (let i = hit.index + 1; i < Math.min(hit.index + 22, idx.lines.length); i++) {
      const line = idx.lines[i];
      if (parsePeriodHeader(line)) break; // next table started
      if (/^(Notes?:|Section|\d+\.\d)/i.test(line)) break;

      for (const spec of [...FINANCIAL_ROWS, ...RATIO_ROWS]) {
        if (!spec.patterns.some((p) => p.test(line))) continue;
        const nums = rowNumbers(stripLabelNoise(line));
        if (nums.length < labels.length) continue;
        // Values align to the right-most N columns (leading tokens may be note refs).
        const values = nums.slice(nums.length - labels.length);
        let filled = 0;
        values.forEach((v, c) => {
          if (v !== null) filled++;
          (periods[c] as unknown as Record<string, number | null>)[spec.key as string] = v;
        });
        if (filled > 0) score += 1;
        break;
      }
    }

    if (score > 0 && (best === null || score > best.score)) best = { periods, score };
  }

  if (!best) return [];

  // Merge in per-period ratios and dividends from their own tables, which use
  // the same period columns but live in different sections.
  mergeRatioTables(idx, best.periods);
  mergeDividends(idx, best.periods);

  return best.periods;
}

/** Removes footnote markers and units that would be mistaken for data. */
function stripLabelNoise(line: string): string {
  return line
    .replace(/\((\d)\)/g, ' ')           // footnote refs (1) (2)
    .replace(/\(sen\)|\(days\)|\(times\)|\(%\)|\(RM'000\)|\(RM\)/gi, ' ')
    .replace(/\s+/g, ' ');
}

function mergeRatioTables(idx: DocIndex, periods: FinancialPeriod[]) {
  for (const spec of RATIO_ROWS) {
    // Already populated by the main table?
    if (periods.some((p) => p[spec.key] !== null)) continue;

    for (const pattern of spec.patterns) {
      const hits = findAllLines(idx, pattern);
      let applied = false;
      for (const hit of hits) {
        const nums = rowNumbers(stripLabelNoise(hit.line));
        if (nums.length !== periods.length) continue;
        nums.forEach((v, c) => {
          (periods[c] as unknown as Record<string, number | null>)[spec.key as string] = v;
        });
        applied = true;
        break;
      }
      if (applied) break;
    }
  }
}

function mergeDividends(idx: DocIndex, periods: FinancialPeriod[]) {
  const hits = findAllLines(idx, /^Dividends?\s+declared/i);
  for (const hit of hits) {
    // The dividend table may add an extra "up to LPD" column; take the first N.
    const nums = rowNumbers(stripLabelNoise(hit.line));
    if (nums.length < periods.length) continue;
    const values = nums.slice(0, periods.length);
    values.forEach((v, c) => {
      periods[c].dividends = v;
    });
    return;
  }
}

// ---------------------------------------------------------------------------
// Pro forma balance sheet (Section 3.8.2)
// ---------------------------------------------------------------------------

function parseProForma(idx: DocIndex): ProFormaSnapshot[] {
  const naHit = findLine(idx, /^NA\s+per\s+Share\s*\(RM\)\s+[\d.]/i);
  if (!naHit) return [];

  const naValues = rowNumbers(stripLabelNoise(naHit.line));
  const columns = naValues.length;
  if (columns < 2) return [];

  const labels = ['Audited', 'After Acquisition', 'After IPO', 'After utilisation of proceeds'].slice(
    0,
    columns,
  );
  const snapshots: ProFormaSnapshot[] = labels.map((label) => ({
    label,
    totalAssets: null,
    totalEquity: null,
    totalLiabilities: null,
    borrowings: null,
    naPerShare: null,
    gearing: null,
    shares: null,
  }));

  naValues.forEach((v, i) => {
    if (snapshots[i]) snapshots[i].naPerShare = v;
  });

  const rows: { key: keyof ProFormaSnapshot; re: RegExp }[] = [
    { key: 'totalAssets', re: /^TOTAL\s+ASSETS\b/i },
    { key: 'totalEquity', re: /^TOTAL\s+EQUITY\s+[\d(]/i },
    { key: 'totalLiabilities', re: /^TOTAL\s+LIABILITIES\b/i },
    { key: 'borrowings', re: /^Borrowings\s*\(RM/i },
    { key: 'gearing', re: /^Gearing\s*\(times\)/i },
    { key: 'shares', re: /^No\.\s+of\s+Shares\s+in\s+issue\b/i },
  ];

  // Search a window around the NA row so we stay inside this one table.
  const from = Math.max(0, naHit.index - 25);
  const to = Math.min(idx.lines.length, naHit.index + 10);

  for (const { key, re } of rows) {
    for (let i = from; i < to; i++) {
      if (!re.test(idx.lines[i])) continue;
      const nums = rowNumbers(stripLabelNoise(idx.lines[i]));
      if (nums.length < columns) continue;
      const values = nums.slice(nums.length - columns);
      values.forEach((v, c) => {
        if (snapshots[c]) {
          (snapshots[c] as unknown as Record<string, number | null>)[key as string] = v;
        }
      });
      break;
    }
  }

  return snapshots;
}

// ---------------------------------------------------------------------------
// Operational metrics
// ---------------------------------------------------------------------------

function parseOrderBook(idx: DocIndex): { value: Field<number>; raw: Field<string> } {
  const patterns: RegExp[] = [
    /(?:total\s+)?unbilled\s+contract\s+value[^.]{0,80}?stood\s+at\s+(?:approximately\s+)?RM\s?([\d.,]+)\s*(billion|million)?/i,
    /order\s+book[^.]{0,120}?stood\s+at\s+(?:approximately\s+)?RM\s?([\d.,]+)\s*(billion|million)?/i,
    /unbilled\s+contract\s+value\s+of[^.]{0,80}?RM\s?([\d.,]+)\s*(billion|million)?/i,
  ];

  for (const re of patterns) {
    const hit = findProse(idx, re);
    if (!hit) continue;
    const n = toNumber(hit.match[1]);
    if (n === null) continue;
    const unit = hit.match[2] ?? '';
    let rm = n;
    if (/billion/i.test(unit)) rm = n * 1_000_000_000;
    else if (/million/i.test(unit)) rm = n * 1_000_000;
    return {
      value: field(rm, { page: hit.page, raw: hit.match[0] }),
      raw: field(`RM${hit.match[1]}${unit ? ` ${unit}` : ''}`, { page: hit.page }),
    };
  }
  return { value: missing<number>(), raw: missing<string>() };
}

function parseCustomerConcentration(idx: DocIndex): Field<number[]> {
  const hit = findProse(
    idx,
    /(?:top\s+5\s+)?major\s+customers\s+contributed\s+((?:[\d.]+%[,\s]*(?:and\s+)?){2,8})of\s+our\s+total\s+revenue/i,
  );
  if (hit) {
    const pcts = hit.match[1].match(/[\d.]+(?=%)/g)?.map(Number) ?? [];
    if (pcts.length > 0) return field(pcts, { page: hit.page, raw: hit.match[0] });
  }
  return missing<number[]>();
}

function parseEmployees(idx: DocIndex): Field<number> {
  const patterns: RegExp[] = [
    /total\s+workforce\s+of\s+([\d,]{2,7})\s+(?:permanent\s+|full[-\s]time\s+)?employees/i,
    /(?:we|our\s+Group)\s+ha(?:d|s|ve)\s+(?:a\s+total\s+(?:of|workforce\s+of)\s+)?([\d,]{2,7})\s+(?:permanent\s+)?employees/i,
    /total\s+(?:of\s+)?([\d,]{2,7})\s+employees\s+as\s+at/i,
    /workforce\s+(?:of|comprised\s+of)\s+([\d,]{2,7})\s+(?:permanent\s+)?employees/i,
  ];
  for (const re of patterns) {
    const hit = findProse(idx, re);
    const v = toNumber(hit?.match[1]);
    if (hit && v !== null && v > 0) return field(v, { page: hit.page, raw: hit.match[0] });
  }
  return missing<number>();
}

// ---------------------------------------------------------------------------
// People & ownership
// ---------------------------------------------------------------------------

function parseShareholders(idx: DocIndex): Shareholder[] {
  // Preferred path: a normally-oriented table where each holder is one row.
  // "Yong Zhen Lin Malaysian 373,750,000 82.15 16,250,000 3.57 333,750,000 59.60 ..."
  const anchor = findLine(idx, /Nationality/i);
  const out: Shareholder[] = [];

  if (anchor) {
    for (let i = anchor.index + 1; i < Math.min(anchor.index + 25, idx.lines.length); i++) {
      const line = idx.lines[i];
      if (/^Notes?:/i.test(line)) break;
      const m = line.match(
        /^([A-Z][A-Za-z@\s.'-]{2,50}?)\s+(?:Malaysian|Singaporean|Chinese|Foreigner|[A-Z][a-z]+ian)\s+(.+)$/,
      );
      if (!m) continue;
      const nums = rowNumbers(m[2]);
      const pcts = nums.filter((n): n is number => n !== null && n <= 100 && n > 0);
      if (pcts.length < 2) continue;
      out.push({
        name: m[1].replace(/\s+/g, ' ').trim(),
        beforePct: pcts[0] ?? null,
        afterPct: pcts.length >= 3 ? pcts[2] : (pcts[1] ?? null),
      });
    }
  }

  if (out.length > 0) return out;
  return parseShareholdersFromRotatedTable(idx);
}

/**
 * Recovers shareholdings from a rotated (landscape) table.
 *
 * Bursa prospectuses often typeset the promoter/shareholder table sideways.
 * pdf.js then emits the cells in visual rather than logical order, and glues
 * adjacent cells together ("24,000,00024,000,00010,250,000"), so row-based
 * parsing is impossible.
 *
 * Rather than guessing at the layout, this validates arithmetically: a share
 * count is only accepted as a holding when dividing it by the enlarged share
 * capital reproduces a percentage that actually appears on the same page. That
 * makes a wrong number essentially impossible to emit — the cross-check has to
 * pass first — at the cost of not recovering which name maps to which stake.
 */
function parseShareholdersFromRotatedTable(idx: DocIndex): Shareholder[] {
  const enlarged = parseEnlargedShares(idx).value;
  if (!enlarged) return [];

  // Find the page holding the post-IPO shareholding table.
  const pageNo = idx.doc.pages.findIndex(
    (page) =>
      /After\s+our\s+IPO/i.test(page) &&
      /\bDirect\b/i.test(page) &&
      /No\.\s+of\s+Shares/i.test(page) &&
      /Nationality/i.test(page),
  );
  if (pageNo < 0) return [];
  const page = idx.doc.pages[pageNo];

  // Comma-grouped counts split naturally even when glued together, because a
  // group must be followed by ",ddd" to continue.
  const counts = (page.match(/\d{1,3}(?:,\d{3})+/g) ?? [])
    .map((s) => toNumber(s))
    .filter((n): n is number => n !== null && n > 0 && n <= enlarged);

  const percents = (page.match(/\d{1,3}\.\d{2}/g) ?? [])
    .map(Number)
    .filter((n) => n > 0 && n <= 100);

  if (counts.length === 0 || percents.length === 0) return [];

  // Accept a count only if its implied percentage is reported on the page.
  // Tolerance absorbs the issuer's own rounding.
  const TOLERANCE = 0.06;
  const validated: { shares: number; pct: number }[] = [];
  for (const shares of new Set(counts)) {
    const implied = (shares / enlarged) * 100;
    const match = percents.find((p) => Math.abs(p - implied) <= TOLERANCE);
    if (match !== undefined) validated.push({ shares, pct: match });
  }
  if (validated.length === 0) return [];

  // Largest first; this is also the order Bursa tables conventionally use.
  validated.sort((a, b) => b.pct - a.pct);

  // Names are glued together too ("Yong Zhen LinLiong Yan Herng"); split on
  // the lower-to-upper case boundary.
  const nameBlock = page.match(/Name\s+([A-Z][A-Za-z\s@.'-]{5,200}?)Notes?:/);
  let names: string[] = [];
  if (nameBlock) {
    names = nameBlock[1]
      .split(/(?<=[a-z])(?=[A-Z])/)
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter((s) => s.length >= 3 && /^[A-Z]/.test(s));
  }

  return validated.map((v, i) => ({
    // Name association cannot be verified from a scrambled table, so it is
    // offered only for the single largest holder, which tables list first.
    name: i === 0 && names.length > 0 ? names[0] : `Holder ${i + 1}`,
    beforePct: null,
    afterPct: v.pct,
  }));
}

function parsePeople(idx: DocIndex): { directors: Person[]; management: Person[] } {
  const directors: Person[] = [];
  const management: Person[] = [];

  const dirAnchor = findLine(idx, /^Directors\s*$/);
  const mgmtAnchor = findLine(idx, /^Key\s+senior\s+management\s*$/i);

  const ROLE =
    /^(.+?)\s+((?:Independent\s+)?(?:Non-Executive\s+)?(?:Executive\s+)?(?:Managing\s+Director|Chairman|Director|Chief\s+\w+\s+Officer|General\s+Manager|Project\s+Director|Contract\s+Director|Chief\s+Financial\s+Officer))\s*$/i;

  const collect = (start: number, stopAt: number, into: Person[]) => {
    for (let i = start; i < stopAt && i < idx.lines.length; i++) {
      const m = idx.lines[i].match(ROLE);
      if (!m) continue;
      const name = m[1].replace(/\s+/g, ' ').trim();
      if (name.length < 3 || /^(Name|Designation)$/i.test(name)) continue;
      const role = m[2].replace(/\s+/g, ' ').trim();
      into.push({
        name,
        role,
        isIndependent: /independent/i.test(role),
        isExecutive: /managing|executive/i.test(role) && !/non-executive/i.test(role),
      });
    }
  };

  if (dirAnchor) {
    collect(dirAnchor.index + 1, mgmtAnchor ? mgmtAnchor.index : dirAnchor.index + 12, directors);
  }
  if (mgmtAnchor) {
    collect(mgmtAnchor.index + 1, mgmtAnchor.index + 12, management);
  }

  return { directors, management };
}

function parseMoratorium(idx: DocIndex): Field<string> {
  const hit = findProse(
    idx,
    /entire\s+shareholdings\s+after\s+our\s+IPO\s+will\s+be\s+held\s+under\s+moratorium\s+for\s+(\d+\s+months?)[^.]*\./i,
  );
  if (hit) {
    const second = findProse(idx, /will\s+remain\s+under\s+moratorium\s+for\s+another\s+(\d+\s+months?)/i);
    const pctHit = findProse(idx, /amounting\s+to\s+([\d.]+)%\s+of\s+our\s+share\s+capital/i);
    let s = `${hit.match[1]} full lock-up`;
    if (pctHit && second) s += `, then ${pctHit.match[1]}% locked for another ${second.match[1]}`;
    return field(s, { page: hit.page, raw: hit.match[0] });
  }
  return missing<string>();
}

// ---------------------------------------------------------------------------
// Dividend policy
// ---------------------------------------------------------------------------

function parseDividendPolicy(idx: DocIndex): {
  text: Field<string>;
  formal: Field<boolean>;
} {
  const none = findProse(
    idx,
    /(?:presently\s+)?do(?:es)?\s+not\s+have\s+any\s+(?:formal|fixed)\s+dividend\s+policy/i,
  );
  if (none) {
    return {
      text: field('No formal dividend policy', { page: none.page, raw: none.match[0] }),
      formal: field(false, { page: none.page }),
    };
  }

  const target = findProse(
    idx,
    /dividend\s+policy[^.]{0,120}?(?:of\s+|to\s+distribute\s+)(?:at\s+least\s+)?([\d.]+)%\s+of\s+our[^.]{0,40}?profit/i,
  );
  if (target) {
    return {
      text: field(`Target payout: ${target.match[1]}% of profit`, {
        page: target.page,
        raw: target.match[0],
      }),
      formal: field(true, { page: target.page }),
    };
  }
  return { text: missing<string>(), formal: missing<boolean>() };
}

// ---------------------------------------------------------------------------
// Risk factors
// ---------------------------------------------------------------------------

function parseRiskFactors(idx: DocIndex): string[] {
  const risks: string[] = [];
  const seen = new Set<string>();

  // Scope to the risk-factor sections. Without this, similarly-formatted
  // lettered paragraphs elsewhere (adviser disclaimers, application
  // instructions) get mistaken for risks.
  const start = findLine(idx, /^(?:3\.4\s+)?RISK\s+FACTORS\s*$/i);
  const end = start
    ? findLine(idx, /^(?:3\.5\s+)?(?:DIRECTORS\s+AND\s+KEY\s+SENIOR\s+MANAGEMENT|RELATED\s+PARTY)/i, start.index)
    : null;
  const from = start ? start.index : 0;
  const to = end ? end.index : start ? start.index + 400 : idx.lines.length;

  // Section 3.4 summarises the key risks as lettered paragraphs beginning
  // "(a) We are exposed to ...". These read well as one-line bullets.
  const hits = findAllLines(idx, /^\([a-j]\)\s+(We\s+.{15,200}|Our\s+.{15,200})$/).filter(
    (h) => h.index >= from && h.index <= to,
  );
  for (const hit of hits) {
    let text = hit.match[1].replace(/\s+/g, ' ').trim();
    // The heading may wrap onto the next line; append if it does not end cleanly.
    if (!/[.:]$/.test(text)) {
      const next = idx.lines[hit.index + 1];
      if (next && /^[a-z]/.test(next) && next.length < 120) {
        text = `${text} ${next.trim()}`;
      }
    }
    text = text.replace(/\s+/g, ' ').replace(/[.:]$/, '').trim();
    const key = text.toLowerCase().slice(0, 60);
    if (text.length > 20 && !seen.has(key)) {
      seen.add(key);
      risks.push(text);
    }
    if (risks.length >= 12) break;
  }

  return risks;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Runs an extractor, converting any failure into a missing field. */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    console.warn('[parser] extractor failed:', err);
    return fallback;
  }
}

export function parseProspectus(pages: string[], sourceFiles: string[] = []): ParsedProspectus {
  const idx = buildIndex(pages);

  const alloc = safe(() => parseAllocations(idx), {
    allocations: [],
    publicIssueShares: missing<number>(),
    publicIssueGrossRM: missing<number>(),
    offerForSaleShares: missing<number>(),
    offerForSaleGrossRM: missing<number>(),
  });
  const proceeds = safe(() => parseProceeds(idx), { uses: [], total: missing<number>() });
  const times = safe(() => parseTimetable(idx), {
    timetable: [],
    open: missing<string>(),
    close: missing<string>(),
    listing: missing<string>(),
  });
  const ob = safe(() => parseOrderBook(idx), { value: missing<number>(), raw: missing<string>() });
  const people = safe(() => parsePeople(idx), { directors: [], management: [] });
  const div = safe(() => parseDividendPolicy(idx), {
    text: missing<string>(),
    formal: missing<boolean>(),
  });
  const proForma = safe(() => parseProForma(idx), []);

  const naAfter = (() => {
    if (proForma.length === 0) return missing<number>();
    const last = proForma[proForma.length - 1];
    return last.naPerShare !== null ? field(last.naPerShare) : missing<number>();
  })();

  const businessDescription = safe(() => parseBusinessDescription(idx), missing<string>());

  return {
    companyName: safe(() => parseCompanyName(idx), missing<string>()),
    registrationNo: safe(() => parseRegistrationNo(idx), missing<string>()),
    listingBoard: safe(() => parseListingBoard(idx), missing<string>()),
    prospectusDate: safe(() => parseProspectusDate(idx), missing<string>()),
    industry: safe(() => parseIndustry(idx, businessDescription.value), missing<string>()),
    businessDescription,

    ipoPrice: safe(() => parseIpoPrice(idx), missing<number>()),
    marketCap: safe(() => parseMarketCap(idx), missing<number>()),
    enlargedShares: safe(() => parseEnlargedShares(idx), missing<number>()),
    peMultiple: safe(() => parsePeMultiple(idx), missing<number>()),
    naPerShareAfter: naAfter,
    dilutionPct: safe(() => parseDilution(idx), missing<number>()),

    allocations: alloc.allocations,
    publicIssueShares: alloc.publicIssueShares,
    publicIssueGrossRM: alloc.publicIssueGrossRM,
    offerForSaleShares: alloc.offerForSaleShares,
    offerForSaleGrossRM: alloc.offerForSaleGrossRM,

    proceedsUses: proceeds.uses,
    proceedsTotal: proceeds.total,

    timetable: times.timetable,
    openDate: times.open,
    closeDate: times.close,
    listingDate: times.listing,

    periods: safe(() => parseFinancialPeriods(idx), []),
    proForma,

    orderBook: ob.value,
    orderBookRaw: ob.raw,
    customerConcentration: safe(() => parseCustomerConcentration(idx), missing<number[]>()),
    employees: safe(() => parseEmployees(idx), missing<number>()),

    shareholders: safe(() => parseShareholders(idx), []),
    directors: people.directors,
    management: people.management,
    moratorium: safe(() => parseMoratorium(idx), missing<string>()),

    dividendPolicy: div.text,
    hasFormalDividendPolicy: div.formal,

    riskFactors: safe(() => parseRiskFactors(idx), []),

    pageCount: pages.length,
    sourceFiles,
    parsedAt: new Date().toISOString(),
  };
}

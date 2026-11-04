/**
 * REIT prospectus support.
 *
 * A Real Estate Investment Trust prospectus is laid out very differently from
 * the equity IPOs the main parser targets:
 *
 *  - the security is a "Unit", sold by a Sponsor — the trust issues no new
 *    units in the Offering and so receives no proceeds;
 *  - there is a Manager (with its own board), not a company board;
 *  - there is no "Public Issue / Offer for Sale" table; the Offering is split
 *    into a Retail Offering and an Institutional Offering;
 *  - earnings are judged on Net Property Income (NPI), distributable income
 *    and distribution yield, from pro forma statements and a profit
 *    projection, because the trust does not exist yet and has no audited
 *    history.
 *
 * Same principles as the main parser: deterministic regex only, every value is
 * traceable to a page, and anything not found stays missing rather than being
 * guessed. This module is self-contained (it does not import the main parser)
 * so the two can be tested and changed independently. `applyReit` overlays the
 * REIT-specific results on top of the generic parse, replacing only fields the
 * generic parser demonstrably gets wrong for a REIT.
 */

import {
  type Allocation,
  type BusinessPoint,
  type Field,
  type FinancialPeriod,
  type ParsedProspectus,
  type Person,
  type ProFormaSnapshot,
  type ReitInfo,
  type Shareholder,
  emptyPeriod,
  field,
  missing,
} from './types.ts';
import { type StitchedDocument, pageForOffset, stitch } from './textLayout.ts';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

interface Index {
  doc: StitchedDocument;
  lines: string[];
  linePages: number[];
  flat: string;
}

function buildIndex(pages: string[]): Index {
  const doc = stitch(pages);
  const lines: string[] = [];
  const linePages: number[] = [];
  doc.pages.forEach((page, i) => {
    for (const raw of page.split('\n')) {
      if (raw.trim() === '') continue;
      lines.push(raw);
      linePages.push(i + 1);
    }
  });
  return { doc, lines, linePages, flat: doc.text.replace(/\n/g, ' ') };
}

function num(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (s === '' || s === '-' || s === '–') return null;
  const neg = /^\(.*\)$/.test(s);
  const n = Number(s.replace(/[()]/g, '').replace(/,/g, '').replace(/%/g, ''));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** Number tokens in a table row: 1,234 | (1,234) | 12.5 | a lone "-" (nil). */
function rowNums(line: string): (number | null)[] {
  const tokens = line.match(/\(?\d[\d,]*(?:\.\d+)?\)?|(?<=\s)[-–](?=\s|$)/g);
  return tokens ? tokens.map((t) => num(t)) : [];
}

function findProse(idx: Index, re: RegExp): { match: RegExpMatchArray; page: number } | null {
  const m = idx.flat.match(re);
  if (!m || m.index === undefined) return null;
  return { match: m, page: pageForOffset(idx.doc, m.index) };
}

function findLine(idx: Index, re: RegExp, from = 0): { index: number; page: number; match: RegExpMatchArray } | null {
  for (let i = from; i < idx.lines.length; i++) {
    const m = idx.lines[i].match(re);
    if (m) return { index: i, page: idx.linePages[i], match: m };
  }
  return null;
}

/**
 * Like findLine, but skips table-of-contents entries (dotted leaders). The TOC
 * repeats every section title, so an unguarded match lands there first.
 */
function findHeading(idx: Index, re: RegExp, from = 0): { index: number; page: number; match: RegExpMatchArray } | null {
  for (let i = from; i < idx.lines.length; i++) {
    if (/\.{4,}/.test(idx.lines[i])) continue;
    const m = idx.lines[i].match(re);
    if (m) return { index: i, page: idx.linePages[i], match: m };
  }
  return null;
}

/**
 * pdf.js glues a word to the following "IOI" in this document family
 * ("ofIOI PG REIT", "toIOI PG"). Re-insert the missing space and normalise
 * whitespace and the stray space before punctuation / apostrophes.
 */
function tidy(s: string): string {
  return s
    .replace(/([a-z])(IOI)/g, '$1 $2')
    .replace(/([a-z])(PG REIT)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s+([’'])s\b/g, '$1s')
    .trim();
}

/** Title-cases an all-caps trust name while keeping short acronyms ("IOI PG"). */
function titleCase(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (/^[A-Z]{1,3}$/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(' ');
}

function scale(n: number | null, unit: string | undefined): number | null {
  if (n === null) return null;
  if (/billion/i.test(unit ?? '')) return n * 1_000_000_000;
  if (/million/i.test(unit ?? '')) return n * 1_000_000;
  return n;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * A REIT prospectus names a "REAL ESTATE INVESTMENT TRUST" on its cover and
 * speaks of Units / Unitholders / a Manager. Both signals are required so a
 * company that merely *mentions* a REIT (e.g. as a tenant or a buyer) is not
 * misclassified.
 */
export function isReitProspectus(pages: string[]): boolean {
  const head = pages.slice(0, 6).join('\n');
  if (!/REAL\s+ESTATE\s+INVESTMENT\s+TRUST/i.test(head)) return false;
  const body = pages.slice(0, 40).join('\n');
  return /\bUnitholders?\b/i.test(body) && /\bOffer\s+Units?\b/i.test(body) && /\bManager\b/.test(body);
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

function parseTrust(idx: Index): { name: Field<string>; full: Field<string> } {
  // "IOI PG MALAYSIA REAL ESTATE INVESTMENT TRUST (“ IOI PG REIT”)"
  const hit = findLine(
    idx,
    /^([A-Z0-9][A-Z0-9 &.'-]{3,80}?\s+REAL\s+ESTATE\s+INVESTMENT\s+TRUST)\s*\(\s*[“"]\s*([^”")]{2,40}?)\s*[”"]\s*\)/,
  );
  if (!hit) return { name: missing<string>(), full: missing<string>() };
  const full = titleCase(hit.match[1]);
  // The defined short name ("IOI PG REIT") is what the market will call it.
  const short = hit.match[2].replace(/\s+/g, ' ').trim();
  return {
    name: field(short, { page: hit.page, raw: hit.match[0] }),
    full: field(full, { page: hit.page }),
  };
}

function parseManager(idx: Index): { name: Field<string>; reg: Field<string> } {
  const hit = findProse(
    idx,
    /Manager,\s+([A-Z][\w&.' -]{3,60}?\s+Sdn\s+Bhd)\s*\(Registration\s+No\.?\s*(\d{12}\s*\([\dA-Z-]+\))\)/,
  );
  if (!hit) return { name: missing<string>(), reg: missing<string>() };
  return {
    name: field(tidy(hit.match[1]), { page: hit.page }),
    reg: field(`${hit.match[2].replace(/\s+/g, ' ')} (Manager)`, { page: hit.page }),
  };
}

function parseSponsor(idx: Index): Field<string> {
  const hit = findProse(idx, /((?:[A-Z][\w&']*\s+){1,5}Berhad)\s+is\s+the\s+Sponsor\s+of\b/);
  if (hit) return field(tidy(hit.match[1]), { page: hit.page });
  return missing<string>();
}

// ---------------------------------------------------------------------------
// Business
// ---------------------------------------------------------------------------

function parseBusiness(idx: Index): {
  description: Field<string>;
  model: Field<string>;
  scale: string[];
} {
  const policy = findProse(
    idx,
    /principal\s+investment\s+policy\s+of\s+investing,?\s+both\s+directly\s+and\s+indirectly,?\s+in\s+([^.]{20,400}?)\./i,
  );
  const clause = policy ? tidy(policy.match[1]).replace(/\s+and such other Non-Real Estate Assets.*$/i, '') : null;
  const description = clause
    ? field(`Invests in ${clause}`, { page: policy!.page, raw: policy!.match[0] })
    : missing<string>();

  // The concrete portfolio: "…comprises 9 quality freehold assets in strategic
  // locations across Selangor, KL City Centre and Penang … diversified across
  // the retail, hotel and office sectors … valued at approximately RM7.66
  // billion as at 31 May 2026."
  const portfolio = findProse(
    idx,
    /initial\s+asset\s+portfolio\s+of\s*IOI\s*PG\s+REIT\s+comprises\s+(\d+)\s+quality\s+(freehold\s+)?assets\s+in\s+strategic\s+locations\s+across\s+([^.]{5,120}?)\.\s*The\s+Subject\s+Properties\s+are\s+diversified\s+across\s+the\s+([^.]{5,80}?)\s+sectors\s+and\s+are\s+valued\s+at\s+approximately\s+RM\s?([\d.]+)\s+(billion|million)\s+as\s+at\s+([\d]{1,2}\s+\w+\s+\d{4})/i,
  );
  let model: Field<string> = missing<string>();
  const scaleFacts: string[] = [];
  if (portfolio) {
    const [, n, freehold, where, sectors, val, unit, asAt] = portfolio.match;
    model = field(
      `Owns ${n} ${freehold ? 'freehold ' : ''}properties across ${where.replace(/\s+/g, ' ')} (${sectors.replace(/\s+/g, ' ')} sectors), valued at about RM${val} ${unit} as at ${asAt}. Income is rental from retail and office tenants, plus master-lease rent from the hotels.`,
      { page: portfolio.page },
    );
    scaleFacts.push(`${n} ${freehold ? 'freehold ' : ''}properties`, `RM${val} ${unit} portfolio value`);
  }

  const mall = findProse(
    idx,
    /(IOI\s+City\s+Mall)\s+is\s+Malaysia[’']s\s+largest\s+retail\s+centre\s+with\s+an\s+NLA\s+of\s+more\s+than\s+([\d.]+)\s+million\s+sq\s+ft\s+and\s+houses\s+over\s+(\d+)\s+tenants/i,
  );
  if (mall) {
    scaleFacts.push(`${mall.match[1]}: >${mall.match[2]}m sq ft, ${mall.match[3]}+ tenants`);
  }
  return { description, model, scale: scaleFacts };
}

/** Numbered strategy list: "(i) Heading – supporting sentence." under 1.3 STRATEGIES. */
function parseStrategies(idx: Index): BusinessPoint[] {
  const start = findHeading(idx, /^1\.3\s+STRATEGIES\s*$/);
  if (!start) return [];
  const end = findLine(idx, /^1\.3\.1\b/, start.index);
  const stop = end ? end.index : start.index + 40;
  // Stop at the closing sentence so it is not appended to the last item.
  const text = idx.lines
    .slice(start.index + 1, stop)
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/These strategies will be implemented.*$/i, '');
  const parts = text.split(/\s*\((?:i{1,3}|iv|v)\)\s+/i).slice(1);
  const points: BusinessPoint[] = [];
  for (const part of parts) {
    const dash = part.match(/^(.{8,90}?)\s+[–-]\s+(.+)$/);
    if (!dash) continue;
    const firstSentence = dash[2].match(/^(.{20,260}?[.!])(?:\s|$)/)?.[1] ?? dash[2].slice(0, 220);
    points.push({
      heading: tidy(dash[1]),
      detail: tidy(firstSentence),
      page: start.page,
    });
  }
  return points;
}

/** "2.3.n Heading" lines under COMPETITIVE STRENGTHS AND INVESTMENT HIGHLIGHTS. */
function parseStrengths(idx: Index): BusinessPoint[] {
  const start = findHeading(idx, /(?:^|[.\s])2\.3\s+COMPETITIVE\s+STRENGTHS\s+AND\s+INVESTMENT\s+HIGHLIGHTS\s*$/);
  if (!start) return [];
  const end = findHeading(idx, /^2\.4\s+INDEPENDENT\s+PROPERTY/, start.index);
  const stop = end ? end.index : start.index + 700;
  const points: BusinessPoint[] = [];
  for (let i = start.index + 1; i < stop; i++) {
    const m = idx.lines[i].match(/^2\.3\.\d+\s+(.{10,})$/);
    if (!m) continue;
    let heading = m[1];
    // Headings wrap onto one further line that begins in lower case.
    for (let j = i + 1; j <= i + 2 && j < stop; j++) {
      if (/^[a-z]/.test(idx.lines[j])) heading += ` ${idx.lines[j]}`;
      else break;
    }
    points.push({ heading: tidy(heading), detail: null, page: idx.linePages[i] });
  }
  return points;
}

/** Headline risk titles ("5.x.y …"), the first two per sub-section plus key themes. */
function parseRisks(idx: Index): string[] {
  const start = findHeading(idx, /^5\.1\s+RISKS\s+RELATING\b/);
  if (!start) return [];
  const end = findLine(idx, /^6\.\s+THE\s+MANAGER\s*$/, start.index);
  const stop = end ? end.index : start.index + 2500;

  const all: { section: string; text: string }[] = [];
  for (let i = start.index; i < stop; i++) {
    const m = idx.lines[i].match(/^5\.(\d)\.\d+\s+(.{10,})$/);
    if (!m) continue;
    let text = m[2];
    for (let j = i + 1; j <= i + 4 && j < stop; j++) {
      if (/^[a-z(]/.test(idx.lines[j]) || /\b(in|of|the|and|to|or|for|a|on)$/i.test(text)) {
        text += ` ${idx.lines[j]}`;
      } else break;
    }
    all.push({ section: m[1], text: tidy(text).replace(/[.:]$/, '') });
  }

  const KEY = /distributions|dependent on the Sponsor|debt financing|conflicts of interest|removal of the Manager|amount IOI PG REIT may borrow/i;
  const perSection = new Map<string, number>();
  const picked: string[] = [];
  const seen = new Set<string>();
  const add = (t: string) => {
    const k = t.toLowerCase().slice(0, 60);
    if (seen.has(k)) return;
    seen.add(k);
    picked.push(t);
  };
  for (const r of all) {
    const n = perSection.get(r.section) ?? 0;
    if (n < 2) {
      add(r.text);
      perSection.set(r.section, n + 1);
    }
  }
  for (const r of all) if (picked.length < 14 && KEY.test(r.text)) add(r.text);
  return picked.slice(0, 14);
}

// ---------------------------------------------------------------------------
// Deal terms
// ---------------------------------------------------------------------------

function parseMarketCap(idx: Index): Field<number> {
  const hit = findProse(
    idx,
    /market\s+capitalisation\s+of\s+IOI\s*PG\s+REIT\s+upon\s+Listing\s+is\s+RM\s?([\d,]{9,})/i,
  );
  const v = num(hit?.match[1]);
  return hit && v !== null ? field(v, { page: hit.page, raw: hit.match[0] }) : missing<number>();
}

function parseFundSize(idx: Index): Field<number> {
  const counts = new Map<number, { n: number; page: number; raw: string }>();
  const re = /total\s+issued\s+fund\s+size\s+of\s+([\d,]{9,})\s+Units/gi;
  for (const m of idx.flat.matchAll(re)) {
    const v = num(m[1]);
    if (v === null || m.index === undefined) continue;
    const e = counts.get(v);
    if (e) e.n++;
    else counts.set(v, { n: 1, page: pageForOffset(idx.doc, m.index), raw: m[0] });
  }
  if (counts.size === 0) return missing<number>();
  const [value, meta] = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  return field(value, { page: meta.page, raw: meta.raw });
}

interface OfferingResult {
  allocations: Allocation[];
  offerUnits: Field<number>;
}

/**
 * Section 3.4 summary table. Row shapes seen:
 *   "Eligible Persons 55,000,000 1.0"
 *   "- Bumiputera 55,000,000 1.0"
 *   "55,000,000 1.0"  followed by  "- Non-Bumiputera"   (label printed after numbers)
 *   "Other Malaysian … as well as 796,885,463 14.5"  followed by a lower-case wrap line
 */
function parseOffering(idx: Index, retailPrice: number | null): OfferingResult {
  const heading = findHeading(idx, /^3\.4\s+DETAILS\s+OF\s+THE\s+OFFERING\s*$/);
  const prose = findProse(
    idx,
    /offering\s+by\s+the\s+Sponsor\s+of\s+up\s+to\s+([\d,]{9,})\s+Offer\s+Units/i,
  );
  const offerUnits = prose
    ? field(num(prose.match[1]), { page: prose.page, raw: prose.match[0] })
    : missing<number>();
  if (!heading) return { allocations: [], offerUnits };

  const start = findLine(idx, /^Retail\s+Offering:\s*$/, heading.index);
  if (!start) return { allocations: [], offerUnits };

  const out: Allocation[] = [];
  let group = '';
  let pending: { shares: number; pct: number } | null = null;

  const push = (label: string, shares: number, pct: number) => {
    const clean = tidy(label).replace(/^[-–•]\s*/, '');
    const isPublic = /^Malaysian Public/i.test(group) && /Bumiputera/i.test(clean);
    const full = isPublic ? `Malaysian Public (balloting) – ${clean}` : clean;
    out.push({
      label: full,
      tranche: 'offer_for_sale',
      shares,
      amountRM: retailPrice !== null ? Math.round(shares * retailPrice) : null,
      pctOfCapital: pct,
      isRetailBallot: isPublic,
    });
  };

  for (let i = start.index + 1; i < Math.min(start.index + 30, idx.lines.length); i++) {
    const line = idx.lines[i].trim();
    if (/^Total\s+Offering/i.test(line)) break;
    if (/^Institutional\s+Offering:\s*$/i.test(line)) {
      group = 'Institutional';
      continue;
    }
    if (/^Malaysian\s+Public\b.*:\s*$/i.test(line)) {
      group = 'Malaysian Public';
      continue;
    }
    if (/^Subtotal\b/i.test(line)) {
      pending = null;
      continue;
    }

    // Numbers-only line: the label is printed on the next line.
    const numsOnly = line.match(/^([\d,]{9,})\s+([\d.]+)$/);
    if (numsOnly) {
      pending = { shares: num(numsOnly[1])!, pct: num(numsOnly[2])! };
      continue;
    }
    if (pending) {
      const lab = line.match(/^[-–•]\s*(.+)$/);
      if (lab) {
        push(lab[1], pending.shares, pending.pct);
        pending = null;
        continue;
      }
      pending = null;
    }

    const row = line.match(/^(.+?)\s+([\d,]{9,})\s+([\d.]+)$/);
    if (row) {
      push(row[1], num(row[2])!, num(row[3])!);
      continue;
    }
    // Wrapped tail of the previous label ("foreign institutional and selected investors").
    if (/^[a-z]/.test(line) && out.length > 0 && !/\d{3}/.test(line)) {
      out[out.length - 1].label = tidy(`${out[out.length - 1].label} ${line}`);
    }
  }
  return { allocations: out, offerUnits };
}

function parseOverAllotment(idx: Index): Field<number> {
  const hit = findProse(
    idx,
    /up\s+to\s+an\s+aggregate\s+of\s+([\d,]{9,})\s+Units,\s+representing\s+up\s+to\s+15\.0%\s+of\s+the\s+total\s+Offer\s+Units/i,
  );
  const v = num(hit?.match[1]);
  return hit && v !== null ? field(v, { page: hit.page, raw: hit.match[0] }) : missing<number>();
}

function parseLockup(idx: Index): Field<string> {
  const hit = findProse(
    idx,
    /Sponsor\s+has\s+agreed\s+with\s+the\s+Joint\s+Bookrunners\s+that\s+for\s+a?\s*the\s+Lock-Up\s+Period/i,
  );
  const period = findProse(
    idx,
    /ending\s+on\s+and\s+including\s+the\s+date\s+that\s+is\s+(\d+)\s+months\s+after\s+the\s+date\s+of\s+the\s+Listing/i,
  );
  if (!period) return missing<string>();
  return field(
    `${period.match[1]}-month lock-up on the Sponsor${hit ? ' and the Manager' : ''} after listing`,
    { page: period.page, raw: period.match[0] },
  );
}

// ---------------------------------------------------------------------------
// People & ownership
// ---------------------------------------------------------------------------

function cleanRole(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/Non-\s+/gi, 'Non-')
    .replace(/\s*\/\s*/g, ' / ')
    .trim();
}

function person(name: string, role: string): Person {
  const r = cleanRole(role);
  return {
    name: name.replace(/\([A-Za-z]\)/g, '').replace(/\s+/g, ' ').trim(),
    role: r,
    isIndependent: /\bindependent\b/i.test(r.replace(/non-independent/gi, '')),
    isExecutive: /\b(managing|executive)\b/i.test(r.replace(/non-executive/gi, '')),
  };
}

/** "Name Nationality Position" tables for the Manager's board / key management. */
function parsePeopleTable(idx: Index, headingRe: RegExp): Person[] {
  const heading = findHeading(idx, headingRe);
  if (!heading) return [];
  const header = findLine(idx, /^Name\s+Nationality\s+Position\s*$/, heading.index);
  if (!header || header.index - heading.index > 12) return [];

  const people: Person[] = [];
  const NAT = /\s(Malaysian|Singaporean|British|Australian|Indonesian|Chinese|Indian|American)\s+(.*)$/;
  for (let i = header.index + 1; i < Math.min(header.index + 30, idx.lines.length); i++) {
    const line = idx.lines[i].trim();
    if (/^(Note|\d+\.\d+)/i.test(line)) break;
    const m = line.match(NAT);
    if (m && m.index !== undefined) {
      people.push(person(line.slice(0, m.index), m[2]));
    } else if (people.length > 0) {
      // Wrapped continuation of the previous position.
      const last = people[people.length - 1];
      people[people.length - 1] = person(last.name, `${last.role} ${line}`);
    }
  }
  return people;
}

/**
 * The Sponsor's holding after listing, from its own statement of how many
 * Units it keeps ("…the number of Units to be held by 3,300,000,000 Units").
 * Converted to a % of the fund size, so it is arithmetic on two stated
 * figures. The pre-listing 100% follows from the trust being formed with the
 * Sponsor as sole recipient of the Consideration Units.
 */
function parseSponsorHolding(idx: Index, fundSize: number | null, sponsor: string | null): Shareholder[] {
  if (!fundSize || !sponsor) return [];
  const hit = findProse(
    idx,
    /Over-allotment\s+Option\s+is\s+not\s+fully\s+exercised,\s+the\s+number\s+of\s+Units\s+to\s+be\s+held\s+by\s*([\d,]{9,})\s+Units/i,
  );
  const units = num(hit?.match[1]);
  if (!hit || units === null || units > fundSize) return [];
  return [
    {
      name: `${sponsor} (Sponsor)`,
      beforePct: 100,
      afterPct: Math.round((units / fundSize) * 1000) / 10,
    },
  ];
}

// ---------------------------------------------------------------------------
// Financials
// ---------------------------------------------------------------------------

interface PeriodResult {
  periods: FinancialPeriod[];
  npi: (number | null)[];
  distributableIncome: (number | null)[];
}

/**
 * Pro forma Statements of Comprehensive Income (Section 4.1). Anchored on the
 * "Total Revenue" row that carries the five period columns, with labels read
 * from the header lines above it.
 */
function parsePeriods(idx: Index): PeriodResult {
  const empty: PeriodResult = { periods: [], npi: [], distributableIncome: [] };
  const section = findHeading(idx, /^4\.1\s+PRO\s+FORMA\s+CONSOLIDATED\s+STATEMENTS\s+OF\s+COMPREHENSIVE\s+INCOME\s*$/);
  if (!section) return empty;

  // First "Total Revenue" row with >=3 numbers after the section heading.
  let rev = -1;
  for (let i = section.index; i < Math.min(section.index + 400, idx.lines.length); i++) {
    if (/^Total\s+Revenue\b/.test(idx.lines[i]) && rowNums(idx.lines[i]).length >= 3) {
      rev = i;
      break;
    }
  }
  if (rev < 0) return empty;
  const cols = rowNums(idx.lines[rev]).length;

  // Header: "FYE 2023 FYE 2024 FYE 2025 May 2025 May 2026" over two lines.
  const header = idx.lines.slice(Math.max(0, rev - 4), rev).join(' ');
  const labels: string[] = [];
  for (const m of header.matchAll(/FYE\s+(\d{4})|FPE\s+31\s+(?:\n|\s)*|May\s+(\d{4})/g)) {
    if (m[1]) labels.push(`FYE ${m[1]}`);
    else if (m[2]) labels.push(`FPE May ${m[2]}`);
  }
  if (labels.length !== cols) return empty;

  const periods = labels.map((l) => emptyPeriod(l));
  const npi = new Array<number | null>(cols).fill(null);
  const di = new Array<number | null>(cols).fill(null);

  const rows: { re: RegExp; set: (v: (number | null)[]) => void }[] = [
    { re: /^Total\s+Revenue\b/, set: (v) => v.forEach((x, c) => (periods[c].revenue = x)) },
    { re: /^NPI\b/, set: (v) => v.forEach((x, c) => (npi[c] = x)) },
    { re: /^Profit\s+before\s+taxation\b/i, set: (v) => v.forEach((x, c) => (periods[c].pbt = x)) },
    {
      re: /^Total\s+comprehensive\s+income\s+[\d(]/i,
      set: (v) => v.forEach((x, c) => (periods[c].pat = x)),
    },
    { re: /^Distributable\s+income\b/i, set: (v) => v.forEach((x, c) => (di[c] = x)) },
  ];
  for (let i = rev; i < Math.min(rev + 40, idx.lines.length); i++) {
    for (const { re, set } of rows) {
      if (!re.test(idx.lines[i])) continue;
      const nums = rowNums(idx.lines[i].replace(/^\(\d\)\s*/, ''));
      if (nums.length >= cols) set(nums.slice(nums.length - cols));
    }
  }

  // The "Distributable income" label is printed on the line AFTER its numbers
  // in this layout ("140,855 213,630 …" then "Distributable income"), so also
  // accept a bare numbers row that directly precedes that label.
  if (!di.some((v) => v !== null)) {
    for (let i = rev; i < Math.min(rev + 40, idx.lines.length); i++) {
      if (/^Distributable\s+income\s*$/i.test(idx.lines[i]) && i > 0) {
        const nums = rowNums(idx.lines[i - 1]);
        if (nums.length === cols) nums.forEach((x, c) => (di[c] = x));
      }
    }
  }

  // NPI margin, derived from two stated figures. Stored in the generic
  // "gross profit" slots because NPI is a REIT's equivalent (revenue less
  // property operating expenses); the dashboard relabels it for REITs.
  periods.forEach((p, c) => {
    p.grossProfit = npi[c];
    if (p.revenue && npi[c] !== null) p.gpMargin = Math.round((npi[c]! / p.revenue) * 1000) / 10;
    // PAT includes fair-value gains (>2x revenue), so a PAT margin would mislead.
    p.patMargin = null;
  });

  return { periods, npi, distributableIncome: di };
}

interface Projection {
  revenue: Field<number>;
  npi: Field<number>;
  distributableIncome: Field<number>;
  dpuSen: Field<number>;
  yieldPct: Field<number>;
}

function parseProjection(idx: Index): Projection {
  const none: Projection = {
    revenue: missing<number>(),
    npi: missing<number>(),
    distributableIncome: missing<number>(),
    dpuSen: missing<number>(),
    yieldPct: missing<number>(),
  };
  const anchor = findLine(idx, /^Projection\s+Period\s+2027\s*$/);
  if (!anchor) return none;

  const out = { ...none };
  const end = Math.min(anchor.index + 40, idx.lines.length);
  for (let i = anchor.index + 1; i < end; i++) {
    const l = idx.lines[i];
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^Total\s+Revenue\s+([\d,]+)\s*$/))) out.revenue = field(num(m[1]), { page: idx.linePages[i] });
    else if ((m = l.match(/^NPI\s+([\d,]+)\s*$/))) out.npi = field(num(m[1]), { page: idx.linePages[i] });
    else if ((m = l.match(/^Distributable\s+Income\s+([\d,]+)\s*$/i)))
      out.distributableIncome = field(num(m[1]), { page: idx.linePages[i] });
    else if ((m = l.match(/^DPU\s*\(sen\)\s+([\d.]+)\s*$/i))) out.dpuSen = field(num(m[1]), { page: idx.linePages[i], raw: l });
    else if ((m = l.match(/^Distribution\s+yield\s+on\s+Retail\s+Price\s*\(%\)\s+([\d.]+)\s*$/i)))
      out.yieldPct = field(num(m[1]), { page: idx.linePages[i], raw: l });
  }
  return out;
}

function parseProForma(idx: Index): ProFormaSnapshot[] {
  const anchor = findLine(idx, /^Pro\s+Forma\s+Consolidated\s+Statement\s+of\s+Financial\s+Position\s+as\s+at\s+the\s+date\s+of\s+establishment/i);
  if (!anchor) return [];
  const grab = (re: RegExp): number | null => {
    for (let i = anchor.index; i < Math.min(anchor.index + 40, idx.lines.length); i++) {
      const m = idx.lines[i].match(re);
      if (m) return num(m[1]);
    }
    return null;
  };
  const totalAssets = grab(/^TOTAL\s+ASSETS\s+([\d,]+)\s*$/);
  const totalLiabilities = grab(/^TOTAL\s+LIABILITIES\s+([\d,]+)\s*$/);
  const equity = grab(/^NAV\s*\(RM[’']?000\)\s+([\d,]+)\s*$/);
  const borrowings = grab(/^Borrowings\s+([\d,]+)\s*$/);
  const units = grab(/^No\.\s+of\s+Consideration\s+Units\s+in\s+issue\s*\(.{0,4}000\)\s+([\d,]+)\s*$/);
  const navPerUnit = grab(/^NAV\s+per\s+Unit\s*\(RM\)\s+([\d.]+)\s*$/);
  if (totalAssets === null || equity === null) return [];
  return [
    {
      label: 'At establishment',
      totalAssets,
      totalEquity: equity,
      totalLiabilities,
      borrowings,
      naPerShare: navPerUnit,
      // Debt-to-equity, the same definition the generic balance-sheet view uses.
      gearing: borrowings !== null && equity > 0 ? Math.round((borrowings / equity) * 100) / 100 : null,
      shares: units,
    },
  ];
}

function parseGearing(idx: Index): { pct: Field<number>; limit: Field<number> } {
  const g = findProse(
    idx,
    /total\s+indebtedness\s+of\s+approximately\s+RM[\d.]+\s+billion,?\s+representing\s+(?:approximately\s+)?([\d.]+)%\s+of\s+(?:its\s+|the\s+)?Total\s+Asset\s+Value/i,
  );
  const l = findProse(idx, /financing\s+of\s+up\s+to\s+(\d+)%\s+of\s+the\s+Total\s+Asset\s+Value/i);
  return {
    pct: g ? field(num(g.match[1]), { page: g.page, raw: g.match[0] }) : missing<number>(),
    limit: l ? field(num(l.match[1]), { page: l.page, raw: l.match[0] }) : missing<number>(),
  };
}

function parseDistribution(idx: Index): {
  pct: Field<number>;
  text: Field<string>;
  formal: Field<boolean>;
} {
  const hit = findProse(
    idx,
    /intention\s+of\s+the\s+Manager\s+to\s+distribute\s+at\s+least\s+(\d+)%\s+of\s+IOI\s*PG\s+REIT[’']?s\s+Distributable\s+Income\s+on\s+a\s+(quarterly)\s+basis/i,
  );
  if (!hit) return { pct: missing<number>(), text: missing<string>(), formal: missing<boolean>() };
  return {
    pct: field(num(hit.match[1]), { page: hit.page, raw: hit.match[0] }),
    text: field(`Distribute at least ${hit.match[1]}% of distributable income, ${hit.match[2]}`, {
      page: hit.page,
      raw: hit.match[0],
    }),
    formal: field(true, { page: hit.page }),
  };
}

function parseManagerFees(idx: Index): Field<string> {
  const hit = findProse(
    idx,
    /Manager\s+will\s+charge\s+a\s+base\s+fee\s+of\s+([\d.]+)%\s+per\s+annum\s+of\s+the\s+Total\s+Asset\s+Value[^;]{0,120}?and\s+a\s+performance\s+fee\s+of\s+([\d.]+)%\s+per\s+annum\s+of\s+the\s+consolidated\s+NPI/i,
  );
  if (!hit) return missing<string>();
  return field(
    `Base fee ${hit.match[1]}% p.a. of total asset value + performance fee ${hit.match[2]}% p.a. of NPI (assumed 50% cash / 50% in Units)`,
    { page: hit.page, raw: hit.match[0] },
  );
}

function parseMoneyBillion(idx: Index, re: RegExp): Field<number> {
  const hit = findProse(idx, re);
  const v = scale(num(hit?.match[1]), 'billion');
  return hit && v !== null ? field(v, { page: hit.page, raw: hit.match[0] }) : missing<number>();
}

function parseListingCosts(idx: Index): Field<number> {
  const anchor = findLine(idx, /^Professional\s+and\s+advisory\s+fees\s+([\d,]+)\s*$/);
  return anchor ? field(num(anchor.match[1]), { page: anchor.page }) : missing<number>();
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

/** Fills `field` only where the generic parse is blank or known-wrong. */
export function applyReit(base: ParsedProspectus, pages: string[]): ParsedProspectus {
  const idx = buildIndex(pages);

  const trust = parseTrust(idx);
  const mgr = parseManager(idx);
  const sponsor = parseSponsor(idx);
  const biz = parseBusiness(idx);
  const fundSize = parseFundSize(idx);
  const marketCap = parseMarketCap(idx);
  const offering = parseOffering(idx, base.ipoPrice.value);
  const periods = parsePeriods(idx);
  const proj = parseProjection(idx);
  const proForma = parseProForma(idx);
  const gearing = parseGearing(idx);
  const dist = parseDistribution(idx);
  const lock = parseLockup(idx);

  const offerUnits = offering.offerUnits.value;
  const price = base.ipoPrice.value;
  const gross =
    offerUnits !== null && price !== null
      ? field(Math.round(offerUnits * price), {
          page: offering.offerUnits.page,
          confidence: 'medium',
          raw: `${offerUnits.toLocaleString('en-US')} Offer Units × RM${price.toFixed(2)} Retail Price`,
        })
      : missing<number>();

  const reit: ReitInfo = {
    trustName: trust.full,
    manager: mgr.name,
    sponsor,
    appraisedValueRM: parseMoneyBillion(
      idx,
      /aggregate\s+fair\s+value\s+of\s+the\s+Subject\s+Properties\s+as\s+at\s+31\s+May\s+2026\s+is\s+approximately\s+RM([\d.]+)\s+billion/i,
    ),
    acquisitionPriceRM: parseMoneyBillion(
      idx,
      /total\s+purchase\s+consideration\s+of\s+approximately\s+RM([\d.]+)\s+billion/i,
    ),
    overAllotmentUnits: parseOverAllotment(idx),
    noProceedsToTrust: /will\s+not\s+receive\s+any\s+proceeds\s+from\s+the\s+Offering/i.test(idx.flat),
    listingCostsRM000: parseListingCosts(idx),
    projectedRevenue: proj.revenue,
    projectedNpi: proj.npi,
    projectedDistributableIncome: proj.distributableIncome,
    projectedDpuSen: proj.dpuSen,
    projectedYieldPct: proj.yieldPct,
    distributionPolicyPct: dist.pct,
    gearingPct: gearing.pct,
    gearingLimitPct: gearing.limit,
    managerFees: parseManagerFees(idx),
    npi: periods.npi,
    distributableIncome: periods.distributableIncome,
  };

  const next: ParsedProspectus = { ...base, reit };

  // Identity
  if (trust.name.value) next.companyName = trust.name;
  if (mgr.reg.value) next.registrationNo = mgr.reg;
  next.industry = field('Real Estate (REIT)', { confidence: 'high' });

  // Business
  if (biz.description.value) next.businessDescription = biz.description;
  if (biz.model.value) next.businessModel = biz.model;
  if (biz.scale.length > 0) next.operationalScale = biz.scale;
  const strategies = parseStrategies(idx);
  if (strategies.length > 0) next.businessStrategies = strategies;
  const strengths = parseStrengths(idx);
  if (strengths.length > 0) next.competitiveStrengths = strengths;

  // Deal terms. The generic market-cap match latches onto the *Sponsor's*
  // market capitalisation in the sponsor background section, so always prefer
  // the trust's own figure when present.
  if (marketCap.value !== null) next.marketCap = marketCap;
  if (fundSize.value !== null) next.enlargedShares = fundSize;
  next.peMultiple = missing<number>(); // no earnings history; yield is the REIT measure
  next.dilutionPct = missing<number>();

  // Structure: the Sponsor sells every Offer Unit; the trust issues none.
  if (offering.allocations.length > 0) next.allocations = offering.allocations;
  if (offerUnits !== null) {
    next.publicIssueShares = field(0, { confidence: 'high', raw: 'No new Units are issued under the Offering' });
    next.publicIssueGrossRM = field(0, { confidence: 'high', raw: 'The trust receives no proceeds' });
    next.offerForSaleShares = offering.offerUnits;
    next.offerForSaleGrossRM = gross;
  }

  // Proceeds: none flow to the trust, so the generic table is not applicable.
  next.proceedsUses = [];
  next.proceedsTotal = missing<number>();

  // Financials
  if (periods.periods.length > 0) next.periods = periods.periods;
  if (proForma.length > 0) {
    next.proForma = proForma;
    next.naPerShareAfter =
      proForma[0].naPerShare !== null ? field(proForma[0].naPerShare, { confidence: 'high' }) : next.naPerShareAfter;
  }

  // People & ownership
  const directors = parsePeopleTable(idx, /^6\.4\s+DIRECTORS\s+OF\s+THE\s+MANAGER\s*$/);
  if (directors.length > 0) next.directors = directors;
  const mgmt = parsePeopleTable(idx, /^6\.5\s+MANAGEMENT\s+TEAM\s+OF\s+THE\s+MANAGER\s*$/);
  // The CEO sits on the board and in the management table; list them once.
  const boardNames = new Set(directors.map((d) => d.name.toLowerCase()));
  if (mgmt.length > 0) next.management = mgmt.filter((x) => !boardNames.has(x.name.toLowerCase()));
  const holding = parseSponsorHolding(idx, fundSize.value, sponsor.value);
  if (holding.length > 0) next.shareholders = holding;
  if (lock.value) next.moratorium = lock;

  // Policy
  if (dist.text.value) {
    next.dividendPolicy = dist.text;
    next.hasFormalDividendPolicy = dist.formal;
  }

  // Risks
  const risks = parseRisks(idx);
  if (risks.length > 0) next.riskFactors = risks;

  // A REIT keeps no staff or order book and has no customer-concentration table.
  next.employees = missing<number>();
  next.orderBook = missing<number>();
  next.orderBookRaw = missing<string>();
  next.customerConcentration = missing<number[]>();

  return next;
}

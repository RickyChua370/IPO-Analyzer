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
  // abbreviation in quotes: 'SLGC BERHAD ("SLGC" OR THE "COMPANY")'. The name
  // frequently wraps across a line break, so match against the newline-
  // flattened text and allow the name to span it.
  const hit = findProse(
    idx,
    // The name may begin with a digit ("99 SPEED MART ...") and wrap a line.
    /(?:ELECTRONIC\s+)?PROSPECTUS\s+OF\s+([A-Z0-9][A-Z0-9\s&.'-]{2,80}?\s+BERHAD)\b/i,
  );
  if (hit) {
    return field(tidyName(hit.match[1]), { page: hit.page, raw: hit.match[0] });
  }

  // "...OF UP TO n ORDINARY SHARES IN <NAME> BERHAD" (offer-summary phrasing).
  const inShares = findProse(
    idx,
    /ORDINARY\s+SHARES\s+IN\s+([A-Z0-9][A-Z0-9\s&.'-]{2,80}?\s+BERHAD)\b/i,
  );
  if (inShares) {
    return field(tidyName(inShares.match[1]), { page: inShares.page, confidence: 'medium' });
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
      if (/^\d+$/.test(word)) return word; // numeric token, e.g. "99"
      // Preserve acronyms/initialisms: all-caps tokens that are either very
      // short or vowel-less (SLGC, YTL, MBSB, DKSH, KPJ). Title-case ordinary
      // words that merely appear in full caps on the cover ("SPEED", "MART").
      const isAcronym =
        /^[A-Z][A-Z0-9&.-]{1,4}$/.test(word) && (word.length <= 3 || !/[AEIOU]/.test(word));
      if (isAcronym) return word;
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
  // The principal-activity sentence is phrased several ways across prospectuses.
  // "Through our subsidiaries, {we are|our Group is} principally involved in X"
  // is the canonical form; the subject between the comma and "principally" may
  // be "we are", "our Group is", "the Group is", etc.
  const patterns: RegExp[] = [
    /Through our (?:Subsidiar(?:y|ies)|Group)[^.]{0,40}?principally involved in\s+(?:the\s+)?([^.]{10,300}?)\./i,
    /(?:we are|our Group is|the Group is)\s+principally involved in\s+(?:the\s+)?([^.]{10,300}?)\./i,
    // "...involved in the retailing of FMCG across Malaysia" (99 Speed Mart)
    /(?:chain\s+of\s+)?[a-z-]+\s+outlets?\s+involved\s+in\s+(?:the\s+)?([^.]{10,200}?)\./i,
    /principal\s+activit(?:y|ies)\s+(?:of\s+our\s+Group\s+)?(?:is|are|comprises?)\s+(?:that\s+of\s+)?(?:an?\s+)?([^.]{10,300}?)\./i,
    /\b(?:we are|our Group is)\s+(?:principally\s+)?engaged in\s+(?:the\s+)?([^.]{10,300}?)\./i,
    // "we operate ... 'Speedmart' chain of mini-market outlets" — capture role
    /we\s+(?:operate|own\s+and\s+operate)\s+(?:a\s+|the\s+)?([^.]{10,200}?)\./i,
  ];
  for (let k = 0; k < patterns.length; k++) {
    const hit = findProse(idx, patterns[k]);
    const captured = hit?.match[1]?.trim();
    // Reject captures that are clearly MD&A/financial prose, not an activity.
    if (
      hit &&
      captured &&
      captured.length >= 10 &&
      !/\bFYE\b|\brevenue\b|\bin line with\b|\bincrease\b|\bdecrease\b|\bmargin\b/i.test(captured)
    ) {
      return field(cleanProse(captured), { page: hit.page, confidence: k === 0 ? 'high' : 'medium' });
    }
  }
  return missing<string>();
}

function cleanProse(s: string): string {
  return (
    s
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.])/g, '$1')
      // Drop a dangling lead-in left by list-style activities ("...following: (a) ...").
      .replace(/^(?:the\s+)?following:?\s*/i, '')
      .replace(/^\([a-z]\)\s*/i, '')
      // Cut page-break/footer artifacts that bleed in from the flattened text
      // ("... massage services; 4 4 Registration No. 2021...").
      .replace(/\s+\d{1,4}\s+\d{1,4}\s+Registration\s+No\.?.*$/i, '')
      .replace(/\s+Registration\s+No\.?.*$/i, '')
      // Trailing bare page numbers ("... services; 4 4").
      .replace(/;?\s+\d{1,4}(\s+\d{1,4})?\s*$/, '')
      // Collapse an immediately-repeated word from PDF layout duplication
      // ("digital transformationtransformation" / "solutions solutions").
      .replace(/\b(\w{5,})\1\b/gi, '$1')
      .replace(/\b(\w{4,})\s+\1\b/gi, '$1')
      .trim()
  );
}

/**
 * Infers a broad sector label from the stated principal activities.
 *
 * Prospectuses do not print a standard sector code, so this is a keyword
 * heuristic and is reported with medium confidence. It is used only for the
 * comparison view's grouping, never for any threshold or flag.
 */
function parseIndustry(idx: DocIndex, description: string | null): Field<string> {
  // The stated principal activity (business description) is the most reliable
  // signal, so weight it far more heavily than the rest of the document, where
  // stray mentions of "software" or "technology" would otherwise mislead a
  // first-match heuristic (e.g. tagging a hospital group as "Technology").
  const desc = (description ?? '').toLowerCase();
  const bulk = idx.flat.slice(0, 60_000).toLowerCase();

  const sectors: [string, RegExp][] = [
    ['Healthcare', /\b(healthcare|hospital|medical centre|medical center|clinic|ambulatory|pharmaceutic|medical device|senior living|nursing|patient|specialist care|tcm centre)\b/g],
    ['Construction & Engineering', /\b(building construction|civil engineering|contractor|earthworks|infrastructure works|cidb|g7 contractor|piling|substructure)\b/g],
    ['Property Development', /\b(property develop|real estate develop|township develop|property investment|land bank)\b/g],
    ['Oil & Gas', /\b(oil and gas|petroleum|upstream|downstream|offshore support|drilling|fpso)\b/g],
    ['Renewable Energy', /\b(solar|renewable energy|photovoltaic|\bepcc\b|power plant|solar farm)\b/g],
    ['Technology', /\b(software|information technology|\bsaas\b|semiconductor|data cent(?:re|er)|fintech|cloud computing|it solutions|app develop)\b/g],
    ['Logistics & Transport', /\b(logistics|freight|haulage|warehousing services|shipping|cold chain|last[- ]mile|courier)\b/g],
    ['Food & Beverage', /\b(food and beverage|\bf&b\b|restaurant|catering|confectioner|beverage manufactur|packaged food)\b/g],
    ['Consumer Services', /\b(vending|massage|leisure|wellness|spa|fitness|gym|entertainment|amusement|rental plans?|rental services|karaoke|hospitality services)\b/g],
    ['Retail & Consumer', /\b(retail outlet|retailing|mini[- ]?market|convenience store|consumer products|e-commerce|grocery|\bfmcg\b|departmental store|chain of|supermarket)\b/g],
    ['Agriculture', /\b(plantation|palm oil|agricultur|aquacultur|poultry|fisheries|crop)\b/g],
    ['Education', /\b(education|tuition|training centre|private college|university|academic)\b/g],
    ['Manufacturing', /\b(manufactur|fabricat|assembly plant|production facilit|industrial products)\b/g],
    ['Financial Services', /\b(money lending|insurance broking|fund management|payment services|financing|credit)\b/g],
  ];

  const count = (re: RegExp, text: string) => (text.match(re) ?? []).length;

  let bestLabel: string | null = null;
  let bestScore = 0;
  for (const [label, re] of sectors) {
    const score = count(re, desc) * 8 + count(re, bulk);
    if (score > bestScore) {
      bestScore = score;
      bestLabel = label;
    }
  }

  // Require a minimum signal so we don't guess a sector from one stray word.
  if (bestLabel && bestScore >= 2) return field(bestLabel, { confidence: 'medium' });
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
    // Main Market book-built IPOs quote a "Retail Price" / "Final Retail Price".
    /(?:Final\s+)?Retail\s+Price\s*\(RM\)\s*([\d.]+)/i,
    /(?:Final\s+)?Retail\s+Price\s+of\s+RM\s?([\d.]+)/i,
    /Institutional\s+Price\s+of\s+RM\s?([\d.]+)/i,
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
  // Prose forms with an explicit unit ("approximately RM16.7 billion") — scale
  // to ringgit. Handles million/billion and the "will be / of / is" variants.
  const proseUnit = [
    /total\s+market\s+capitalisation\s+of\s+our\s+Company\s+upon\s+(?:our\s+)?Listing\s+(?:would\s+be\s+|is\s+|will\s+be\s+)?(?:approximately\s+)?RM\s?([\d.,]+)\s*(million|billion)/i,
    /market\s+capitalisation\s+(?:upon\s+(?:our\s+)?Listing\s+)?(?:would\s+be\s+|is\s+|will\s+be\s+|of\s+)?(?:approximately\s+)?RM\s?([\d.,]+)\s*(million|billion)/i,
  ];
  for (const re of proseUnit) {
    const hit = findProse(idx, re);
    const v = toNumber(hit?.match[1]);
    if (hit && v !== null) {
      const unit = hit.match[2] ?? '';
      const rm = /billion/i.test(unit) ? v * 1_000_000_000 : v * 1_000_000;
      return field(rm, { page: hit.page, raw: hit.match[0] });
    }
  }
  // Table/plain forms already in ringgit (no unit word).
  const plain: RegExp[] = [
    /Market\s+capitalisation\s*(?:upon\s+Listing\s*)?(?:\(\d\))?\s*RM\s?([\d,]{6,})/i,
    /total\s+market\s+capitalisation\s+will\s+be\s+RM\s?([\d,]{6,})/i,
    /market\s+capitalisation\s+(?:upon\s+Listing\s+)?of\s+RM\s?([\d,]{6,})/i,
  ];
  for (const re of plain) {
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
    // Main Market phrasing: "enlarged issued Shares of 8,400,000,000 ... upon our Listing"
    /enlarged\s+(?:number\s+of\s+)?issued\s+Shares\s+of\s+([\d,]{7,})\s+(?:Shares\s+)?upon\s+(?:our\s+)?Listing/i,
    /enlarged\s+issued\s+Shares\s+of\s+([\d,]{7,})/i,
  ];
  // Collect all matches and take the most common value: the enlarged count is
  // repeated many times in footnotes, so the mode is robust against a stray
  // pre-Subdivision or Over-allotment figure.
  const counts = new Map<number, { n: number; page?: number; raw: string }>();
  for (const re of patterns) {
    for (const line of idx.lines) {
      const m = line.match(re);
      const v = toNumber(m?.[1]);
      if (m && v !== null && v > 1_000_000) {
        const e = counts.get(v);
        if (e) e.n++;
        else counts.set(v, { n: 1, raw: m[0] });
      }
    }
  }
  if (counts.size > 0) {
    const [value, meta] = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)[0];
    return field(value, { raw: meta.raw });
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
    /gross\s+proceeds\s+(?:to\s+be\s+raised\s+)?(?:by\s+our\s+Company\s+)?from\s+(?:the\s+|our\s+)?Public\s+Issue\s+(?:of\s+|amounting\s+to\s+)(?:up\s+to\s+)?(?:approximately\s+)?RM\s?([\d.]+)\s*(million|billion)?/i,
  );
  const ofsProse = findProse(
    idx,
    /gross\s+proceeds\s+from\s+(?:the\s+|our\s+)?Offer\s+for\s+Sale\s+(?:of\s+)?(?:up\s+to\s+)?(?:approximately\s+)?RM\s?([\d.]+)\s*(million|billion)?/i,
  );

  const scale = (n: number | null, unit: string | undefined) => {
    if (n === null) return null;
    if (/billion/i.test(unit ?? '')) return n * 1_000_000_000;
    if (/million/i.test(unit ?? '')) return n * 1_000_000;
    return n;
  };

  const piProseRM = scale(toNumber(piProse?.match[1]), piProse?.match[2]);
  const ofsProseRM = scale(toNumber(ofsProse?.match[1]), ofsProse?.match[2]);

  // Share counts: SLGC states "A total of N Issue Shares"; 99SM defines them as
  // "Public issue of N Issue Shares" / "The N new Shares to be issued".
  const issueSharesProse =
    findProse(idx, /A\s+total\s+of\s+([\d,]{7,})\s+Issue\s+Shares,\s+representing/i) ??
    findProse(idx, /Public\s+[Ii]ssue\s+of\s+([\d,]{7,})\s+(?:Issue\s+)?(?:new\s+)?Shares/i) ??
    findProse(idx, /\bThe\s+([\d,]{7,})\s+new\s+Shares\s+to\s+be\s+issued/i);
  // Prefer the authoritative "Offer for Sale of up to N ... Shares" definition
  // over a "N Offer Shares, representing ..." line, which is usually a smaller
  // sub-tranche (e.g. the retail clawback portion) rather than the OFS total.
  const ofsSharesProse =
    findProse(idx, /Offer\s+for\s+[Ss]ale\s+of\s+(?:up\s+to\s+)?([\d,]{7,})\s+(?:existing\s+|Offer\s+)?[Ss]hares/i) ??
    findProse(idx, /COMPRISING\s+AN\s+OFFER\s+FOR\s+SALE\s+OF\s+(?:UP\s+TO\s+)?([\d,]{7,})/i) ??
    findProse(idx, /([\d,]{7,})\s+Offer\s+Shares,\s+representing/i);

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
  if (/listing\s+expense|issue\s+expense|estimated\s+expenses|defray\s+(?:the\s+)?(?:fees|expenses)|fees\s+and\s+expenses/.test(l))
    return 'expenses';
  if (
    /repay|repayment|reduction\s+of\s+(?:bank\s+)?borrowing|settle.*borrowing|redemption\s+of\s+(?:the\s+)?(?:sukuk|bond|notes?|loan|debt|borrowing)|pare\s+down\s+(?:debt|borrowing)|paring\s+down/.test(
      l,
    )
  ) {
    return 'debt';
  }
  if (/working\s+capital/.test(l)) return 'working_capital';
  if (
    /machinery|equipment|capital\s+expenditure|capex|expansion|expenditure|\b(?:new|additional)\b.*\b(?:factory|plant|outlet|branch|dc|distribution|office|hq|headquarter|lab|centre|center|site|store)|\b(?:office|hq|headquarter|factory|warehouse|laborator|lab)\b|setting[\s-]*up|set[\s-]*up|establish|network\s+of\s+outlets|software|automation|digital|renovation|refurbish|construction\s+of|acquisition|research|development|\br&d\b|fleet|vehicle|truck|upgrad|store|outlet|strategic\s+growth|growth\s+initiative|marketing|branding|promotional|geographical\s+expansion|data\s+(?:analytics|cent)|\bsoc\b|\bai\b/.test(
      l,
    )
  ) {
    return 'growth';
  }
  return 'other';
}

/**
 * Parses the utilisation-of-proceeds table.
 *
 * Two layouts occur in Bursa prospectuses, and they differ in column order,
 * units, and row numbering:
 *   SLGC:  "Description of utilisation | RM'000 | % | timeframe"
 *   99SM:  "Details of use of proceeds | timeframe | RM million | %"  (with
 *          hierarchical 1./(i)/(ii) numbering and amounts in RM million)
 *
 * We locate the header flexibly, detect the unit scale, and match a data row
 * as: a label, a timeframe token that may sit either before or after the two
 * trailing numbers, and the amount/percent pair. Amounts are normalised to
 * RM'000 so downstream maths is unit-consistent regardless of the source.
 */
function parseProceeds(idx: DocIndex): { uses: ProceedsUse[]; total: Field<number> } {
  // Header wording varies widely across prospectuses:
  //   "Description of utilisation | RM'000 | % | timeframe"   (SLGC)
  //   "Details of use of proceeds | timeframe | RM million | %"  (99 Speed Mart)
  //   "Description of use of proceeds | RM'000 | %"           (Sunway)
  //   "Utilisation of proceeds | RM'000 | % | timeframe"      (RNG Tech)
  //
  // The tricky part: "Utilisation of proceeds" is also the *section heading*
  // (e.g. "2.9 UTILISATION OF PROCEEDS"), which is not the table. So we accept
  // a bare "Utilisation of proceeds" line only when it also carries the table's
  // column markers (RM'000 / RM million and/or %), which the heading never has.
  // Header wording seen so far:
  //   "Description of utilisation | RM'000 | % | timeframe"   (SLGC)
  //   "Details of use of proceeds | timeframe | RM million | %"  (99 Speed Mart)
  //   "Description of use of proceeds | RM'000 | %"           (Sunway)
  //   "Utilisation of proceeds | RM'000 | % | timeframe"      (RNG Tech)
  //   "No. Description (RM'000) proceeds Listing"             (SRKK AI)
  //   "Purposes | RM'000 | % | Listing date"                 (Pioneer)
  //
  // The label column may be titled "Description", "Details", "Purpose(s)",
  // "Particulars", "Utilisation of proceeds", etc. To avoid matching prose or
  // the section heading, we only accept a line that ALSO carries the table's
  // column markers — a units token (RM'000 / RM million) and/or a "%"/"proceeds"
  // column — and is short enough to be a header row, not a sentence.
  const isColumnHeader = (line: string): boolean => {
    const hasLabelWord =
      /(?:Description|Details?|Purpose|Purposes|Particulars|Proposed)\b/i.test(line) ||
      /^\s*(?:No\.?\s+)?(?:Description|Purpose|Particulars)\b/i.test(line) ||
      /^Utilisation\s+of\s+proceeds\b/i.test(line);
    if (!hasLabelWord) return false;
    const hasUnitMarker = /\bRM\s*['’]?\s*(?:000|million|mil|m)\b/i.test(line);
    const hasPctOrProceedsCol = /%|\bproceeds\b/i.test(line);
    if (!hasUnitMarker && !hasPctOrProceedsCol) return false;
    // Reject long prose lines (a real column-header row is short).
    return line.trim().split(/\s+/).length <= 14;
  };

  let header: LineHit | null = null;
  for (let i = 0; i < idx.lines.length; i++) {
    if (isColumnHeader(idx.lines[i])) {
      header = { line: idx.lines[i], index: i, page: idx.linePages[i], match: [idx.lines[i]] };
      break;
    }
  }
  if (!header) return { uses: [], total: missing<number>() };

  // Determine the amount unit from the header region (default RM'000).
  // The unit may be a standalone column header ("RM" on one line, "million"
  // on the next), so we test the whole region for the words rather than
  // requiring "RM million" to be adjacent.
  const headerContext = idx.lines
    .slice(Math.max(0, header.index - 3), header.index + 3)
    .join(' ');
  const scale = /RM\s*'?000|RM'000/i.test(headerContext)
    ? 1 // already RM'000
    : /\bbillion\b/i.test(headerContext)
      ? 1_000_000
      : /\bmillion\b|RM\s*'?m\b|\bmil\b/i.test(headerContext)
        ? 1000 // RM million -> RM'000
        : 1;

  const uses: ProceedsUse[] = [];
  let total: Field<number> = missing<number>();

  // Non-capturing so the group indices in the row patterns below stay stable.
  // Timeframes appear as "Within 12 months", a bare "24 months" / "61 months"
  // / "1 month", "Immediately", "Upon Listing", or "By Aug 2026".
  const TIMEFRAME =
    /(?:Within\s+\d+\s*\w+|\d+\s*(?:months?|years?|weeks?)|Immediate\w*|Upon\s+[A-Za-z ]+?|By\s+\w+\s+\d{4})/i;

  for (let i = header.index + 1; i < Math.min(header.index + 45, idx.lines.length); i++) {
    const line = idx.lines[i];
    if (/^Notes?:/i.test(line)) break;

    // Total row: "Total 16,390 100.0" or "Total Public Issue proceeds 20,480
    // 100.00" — allow words between "Total" and the figures.
    const tm = line.match(/^Total\b[^\d]*?([\d,]+(?:\.\d+)?)\s+([\d.]+)?\s*$/i);
    if (tm) {
      const t = toNumber(tm[1]);
      total = field(t === null ? null : t * scale, { page: idx.linePages[i], raw: line });
      break;
    }

    // Strip leading hierarchical numbering: "1.", "(i)", "(a)", "2."
    const stripped = line.replace(/^\s*(?:\d+\.|\([a-z0-9]+\))\s*/i, '');

    // Layout A: label ... amount pct timeframe   (SLGC)
    // Layout B: label ... timeframe amount pct   (99SM)
    let label: string | null = null;
    let amount: number | null = null;
    let pct: number | null = null;
    let timeframe: string | null = null;

    const a = stripped.match(
      new RegExp(`^(.+?)\\s+([\\d,]+(?:\\.\\d+)?)\\s+([\\d.]+)\\s+(${TIMEFRAME.source})\\s*$`, 'i'),
    );
    const b = stripped.match(
      new RegExp(`^(.+?)\\s+(${TIMEFRAME.source})\\s+([\\d,]+(?:\\.\\d+)?)\\s+([\\d.]+)\\s*$`, 'i'),
    );

    if (a) {
      label = a[1];
      amount = toNumber(a[2]);
      pct = toNumber(a[3]);
      timeframe = a[4];
    } else if (b) {
      label = b[1];
      timeframe = b[2];
      amount = toNumber(b[3]);
      pct = toNumber(b[4]);
    } else {
      continue;
    }

    label = label.replace(/\s*\([a-z0-9]\)\s*$/i, '').replace(/\s+/g, ' ').trim();
    // Skip pure section headers like "Outlet and DC expenditure" that carry no
    // numbers of their own (they matched only if they had trailing digits).
    if (!label || amount === null) continue;

    // Absorb a short wrapped continuation label on the next line. Prospectus
    // labels wrap mid-phrase ("... existing RNG" / "stations and RNG premium
    // outlets"), so allow a short line that carries no figures and is not
    // itself a new row — it may contain capitalised words/acronyms (RNG, DC).
    const next = idx.lines[i + 1]?.trim();
    if (
      next &&
      next.length <= 45 &&
      !/\d/.test(next) &&
      !TIMEFRAME.test(next) &&
      !/^(total|notes?|there|description|details|utilisation|purpose|proposed)\b/i.test(next)
    ) {
      label = `${label} ${next}`;
      i += 1; // consume the continuation line so it is not re-examined
    }

    uses.push({
      label,
      amount: amount === null ? null : amount * scale,
      pct,
      timeframe: timeframe ? timeframe.replace(/\s+/g, ' ').trim() : null,
      category: classifyProceeds(label),
    });
  }

  // If the table had no explicit Total row, fall back to the prose statement
  // ("gross proceeds from our Public Issue amounting to RM660.0 million").
  if (total.value === null) {
    const proseTotal = findProse(
      idx,
      /gross\s+proceeds\s+from\s+(?:our\s+)?(?:the\s+)?Public\s+Issue\s+(?:of\s+|amounting\s+to\s+)(?:up\s+to\s+)?(?:approximately\s+)?RM\s?([\d.,]+)\s*(million|billion)?/i,
    );
    if (proseTotal) {
      const n = toNumber(proseTotal.match[1]);
      if (n !== null) {
        const unit = proseTotal.match[2] ?? '';
        const rmThousands = /billion/i.test(unit)
          ? n * 1_000_000
          : /million/i.test(unit)
            ? n * 1000
            : n;
        total = field(rmThousands, { page: proseTotal.page, confidence: 'medium' });
      }
    }
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
  // The header varies: "Events Indicative date" (ACE) or "Event Time and/or
  // date" (Main Market). Match either.
  const header =
    findLine(idx, /^Events?\s+Indicative\s+date\s*$/i) ??
    findLine(idx, /^Events?\s+Time\s+and\s*\/?\s*or\s+date\s*$/i) ??
    findLine(idx, /^Events?\s+(?:Indicative\s+)?(?:time|date)/i);
  const timetable: TimetableEntry[] = [];

  if (header) {
    for (let i = header.index + 1; i < Math.min(header.index + 18, idx.lines.length); i++) {
      const line = idx.lines[i];
      // A date at the end, optionally preceded by a time ("10.00 a.m., ").
      const m = line.match(
        /^(.+?)\s+(?:\d{1,2}\.\d{2}\s*[ap]\.?m\.?,?\s*)?(\d{1,2}\s+\w+\s+\d{4})\s*$/i,
      );
      if (!m) {
        if (timetable.length > 0 && /^(Notes?:|\(\d\))/i.test(line)) break;
        continue;
      }
      let event = m[1].replace(/\s+/g, ' ').replace(/\(\d\)\s*$/, '').trim();
      // Absorb a wrapped event tail from the next line (e.g. "... under the
      // Retail" / "Offering").
      const next = idx.lines[i + 1];
      if (next && /^[A-Z][a-z]/.test(next) && next.trim().length < 20 && !/\d{4}/.test(next)) {
        event = `${event} ${next.trim()}`;
      }
      timetable.push({ event, date: m[2], iso: toIso(m[2]) });
      if (timetable.length >= 12) break;
    }
  }

  const pick = (re: RegExp): Field<string> => {
    const entry = timetable.find((t) => re.test(t.event));
    if (entry) return field(entry.date, { page: header?.page });
    return missing<string>();
  };

  return {
    timetable,
    open: pick(/opening\s+of\s+(?:the\s+)?(?:application|retail)/i),
    close: pick(/clos(?:ing|e)\s+(?:date|of\s+(?:the\s+)?(?:application|retail))/i),
    listing: pick(/^listing\b|date\s+of\s+listing|listing\s+on\s+the/i),
  };
}

// ---------------------------------------------------------------------------
// Financial highlights
// ---------------------------------------------------------------------------

/**
 * Builds period labels for a financial table given the number of data columns
 * and the header lines directly above the first data row.
 *
 * Prospectuses format the header two ways:
 *   inline   — "FYE 2022 FYE 2023 FYE 2024 FYE 2025 FPE 2026"
 *   split    — "FYE            FPE 31 March"   (types)
 *              "2021 2022 2023 2023 2024"       (years, one per column)
 *
 * The split form defeats a single-line regex, so when we cannot find `columns`
 * inline labels we fall back to pairing the trailing run of year tokens with
 * the period-type words (FYE/FPE) that precede them. This is what lets a retail
 * IPO like 99 Speed Mart parse where the construction template assumption did
 * not hold.
 */
function buildPeriodLabels(headerLines: string[], columns: number): string[] | null {
  const joined = headerLines.join(' ').replace(/\s+/g, ' ');

  // 1) Fully inline labels present?
  const inline = joined.match(/\b(FYE|FPE|FYA)\s*(\d{4})\b/gi);
  if (inline && inline.length === columns) {
    return inline.map((t) => t.replace(/\s+/g, ' ').toUpperCase().trim());
  }

  // 2) Split header: take the last `columns` bare year tokens as the columns,
  //    then decide FYE vs FPE per column from the surrounding type words.
  const years = joined.match(/\b(19|20)\d{2}\b/g);
  if (!years || years.length < columns) return null;
  const cols = years.slice(years.length - columns);

  // Decide which trailing columns are FPE (partial/interim) periods.
  //
  // Strongest signal: a repeated year. Prospectuses show an interim period
  // alongside its prior-year comparative, e.g. years "2021 2022 2023 2023 2024"
  // where the final "2023 2024" pair are both FPE (the comparative FPE 2023 and
  // the current FPE 2024). The first index at which a year repeats marks where
  // the FPE block begins.
  let fpeStart = -1;
  for (let i = 1; i < cols.length; i++) {
    if (cols[i] === cols[i - 1]) {
      // The repeated year is the FPE comparative; the earlier occurrence is
      // the full FYE. So the FPE block begins at the *second* occurrence.
      fpeStart = i;
      break;
    }
  }

  // Fallback: if no repeat, treat the trailing FPE-mention count as interim.
  if (fpeStart < 0) {
    const fpeCount = (joined.match(/\bFPE\b/gi) ?? []).length;
    if (fpeCount > 0) fpeStart = columns - Math.min(fpeCount, columns);
  }

  return cols.map((y, i) => {
    const isFpe = fpeStart >= 0 && i >= fpeStart;
    return `${isFpe ? 'FPE' : 'FYE'} ${y}`;
  });
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
  { key: 'revenue', patterns: [/^Revenue\b/i, /^Turnover\b/i, /^Total\s+revenue\b/i] },
  // Margins are matched before their base figures so "GP margin (%)" is never
  // mistaken for "GP", and "... margin" variants never fall through to profit.
  { key: 'gpMargin', patterns: [/^GP\s+margin\b/i, /^Gross\s+profit\s+margin\b/i] },
  {
    key: 'patMargin',
    patterns: [
      /^PAT\s+margin\b/i,
      /^PATAMI\s+margin\b/i,
      /^PATMI\s+margin\b/i,
      /^Net\s+profit\s+margin\b/i,
      /^Net\s+margin\b/i,
      /^Profit\s+margin\b/i,
    ],
  },
  { key: 'grossProfit', patterns: [/^GP(?!\s*margin)\b/i, /^Gross\s+profit(?!\s*margin)\b/i] },
  {
    key: 'otherIncome',
    patterns: [
      /^Other\s+operating\s+income\b/i,
      /^Other\s+operating\b/i,
      /^Other\s+income\b/i,
      /^Other\s+(?:gains|revenue)\b/i,
    ],
  },
  {
    key: 'pbt',
    patterns: [
      /^PBT(?!\s*margin)\b/i,
      /^Profit\s+before\s+tax(?:ation)?\b/i,
      /^Profit\s*\/?\s*\(loss\)\s+before\s+tax(?:ation)?\b/i,
      /^\(Loss\)\s*\/?\s*profit\s+before\s+tax(?:ation)?\b/i,
      /^Profit\s+before\s+income\s+tax\b/i,
    ],
  },
  {
    key: 'pat',
    patterns: [
      /^PAT(?!\s*margin|MI|AMI)\b/i,
      /^PATAMI(?!\s*margin)\b/i,
      /^PATMI(?!\s*margin)\b/i,
      /^Profit\s+after\s+tax(?:ation)?(?!\s*margin)\b/i,
      /^Net\s+profit(?!\s*margin)\b/i,
      // IFRS-style phrasings common in large-cap prospectuses.
      /^Profit\s+for\s+the\s+(?:financial\s+)?(?:year|period)(?:\s*\/\s*period)?\b/i,
      /^Profit\s*\/?\s*\(loss\)\s+for\s+the\s+(?:financial\s+)?(?:year|period)\b/i,
      /^\(Loss\)\s*\/?\s*profit\s+for\s+the\s+(?:financial\s+)?(?:year|period)\b/i,
      /^Profit\s+attributable\s+to\s+(?:the\s+)?owners\b/i,
      /^Net\s+profit\s+attributable\s+to\b/i,
    ],
  },
  {
    key: 'eps',
    patterns: [
      /^Basic\s+and\s+diluted\s+EPS\b/i,
      // The label frequently wraps, leaving the data row as "Basic and diluted <numbers>".
      /^Basic\s+and\s+diluted\s+[\d(.]/i,
      /^Basic\s*\/?\s*diluted\s+EPS\b/i,
      /^EPS\s*(?:\(sen\))?\s+[\d(.]/i,
      /^Basic\s+EPS\b/i,
      /^Earnings\s+per\s+[Ss]hare\b/i,
    ],
  },
];

const RATIO_ROWS: RowSpec[] = [
  {
    key: 'receivablesDays',
    patterns: [
      /^Trade\s+receivables\s+turnover\b/i,
      /^Trade\s+receivable(?:s)?\s+(?:turnover\s+)?(?:period|days)\b/i,
      /^(?:Average\s+)?(?:trade\s+)?(?:debtors|receivables)\s+(?:turnover|collection|days)\b/i,
      /^Debtor(?:s)?\s+(?:turnover\s+)?days\b/i,
    ],
  },
  { key: 'currentRatio', patterns: [/^Current\s+ratio\b/i] },
  {
    // Prefer net gearing where reported (it nets off cash), else gross/total.
    key: 'gearing',
    patterns: [
      /^Net\s+gearing(?:\s+ratio)?\b/i,
      /^Gross\s+gearing(?:\s+ratio)?\b/i,
      /^Gearing\s+ratio\b/i,
      /^Gearing\b/i,
      /^(?:Total\s+)?[Dd]ebt[\s-]*to[\s-]*equity(?:\s+ratio)?\b/i,
    ],
  },
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
  // Anchor on the Revenue/Turnover row: it is present in every profit-or-loss
  // highlights table and its number count tells us how many period columns the
  // table has, without depending on the header being on a single line.
  const revenueHits = findAllLines(idx, /^(Revenue|Turnover)\b/i).filter((hit) => {
    const nums = rowNumbers(stripLabelNoise(hit.line));
    return nums.length >= 2 && nums.length <= 8 && nums.every((n) => n === null || n > 1);
  });

  let best: { periods: FinancialPeriod[]; score: number } | null = null;

  for (const revHit of revenueHits) {
    const revNums = rowNumbers(stripLabelNoise(revHit.line));
    const columns = revNums.length;

    // Reconstruct period labels from the up-to-6 header lines above Revenue.
    const headerLines: string[] = [];
    for (let i = Math.max(0, revHit.index - 6); i < revHit.index; i++) {
      headerLines.push(idx.lines[i]);
    }
    const headerRegion = headerLines.join(' ');

    // A genuine profit-or-loss highlights table has period columns (FYE/FPE or
    // a run of years) in its header. Segmental/geographic breakdowns instead
    // have category columns and a "Cost of sales" line whose columns sum to the
    // last column — reject those so we don't parse a by-product revenue split
    // as if it were the historical track record.
    const labels = buildPeriodLabels(headerLines, columns);
    const headerHasPeriods =
      /\b(FYE|FPE)\b/i.test(headerRegion) ||
      (headerRegion.match(/\b(19|20)\d{2}\b/g) ?? []).length >= columns;
    if (!labels || !headerHasPeriods) continue;

    const periods = labels.map((l) => emptyPeriod(l.replace(/\s+/g, ' ')));
    let score = 0;

    // Walk the rows of this table (Revenue downward) until it clearly ends.
    for (let i = revHit.index; i < Math.min(revHit.index + 26, idx.lines.length); i++) {
      const line = idx.lines[i];
      if (i !== revHit.index) {
        if (/^(Notes?:|Section\b|\d+\.\d)/i.test(line)) break;
        // A fresh period header signals the next table.
        if (/\b(FYE|FPE)\b/i.test(line) && rowNumbers(stripLabelNoise(line)).length === 0) break;
      }

      for (const spec of [...FINANCIAL_ROWS, ...RATIO_ROWS]) {
        if (!spec.patterns.some((p) => p.test(line))) continue;
        const nums = rowNumbers(stripLabelNoise(line));
        if (nums.length < columns) continue;
        // Values align to the right-most N columns (leading tokens may be note refs).
        const values = nums.slice(nums.length - columns);
        let filled = 0;
        values.forEach((v, c) => {
          if (v !== null) filled++;
          (periods[c] as unknown as Record<string, number | null>)[spec.key as string] = v;
        });
        if (filled > 0) score += 1;
        // A bottom-line profit row (PBT/PAT) strongly identifies the real
        // profit-or-loss table over a segmental revenue breakdown, which
        // reports only revenue/GP by segment. Weight it heavily.
        if ((spec.key === 'pat' || spec.key === 'pbt') && filled > 0) score += 5;
        break;
      }
    }

    if (score > 0 && (best === null || score > best.score)) best = { periods, score };
  }

  if (!best) return [];

  // Merge in per-period ratios, margins, EPS and dividends from their own
  // rows. The winning table may not contain every derived row within its
  // window (a page break can separate margins from the P&L), so we fill any
  // gaps from the canonical single rows elsewhere in the document.
  mergeRowByLabel(idx, best.periods, 'gpMargin', [/^GP\s+margin\b/i, /^Gross\s+profit\s+margin\b/i]);
  mergeRowByLabel(idx, best.periods, 'patMargin', [
    /^PAT\s+margin\b/i,
    /^PATAMI\s+margin\b/i,
    /^PATMI\s+margin\b/i,
    /^Net\s+profit\s+margin\b/i,
    /^Net\s+margin\b/i,
  ]);
  mergeRatioTables(idx, best.periods);
  mergeEps(idx, best.periods);
  mergeDividends(idx, best.periods);

  return best.periods;
}

/**
 * Fills a single financial row (by label) from anywhere in the document when
 * the chosen P&L table did not already capture it.
 *
 * Column count may legitimately differ from the number of P&L periods: a
 * balance-sheet or ratio table often omits the earliest interim comparative
 * (e.g. 4 balance-sheet dates against 5 P&L periods). When a row has fewer
 * numbers than periods, we align by matching the row's own header years to
 * each period's year, falling back to right-alignment if no header is found.
 */
function mergeRowByLabel(
  idx: DocIndex,
  periods: FinancialPeriod[],
  key: keyof FinancialPeriod,
  patterns: RegExp[],
) {
  if (periods.some((p) => p[key] !== null)) return;
  for (const pattern of patterns) {
    for (const hit of findAllLines(idx, pattern)) {
      const nums = rowNumbers(stripLabelNoise(hit.line));
      if (nums.length === 0 || nums.length > periods.length) continue;

      if (nums.length === periods.length) {
        let filled = false;
        nums.forEach((v, c) => {
          if (v !== null) filled = true;
          (periods[c] as unknown as Record<string, number | null>)[key as string] = v;
        });
        if (filled) return;
        continue;
      }

      const headerYears = columnYearsAbove(idx, hit.index, nums.length);
      const targets = mapValuesToPeriods(periods, nums, headerYears);
      if (targets) {
        let filled = false;
        targets.forEach(({ periodIndex, value }) => {
          if (value !== null) filled = true;
          (periods[periodIndex] as unknown as Record<string, number | null>)[key as string] = value;
        });
        if (filled) return;
      }
    }
  }
}

/**
 * Scans upward for the nearest date-header line carrying a run of year tokens
 * (the table's column header), returning the trailing `count` years or null.
 * Balance-sheet tables often place several data rows between the header and a
 * ratio row, so the search window is generous (~30 lines).
 */
function columnYearsAbove(idx: DocIndex, rowIndex: number, count: number): number[] | null {
  for (let i = rowIndex - 1; i >= Math.max(0, rowIndex - 30); i--) {
    const combined = `${idx.lines[i]} ${idx.lines[i + 1] ?? ''}`;
    const years = combined.match(/\b(19|20)\d{2}\b/g);
    if (years && years.length >= count) {
      // Only accept genuine year headers, not data rows that happen to contain
      // a 4-digit number: nearly all large numbers on the line must be years.
      const bigNums = combined.match(/\b\d{4,}\b/g) ?? [];
      const yearLike = bigNums.filter((n) => /^(19|20)\d{2}$/.test(n)).length;
      if (yearLike >= bigNums.length - 1) {
        return years.slice(years.length - count).map(Number);
      }
    }
  }
  return null;
}

/**
 * Maps a short row of values to P&L periods by year. A balance-sheet "as at"
 * date for a full year maps to that full financial year (FYE); only when the
 * sole period for a year is an interim (FPE) does it map there. Falls back to
 * right-alignment when the header years cannot be read; returns null if a year
 * matches no period (so the caller skips rather than mis-assigns).
 */
function mapValuesToPeriods(
  periods: FinancialPeriod[],
  values: (number | null)[],
  headerYears: number[] | null,
): { periodIndex: number; value: number | null }[] | null {
  if (!headerYears || headerYears.length !== values.length) {
    const offset = periods.length - values.length;
    return values.map((value, c) => ({ periodIndex: offset + c, value }));
  }
  const out: { periodIndex: number; value: number | null }[] = [];
  const used = new Set<number>();
  for (let c = 0; c < values.length; c++) {
    const year = headerYears[c];
    const candidates = periods
      .map((p, i) => ({ i, year: p.year, isStub: p.isStub }))
      .filter((p) => p.year === year && !used.has(p.i));
    if (candidates.length === 0) return null;
    const full = candidates.find((p) => !p.isStub);
    const chosen = (full ?? candidates[candidates.length - 1]).i;
    used.add(chosen);
    out.push({ periodIndex: chosen, value: values[c] });
  }
  return out;
}

/**
 * EPS is often tabulated separately from the P&L highlights (e.g. in the
 * "basis of the IPO price" section). Fill it in if the main pass missed it.
 */
function mergeEps(idx: DocIndex, periods: FinancialPeriod[]) {
  if (periods.some((p) => p.eps !== null)) return;
  const hits = findAllLines(idx, /^Basic\s+and\s+diluted\s+(?:EPS\s+)?(?:\(sen\)\s+)?[\d(.-]/i);
  for (const hit of hits) {
    const nums = rowNumbers(stripLabelNoise(hit.line));
    if (nums.length < periods.length) continue;
    const values = nums.slice(nums.length - periods.length);
    // EPS in sen is a small number; guard against grabbing a share-count row.
    if (!values.every((v) => v === null || Math.abs(v) < 1000)) continue;
    values.forEach((v, c) => {
      periods[c].eps = v;
    });
    return;
  }
}

/** Removes footnote markers and units that would be mistaken for data. */
function stripLabelNoise(line: string): string {
  return line
    .replace(/\((\d)\)/g, ' ')           // footnote refs (1) (2)
    .replace(/\(sen\)|\(days\)|\(times\)|\(%\)|\(RM'000\)|\(RM\)/gi, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Reuses the right-aligned / year-matched single-row merge for ratio rows,
 * which frequently sit in a separate balance-sheet table with one fewer column
 * than the P&L.
 */
function mergeRatioTables(idx: DocIndex, periods: FinancialPeriod[]) {
  for (const spec of RATIO_ROWS) {
    if (periods.some((p) => p[spec.key] !== null)) continue;
    mergeRowByLabel(idx, periods, spec.key, spec.patterns);
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
    // "we have an unbilled order book amounting to RM50.43 million" (Pioneer)
    /(?:unbilled\s+)?order\s+book\s+(?:of\s+|amounting\s+to\s+)(?:approximately\s+)?RM\s?([\d.,]+)\s*(billion|million)?/i,
    /unbilled\s+(?:contract\s+value|order\s+book)\s+amounting\s+to\s+(?:approximately\s+)?RM\s?([\d.,]+)\s*(billion|million)?/i,
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
    /total\s+workforce\s+of\s+(?:over\s+|approximately\s+)?([\d,]{2,7})\s+(?:permanent\s+|full[-\s]time\s+)?employees/i,
    /(?:we|our\s+Group)\s+ha(?:d|s|ve)\s+(?:a\s+total\s+(?:of|workforce\s+of)\s+)?([\d,]{2,7})\s+(?:permanent\s+)?employees/i,
    /total\s+(?:of\s+)?([\d,]{2,7})\s+employees\s+as\s+at/i,
    /workforce\s+of\s+(?:over\s+|approximately\s+)?([\d,]{2,7})\s+employees/i,
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

  // Formal policies are phrased several ways, e.g.
  //   "We target a payout ratio of approximately 50% of our PAT ..."
  //   "dividend policy of up to 30% of our profit after tax ..."
  const targetPatterns: RegExp[] = [
    /(?:target|targeting)\s+a\s+(?:dividend\s+)?payout\s+ratio\s+of\s+(?:approximately\s+|up\s+to\s+|at\s+least\s+)?([\d.]+)%/i,
    /dividend\s+policy[^.]{0,120}?(?:of\s+|to\s+distribute\s+)(?:up\s+to\s+|at\s+least\s+)?([\d.]+)%/i,
    /payout\s+ratio\s+of\s+(?:approximately\s+|up\s+to\s+|at\s+least\s+)?([\d.]+)%\s+of\s+(?:our\s+)?(?:PAT|profit)/i,
  ];
  for (const re of targetPatterns) {
    const target = findProse(idx, re);
    if (target) {
      return {
        text: field(`Target payout: ~${target.match[1]}% of profit`, {
          page: target.page,
          raw: target.match[0],
        }),
        formal: field(true, { page: target.page }),
      };
    }
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

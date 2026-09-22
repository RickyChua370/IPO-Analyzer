/**
 * Renders the real components with real prospectus data and asserts the
 * output. Verifies the whole pipeline end to end — PDF text → parser →
 * analyser → React markup — without needing a browser.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { Dashboard } from '../src/components/Dashboard.tsx';
import { Compare } from '../src/components/Compare.tsx';
import { parseProspectus } from '../src/lib/parser.ts';
import { analyse } from '../src/lib/analyzer.ts';
import { applyEdit } from '../src/lib/edit.ts';
import { GLOSSARY } from '../src/lib/glossary.ts';
import type { SavedAnalysis } from '../src/lib/types.ts';

const fixture = JSON.parse(readFileSync('fixtures/slgc-pages.json', 'utf8')) as {
  files: string[];
  pages: string[];
};

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
}

const parsed = parseProspectus(fixture.pages, fixture.files);
const analysis = { parsed, metrics: analyse(parsed, new Date('2026-09-21')) };

// --- Dashboard renders -----------------------------------------------------
let html = '';
try {
  html = renderToStaticMarkup(
    <Dashboard analysis={analysis} onEdit={() => {}} onSave={() => {}} saved={false} />,
  );
  check('Dashboard renders without throwing', html.length > 3000, `${html.length} chars`);
} catch (err) {
  check('Dashboard renders without throwing', false, String(err));
}

// --- Headline values appear in the output ----------------------------------
const expectInHtml: [string, string][] = [
  ['company name', 'SLGC Berhad'],
  ['listing board', 'ACE Market'],
  ['IPO price', 'RM0.28'],
  ['market cap', 'RM156.80m'],
  ['PE multiple', '11.2×'],
  ['price-to-book', '2.8×'],
  ['order book', 'RM1.00bn'],
  ['revenue visibility', '3.1 yrs'],
  ['revenue FYE2025', '324,004'],
  ['PAT FYE2025', '13,985'],
  ['gearing before', '3.28×'],
  ['gearing after', '1.67×'],
  ['concentration', '78.1%'],
  ['founder stake', '59.6%'],
  ['vendor cash-out', '37.5%'],
  ['proceeds to growth', '33.1%'],
  ['retail ballot', '5.00%'],
  ['dilution', '64.3%'],
  ['sector', 'Construction &amp; Engineering'],
  ['proceeds line item', 'Repayment of bank borrowings'],
  ['director', 'Adnan Bin Zainol'],
  ['management', 'Oh Kim Siong'],
  ['moratorium', '6 months full lock-up'],
  ['dividend policy', 'No formal dividend policy'],
  ['stub marker', 'part-year'],
  ['countdown', 'Closes tomorrow'],
  ['disclaimer', 'not investment advice'],
  ['audit panel', 'Extraction audit'],
];
for (const [name, needle] of expectInHtml) {
  check(`renders ${name}`, html.includes(needle), `missing "${needle}"`);
}

// --- Glossary wiring -------------------------------------------------------
// Every glossaryKey referenced by a flag must exist, or hovering shows nothing.
const flagKeys = analysis.metrics.flags.map((f) => f.glossaryKey).filter(Boolean) as string[];
const missingKeys = flagKeys.filter((k) => !(k in GLOSSARY));
check('all flag glossary keys exist', missingKeys.length === 0, missingKeys.join(', '));

// Glossary terms must be reachable in the markup (aria-label carries the text).
check('glossary tooltips are wired', html.includes('Gearing Ratio:'), 'no gearing aria-label');
check(
  'glossary explains in plain terms',
  GLOSSARY.gearing.plain.includes('borrowed RM3 for every RM1'),
);

// Quality bar: every entry needs all required prose fields.
const badEntries = Object.entries(GLOSSARY).filter(
  ([, e]) => !e.term || e.short.length < 10 || e.plain.length < 60 || e.whyItMatters.length < 40,
);
check('every glossary entry is complete', badEntries.length === 0, badEntries.map(([k]) => k).join(', '));
console.log(`      glossary entries: ${Object.keys(GLOSSARY).length}`);

// --- Editing recomputes derived metrics ------------------------------------
const edited = applyEdit(parsed, 'ipoPrice', 0.56);
const editedMetrics = analyse(edited);
check(
  'editing IPO price recomputes price-to-book',
  Math.abs((editedMetrics.priceToBook ?? 0) - 5.6) < 0.01,
  `got ${editedMetrics.priceToBook}`,
);
check('edited field is marked', edited.ipoPrice.edited === true);

const editedRev = applyEdit(parsed, 'periods.3.revenue', 400000);
const revMetrics = analyse(editedRev);
check(
  'editing revenue recomputes order-book coverage',
  Math.abs((revMetrics.orderBookCoverage ?? 0) - 2.5) < 0.01,
  `got ${revMetrics.orderBookCoverage}`,
);

// --- Flag thresholds behave ------------------------------------------------
const lowGearing = applyEdit(parsed, 'orderBook', 100_000_000);
const lowMetrics = analyse(lowGearing);
const obFlag = lowMetrics.flags.find((f) => f.id === 'orderBook');
check('low order book flips flag to concern', obFlag?.level === 'concern', obFlag?.level);

// --- Compare view renders --------------------------------------------------
const savedEntry: SavedAnalysis = {
  id: '1',
  companyName: parsed.companyName.value ?? 'X',
  savedAt: new Date().toISOString(),
  parsed,
};
try {
  const cmp = renderToStaticMarkup(
    <Compare saved={[savedEntry, savedEntry]} onRemove={() => {}} onClear={() => {}} />,
  );
  check('Compare renders with saved entries', cmp.includes('SLGC Berhad') && cmp.length > 1000);
  const empty = renderToStaticMarkup(
    <Compare saved={[]} onRemove={() => {}} onClear={() => {}} />,
  );
  check('Compare renders empty state', empty.includes('Nothing saved yet'));
} catch (err) {
  check('Compare renders', false, String(err));
}

// --- Missing-value handling ------------------------------------------------
// A wiped field must render a dash or an "add" affordance, never "null"/"NaN".
const wiped = applyEdit(applyEdit(parsed, 'orderBook', null), 'peMultiple', null);
const wipedHtml = renderToStaticMarkup(
  <Dashboard
    analysis={{ parsed: wiped, metrics: analyse(wiped) }}
    onEdit={() => {}}
    onSave={() => {}}
    saved={false}
  />,
);
check('no "null" leaks into markup', !/>null</.test(wipedHtml));
check('no "NaN" leaks into markup', !wipedHtml.includes('NaN'));
check('no "undefined" leaks into markup', !wipedHtml.includes('undefined'));
check('missing values offer an add control', wipedHtml.includes('editable--missing'));
check('missing values reported in audit', wipedHtml.includes('Not found'));

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail > 0 ? 1 : 0);

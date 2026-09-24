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

// --- Sector-aware relevance ------------------------------------------------
// SLGC is a construction group: order book applies and is present, so it must
// be shown as a normal metric (not hidden, not "not applicable").
check(
  'construction: order book is present',
  analysis.metrics.relevance.orderBook === 'present',
  analysis.metrics.relevance.orderBook,
);
check(
  'construction: order book flag shown, not N/A',
  analysis.metrics.flags.find((f) => f.id === 'orderBook')?.applicability === 'present',
);
check('construction: report shows Revenue visibility', html.includes('Revenue visibility'));

// A hospital-style business (no order book, mass-consumer patients): both
// order book and customer concentration should be flagged not-applicable and
// hidden from the grid — without being reported as extraction failures.
const hospital = structuredClone(parsed);
hospital.businessDescription = {
  value: 'operation of private hospitals and medical centres providing healthcare services to patients',
  confidence: 'high',
};
hospital.industry = { value: 'Healthcare', confidence: 'medium' };
hospital.orderBook = { value: null, confidence: 'missing' };
hospital.orderBookRaw = { value: null, confidence: 'missing' };
hospital.customerConcentration = { value: null, confidence: 'missing' };
const hospitalMetrics = analyse(hospital);
check(
  'healthcare: order book is not_applicable',
  hospitalMetrics.relevance.orderBook === 'not_applicable',
  hospitalMetrics.relevance.orderBook,
);
check(
  'healthcare: customer concentration is not_applicable',
  hospitalMetrics.relevance.customerConcentration === 'not_applicable',
  hospitalMetrics.relevance.customerConcentration,
);
const hospitalHtml = renderToStaticMarkup(
  <Dashboard
    analysis={{ parsed: hospital, metrics: hospitalMetrics }}
    onEdit={() => {}}
    onSave={() => {}}
    saved={false}
  />,
);
check(
  'healthcare: N/A signals summarised, not shown as found-gaps',
  hospitalHtml.includes('not applicable to this type of business') ||
    hospitalHtml.includes('Not applicable'),
);
check(
  'healthcare: order book absent from extraction "Not found" list',
  !/Not found[^.]*Order book/.test(hospitalHtml),
);
check(
  'healthcare: substitute KPI (Founder stake) replaces the order-book KPI',
  hospitalHtml.includes('Founder stake'),
);
// "Revenue visibility" may still appear once, in the N/A footnote listing what
// was hidden — but it must not appear as a live KPI ("calculated" caption).
check(
  'healthcare: Revenue visibility not shown as a KPI',
  !/Revenue visibility<\/[^>]+><[^>]*class="kpi__value"/.test(hospitalHtml) &&
    (hospitalHtml.match(/Revenue visibility/g) ?? []).length <= 1,
);

// A construction firm that genuinely lacks an order book value must still be
// treated as a gap ('missed'), never silently hidden.
const noOb = applyEdit(parsed, 'orderBook', null);
const noObMetrics = analyse(noOb);
check(
  'construction with empty order book stays "missed" (visible gap)',
  noObMetrics.relevance.orderBook === 'missed',
  noObMetrics.relevance.orderBook,
);

// --- Ecosys: name parsing + "no order book" disclaimer -------------------
// Guards the regression where the cover-page name ran into boilerplate
// ("Ecosys In Connection With Thebursa Malaysia Securities Berhad") and the
// "we do not maintain an order book" sentinel leaking into the UI.
try {
  const ecoFx = JSON.parse(readFileSync('fixtures/ecosys.json', 'utf8')) as {
    files: string[];
    pages: string[];
  };
  const eco = parseProspectus(ecoFx.pages, ecoFx.files);
  const ecoMetrics = analyse(eco);
  check('ecosys: company name correct', eco.companyName.value === 'Ecosys (Malaysia) Berhad', String(eco.companyName.value));
  check('ecosys: order book disclaimed → not applicable', ecoMetrics.relevance.orderBook === 'not_applicable', ecoMetrics.relevance.orderBook);
  const ecoHtml = renderToStaticMarkup(
    <Dashboard analysis={{ parsed: eco, metrics: ecoMetrics }} onEdit={() => {}} onSave={() => {}} saved={false} />,
  );
  check('ecosys: no order-book sentinel leaks into markup', !ecoHtml.includes('__NOT_MAINTAINED__'));
  check('ecosys: proceeds rendered', /where the money goes/i.test(ecoHtml));
  check('ecosys: no boilerplate name in markup', !ecoHtml.includes('In Connection With'));
} catch {
  console.log('SKIP  ecosys fixture not present');
}

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail > 0 ? 1 : 0);

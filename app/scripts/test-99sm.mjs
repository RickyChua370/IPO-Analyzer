/**
 * Regression fixture for 99 Speed Mart Retail Holdings Berhad — a Main Market
 * retail IPO whose prospectus layout differs from SLGC's (split period header,
 * proceeds in RM million with timeframe in a different column, formal dividend
 * policy). Expected values hand-verified against the source PDFs.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProspectus } from '../src/lib/parser.ts';
import { analyse } from '../src/lib/analyzer.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '..', 'fixtures', '99sm-pages.json');

let fixture;
try {
  fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
} catch {
  // The 99SM PDFs are large third-party documents not committed to the repo,
  // so this fixture may be absent (e.g. in CI). Skip rather than fail; the
  // SLGC fixture provides the committed regression baseline.
  console.log('SKIP  99sm-pages.json not found — run `npm run fixture:99sm` locally to enable.');
  process.exit(0);
}

const parsed = parseProspectus(fixture.pages, fixture.files);
const metrics = analyse(parsed);

const EXPECTED = {
  'companyName.value': '99 Speed Mart Retail Holdings Berhad',
  'listingBoard.value': 'Main Market',
  'prospectusDate.value': '15 August 2024',
  'ipoPrice.value': 1.65,
  'hasFormalDividendPolicy.value': true,
  'enlargedShares.value': 8400000000,
  'publicIssueShares.value': 400000000,
  'offerForSaleShares.value': 1028000000,
  'employees.value': 22000,
};

function get(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

let pass = 0;
let fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(name).padEnd(30)} got=${JSON.stringify(got)}${ok ? '' : `  want=${JSON.stringify(want)}`}`);
}

console.log('--- Field extraction ---');
for (const [path, want] of Object.entries(EXPECTED)) check(path, get(parsed, path), want);

console.log('\n--- Financial periods ---');
console.log(['period', 'revenue', 'GP', 'PBT', 'PAT', 'GP%', 'PAT%', 'EPS'].map((h) => String(h).padStart(10)).join(''));
for (const p of parsed.periods) {
  console.log(
    [p.label + (p.isStub ? '*' : ''), p.revenue, p.grossProfit, p.pbt, p.pat, p.gpMargin, p.patMargin, p.eps]
      .map((v) => String(v ?? '-').padStart(10))
      .join(''),
  );
}
// Column 3 is the last full year (FYE 2023); columns 4-5 are FPE (interim +
// prior-year comparative). Match the full-year FYE 2023, not the FPE 2023.
const fye2023 = parsed.periods.find((p) => p.label === 'FYE 2023' && !p.isStub);
check('period count', parsed.periods.length, 5);
check('FYE2023 revenue', fye2023?.revenue, 9210505);
check('FYE2023 GP', fye2023?.grossProfit, 841447);
check('FYE2023 PAT', fye2023?.pat, 400227);
check('FYE2023 PAT margin', fye2023?.patMargin, 4.3);
const stubCount = parsed.periods.filter((p) => p.isStub).length;
check('two stub (FPE) periods', stubCount, 2);

console.log('\n--- Use of proceeds (normalised to RM\u2019000) ---');
for (const u of parsed.proceedsUses) {
  console.log(`  ${String(u.category).padEnd(16)} ${u.label.padEnd(46)} ${String(u.amount).padStart(10)} ${String(u.pct).padStart(6)}%  ${u.timeframe ?? ''}`);
}
check('proceeds line items', parsed.proceedsUses.length, 6);
check('proceeds total (RM\u2019000)', parsed.proceedsTotal.value, 660000);
const expansion = parsed.proceedsUses.find((u) => /Expansion of network/i.test(u.label));
check('expansion amount (RM\u2019000)', expansion?.amount, 389000);
check('expansion classified growth', expansion?.category, 'growth');

console.log('\n--- Derived ---');
for (const [k, v] of Object.entries({
  revenueCagr: metrics.revenueCagr,
  patGrowthLatest: metrics.patGrowthLatest,
  proceedsToGrowthPct: metrics.proceedsToGrowthPct,
  proceedsToDebtPct: metrics.proceedsToDebtPct,
  marginTrend: metrics.marginTrend,
})) {
  console.log(`  ${k.padEnd(22)} ${typeof v === 'number' ? v.toFixed(2) : v}`);
}

console.log('\n--- Other ---');
console.log('  dividend:', parsed.dividendPolicy.value, '| formal:', parsed.hasFormalDividendPolicy.value);
console.log('  proceeds total field:', JSON.stringify(parsed.proceedsTotal));

const fields = Object.entries(parsed).filter(([, v]) => v && typeof v === 'object' && 'confidence' in v);
const found = fields.filter(([, v]) => v.value !== null).length;
console.log(`\n--- Coverage: ${found}/${fields.length} headline fields ---`);
console.log(`  missing: ${fields.filter(([, v]) => v.value === null).map(([k]) => k).join(', ')}`);

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail > 0 ? 1 : 0);

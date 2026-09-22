/**
 * Validates the parser against the real SLGC prospectus.
 *
 * Expected values were verified by hand against the source PDFs, so this acts
 * as a regression fixture: if a parser change breaks extraction, it shows here.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProspectus } from '../src/lib/parser.ts';
import { analyse } from '../src/lib/analyzer.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'slgc-pages.json'), 'utf8'),
);

const parsed = parseProspectus(fixture.pages, fixture.files);
const metrics = analyse(parsed);

// Ground truth, hand-verified from the prospectus.
const EXPECTED = {
  'companyName.value': 'SLGC Berhad',
  'listingBoard.value': 'ACE Market',
  'prospectusDate.value': '10 September 2026',
  'ipoPrice.value': 0.28,
  'marketCap.value': 156800000,
  'enlargedShares.value': 560000000,
  'peMultiple.value': 11.2,
  'dilutionPct.value': 64.29,
  'publicIssueShares.value': 105000000,
  'publicIssueGrossRM.value': 29400000,
  'offerForSaleShares.value': 63000000,
  'offerForSaleGrossRM.value': 17640000,
  'proceedsTotal.value': 29400,
  'openDate.value': '10 September 2026',
  'closeDate.value': '22 September 2026',
  'listingDate.value': '6 October 2026',
  'orderBook.value': 1000000000,
  'naPerShareAfter.value': 0.1,
};

function get(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

let pass = 0;
let fail = 0;
console.log('\n--- Field extraction ---');
for (const [path, want] of Object.entries(EXPECTED)) {
  const got = get(parsed, path);
  const ok = got === want;
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${path.padEnd(28)} got=${JSON.stringify(got)}${ok ? '' : `  want=${JSON.stringify(want)}`}`);
}

console.log('\n--- Financial periods ---');
if (parsed.periods.length === 0) {
  console.log('FAIL  no periods parsed');
  fail++;
} else {
  console.log(
    ['period', 'revenue', 'GP', 'PBT', 'PAT', 'EPS', 'GP%', 'PAT%', 'gear', 'curr', 'days', 'div']
      .map((h) => String(h).padStart(9))
      .join(''),
  );
  for (const p of parsed.periods) {
    console.log(
      [
        p.label + (p.isStub ? '*' : ''),
        p.revenue, p.grossProfit, p.pbt, p.pat, p.eps,
        p.gpMargin, p.patMargin, p.gearing, p.currentRatio,
        p.receivablesDays, p.dividends,
      ].map((v) => String(v ?? '-').padStart(9)).join(''),
    );
  }
  const fy25 = parsed.periods.find((p) => p.label === 'FYE 2025');
  const checks = [
    ['FYE2025 revenue', fy25?.revenue, 324004],
    ['FYE2025 PAT', fy25?.pat, 13985],
    ['FYE2025 EPS', fy25?.eps, 2.5],
    ['FYE2025 gearing', fy25?.gearing, 3.43],
    ['period count', parsed.periods.length, 5],
  ];
  for (const [name, got, want] of checks) {
    const ok = got === want;
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(name).padEnd(20)} got=${got}${ok ? '' : ` want=${want}`}`);
  }
}

console.log('\n--- Allocations ---');
for (const a of parsed.allocations) {
  console.log(`  [${a.tranche}] ${a.label.padEnd(50)} ${String(a.shares).padStart(12)} ${String(a.pctOfCapital).padStart(6)}%${a.isRetailBallot ? '  <RETAIL BALLOT>' : ''}`);
}

console.log('\n--- Use of proceeds ---');
for (const u of parsed.proceedsUses) {
  console.log(`  ${String(u.category).padEnd(16)} ${u.label.padEnd(50)} ${String(u.amount).padStart(8)} ${String(u.pct).padStart(6)}%  ${u.timeframe}`);
}

console.log('\n--- Pro forma ---');
for (const s of parsed.proForma) {
  console.log(`  ${s.label.padEnd(32)} NA/share=${String(s.naPerShare).padStart(6)} gearing=${String(s.gearing).padStart(6)} borrowings=${String(s.borrowings).padStart(8)} equity=${String(s.totalEquity).padStart(8)}`);
}

console.log('\n--- People ---');
console.log('  Directors:', parsed.directors.map((d) => `${d.name} (${d.role})`).join('; ') || '(none)');
console.log('  Management:', parsed.management.map((d) => `${d.name} (${d.role})`).join('; ') || '(none)');

console.log('\n--- Shareholders ---');
for (const s of parsed.shareholders) {
  console.log(`  ${s.name.padEnd(24)} before=${String(s.beforePct).padStart(6)}%  after=${String(s.afterPct).padStart(6)}%`);
}

console.log('\n--- Other ---');
console.log('  employees:', parsed.employees.value);
console.log('  concentration:', JSON.stringify(parsed.customerConcentration.value));
console.log('  moratorium:', parsed.moratorium.value);
console.log('  dividend:', parsed.dividendPolicy.value, '| formal:', parsed.hasFormalDividendPolicy.value);
console.log('  risks:', parsed.riskFactors.length);
parsed.riskFactors.forEach((r) => console.log(`    - ${r.slice(0, 95)}`));

console.log('\n--- Derived metrics ---');
const show = {
  revenueCagr: metrics.revenueCagr,
  patCagr: metrics.patCagr,
  revenueGrowthLatest: metrics.revenueGrowthLatest,
  marginTrend: metrics.marginTrend,
  gpMarginChange: metrics.gpMarginChange,
  orderBookCoverage: metrics.orderBookCoverage,
  priceToBook: metrics.priceToBook,
  proceedsToGrowthPct: metrics.proceedsToGrowthPct,
  proceedsToDebtPct: metrics.proceedsToDebtPct,
  vendorCashOutPct: metrics.vendorCashOutPct,
  newMoneyPct: metrics.newMoneyPct,
  totalIpoValueRM: metrics.totalIpoValueRM,
  retailBallotPct: metrics.retailBallotPct,
  gearingBefore: metrics.gearingBefore,
  gearingAfter: metrics.gearingAfter,
  latestCurrentRatio: metrics.latestCurrentRatio,
  topCustomerConcentration: metrics.topCustomerConcentration,
  founderRetainedPct: metrics.founderRetainedPct,
  independentDirectorRatio: metrics.independentDirectorRatio,
};
for (const [k, v] of Object.entries(show)) {
  console.log(`  ${k.padEnd(24)} ${typeof v === 'number' ? v.toFixed(2) : v}`);
}

console.log('\n--- Flags ---');
for (const f of metrics.flags) {
  const icon = { good: 'GOOD   ', watch: 'WATCH  ', concern: 'CONCERN', unknown: 'UNKNOWN' }[f.level];
  console.log(`  ${icon} ${f.label.padEnd(26)} ${String(f.display).padEnd(18)} ${f.rule}`);
}

// Coverage report: how many top-level fields were found.
const fields = Object.entries(parsed).filter(
  ([, v]) => v && typeof v === 'object' && 'confidence' in v,
);
const found = fields.filter(([, v]) => v.value !== null).length;
console.log(`\n--- Coverage ---`);
console.log(`  scalar fields found: ${found}/${fields.length}`);
const missingFields = fields.filter(([, v]) => v.value === null).map(([k]) => k);
if (missingFields.length) console.log(`  missing: ${missingFields.join(', ')}`);

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail > 0 ? 1 : 0);

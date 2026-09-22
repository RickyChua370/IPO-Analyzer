/**
 * Regression fixture for Sunway Healthcare Holdings Berhad — a large-cap Main
 * Market healthcare IPO. Its prospectus uses IFRS-style labels ("Profit for
 * the financial year", "PATAMI"), a P&L with 5 period columns but a balance
 * sheet with 4, and gross/net gearing rows with a "*" (<0.1) marker.
 * Expected values hand-verified against the source PDF.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProspectus } from '../src/lib/parser.ts';
import { analyse } from '../src/lib/analyzer.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '..', 'fixtures', 'sunmed-pages.json');

let fixture;
try {
  fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
} catch {
  console.log('SKIP  sunmed-pages.json not found — run `npm run fixture:sunmed` locally.');
  process.exit(0);
}

const parsed = parseProspectus(fixture.pages, fixture.files);
const metrics = analyse(parsed);

let pass = 0;
let fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(name).padEnd(26)} got=${JSON.stringify(got)}${ok ? '' : `  want=${JSON.stringify(want)}`}`);
}

console.log('--- Field extraction ---');
check('companyName', parsed.companyName.value, 'Sunway Healthcare Holdings Berhad');
check('listingBoard', parsed.listingBoard.value, 'Main Market');
check('sector', parsed.industry.value, 'Healthcare');
check('ipoPrice', parsed.ipoPrice.value, 1.45);
check('marketCap', parsed.marketCap.value, 16700000000);
check('listingDate', parsed.listingDate.value, '18 March 2026');
check('closeDate', parsed.closeDate.value, '5 March 2026');

console.log('\n--- Use of proceeds (header "Description of use of proceeds") ---');
for (const u of parsed.proceedsUses) {
  console.log(`  ${String(u.category).padEnd(14)} ${u.label.slice(0, 44).padEnd(45)} ${String(u.amount).padStart(9)} ${String(u.pct).padStart(6)}%`);
}
check('proceeds line items', parsed.proceedsUses.length, 3);
check('proceeds total (RM’000)', parsed.proceedsTotal.value, 833762);
const capex = parsed.proceedsUses.find((u) => /Capital expenditure/i.test(u.label));
check('capex amount', capex?.amount, 554050);
check('capex classified growth', capex?.category, 'growth');
check('capex label absorbed wrap', /existing hospitals/i.test(capex?.label ?? ''), true);
const sukuk = parsed.proceedsUses.find((u) => /Sukuk/i.test(u.label));
check('sukuk redemption classified debt', sukuk?.category, 'debt');

console.log('\n--- Financial periods ---');
console.log(['period', 'revenue', 'GP', 'PBT', 'PAT', 'GP%', 'PAT%', 'EPS', 'gear', 'curr'].map((h) => String(h).padStart(10)).join(''));
for (const p of parsed.periods) {
  console.log(
    [p.label + (p.isStub ? '*' : ''), p.revenue, p.grossProfit, p.pbt, p.pat, p.gpMargin, p.patMargin, p.eps, p.gearing, p.currentRatio]
      .map((v) => String(v ?? '-').padStart(10)).join(''),
  );
}
const fy2024 = parsed.periods.find((p) => p.label === 'FYE 2024');
check('period count', parsed.periods.length, 5);
check('FYE2024 revenue', fy2024?.revenue, 1852462);
check('FYE2024 GP', fy2024?.grossProfit, 1184891);
check('FYE2024 PBT', fy2024?.pbt, 298849);
check('FYE2024 PAT (PATAMI)', fy2024?.pat, 257500);
check('FYE2024 GP margin', fy2024?.gpMargin, 64.0);
check('FYE2024 PAT margin', fy2024?.patMargin, 13.9);
check('FYE2024 EPS', fy2024?.eps, 23.80);
check('FYE2024 current ratio', fy2024?.currentRatio, 1.3);
check('FYE2024 gearing (net)', fy2024?.gearing, 0.1);
const stubCount = parsed.periods.filter((p) => p.isStub).length;
check('two stub (FPE) periods', stubCount, 2);

console.log('\n--- Derived ---');
for (const [k, v] of Object.entries({
  revenueCagr: metrics.revenueCagr,
  patCagr: metrics.patCagr,
  marginTrend: metrics.marginTrend,
  latestCurrentRatio: metrics.latestCurrentRatio,
})) {
  console.log(`  ${k.padEnd(20)} ${typeof v === 'number' ? v.toFixed(2) : v}`);
}

const fields = Object.entries(parsed).filter(([, v]) => v && typeof v === 'object' && 'confidence' in v);
const found = fields.filter(([, v]) => v.value !== null).length;
console.log(`\n--- Coverage: ${found}/${fields.length} headline fields ---`);
console.log(`  missing: ${fields.filter(([, v]) => v.value === null).map(([k]) => k).join(', ')}`);

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail > 0 ? 1 : 0);

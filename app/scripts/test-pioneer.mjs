/**
 * Regression fixture for Pioneer Heat Holdings Berhad — an ACE Market
 * mechanical & civil engineering IPO. Exposed a proceeds table headed
 * "Purposes | RM'000 | % | Listing date" with bare "24 months" / "1 month"
 * timeframes, and an order book phrased "we have an unbilled order book
 * amounting to RM50.43 million". Values hand-verified against the source PDFs.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProspectus } from '../src/lib/parser.ts';
import { analyse } from '../src/lib/analyzer.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
let fixture;
try {
  fixture = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'pioneer.json'), 'utf8'));
} catch {
  console.log('SKIP  pioneer.json not found — run `npm run fixture:pioneer` locally.');
  process.exit(0);
}

const parsed = parseProspectus(fixture.pages, fixture.files);
const metrics = analyse(parsed);
let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(name).padEnd(30)} got=${JSON.stringify(got)}${ok ? '' : `  want=${JSON.stringify(want)}`}`);
};

console.log('--- Field extraction ---');
check('companyName', parsed.companyName.value, 'Pioneer Heat Holdings Berhad');
check('listingBoard', parsed.listingBoard.value, 'ACE Market');
check('sector', parsed.industry.value, 'Construction & Engineering');
check('ipoPrice', parsed.ipoPrice.value, 1);

console.log('\n--- Financial periods ---');
console.log(['period', 'revenue', 'GP', 'PBT', 'PAT'].map((h) => String(h).padStart(10)).join(''));
for (const p of parsed.periods) {
  console.log([p.label, p.revenue, p.grossProfit, p.pbt, p.pat].map((v) => String(v ?? '-').padStart(10)).join(''));
}
const fy2026 = parsed.periods.find((p) => p.label === 'FYE 2026');
check('period count', parsed.periods.length, 4);
check('FYE2026 revenue', fy2026?.revenue, 97661);
check('FYE2026 PAT', fy2026?.pat, 8214);

console.log('\n--- Use of proceeds (header "Purposes RM’000 %", bare timeframes) ---');
for (const u of parsed.proceedsUses) {
  console.log(`  ${String(u.category).padEnd(15)} ${u.label.slice(0, 44).padEnd(45)} ${String(u.amount).padStart(6)} ${String(u.pct).padStart(6)}%  ${u.timeframe ?? ''}`);
}
check('proceeds line items', parsed.proceedsUses.length, 5);
check('proceeds total (RM’000)', parsed.proceedsTotal.value, 21675);
const machinery = parsed.proceedsUses.find((u) => /machinery/i.test(u.label));
check('machinery amount', machinery?.amount, 4005);
check('machinery classified growth', machinery?.category, 'growth');

console.log('\n--- Order book ("unbilled order book amounting to RM50.43 million") ---');
check('order book (RM)', parsed.orderBook.value, 50430000);
check('order book applies', metrics.relevance.orderBook, 'present');

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail > 0 ? 1 : 0);

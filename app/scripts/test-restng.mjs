/**
 * Regression fixture for RNG Tech Berhad (brand "Rest N Go") — an ACE Market
 * consumer-services IPO (vending massage chairs). Its prospectus exposed two
 * gaps: a proceeds table headed simply "Utilisation of proceeds" (no
 * "Description of" lead-in) with labels wrapping onto the following line, and a
 * business type (vending / rental services) that has no order book or customer
 * concentration. Expected values hand-verified against the source PDFs.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProspectus } from '../src/lib/parser.ts';
import { analyse } from '../src/lib/analyzer.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '..', 'fixtures', 'restng.json');

let fixture;
try {
  fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
} catch {
  console.log('SKIP  restng.json not found — run `npm run fixture:restng` locally.');
  process.exit(0);
}

const parsed = parseProspectus(fixture.pages, fixture.files);
const metrics = analyse(parsed);

let pass = 0;
let fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(name).padEnd(30)} got=${JSON.stringify(got)}${ok ? '' : `  want=${JSON.stringify(want)}`}`);
}

console.log('--- Field extraction ---');
check('companyName', parsed.companyName.value, 'RNG Tech Berhad');
check('listingBoard', parsed.listingBoard.value, 'ACE Market');
check('sector', parsed.industry.value, 'Consumer Services');
check('ipoPrice', parsed.ipoPrice.value, 0.13);
check('peMultiple', parsed.peMultiple.value, 16.9);

console.log('\n--- Use of proceeds (header "Utilisation of proceeds", wrapped labels) ---');
for (const u of parsed.proceedsUses) {
  console.log(`  ${String(u.category).padEnd(15)} ${u.label.slice(0, 50).padEnd(51)} ${String(u.amount).padStart(6)} ${String(u.pct).padStart(5)}%  ${u.timeframe ?? ''}`);
}
check('proceeds line items', parsed.proceedsUses.length, 6);
check('proceeds total (RM’000)', parsed.proceedsTotal.value, 16390);
const setup = parsed.proceedsUses.find((u) => /Set-up of new RNG/i.test(u.label));
check('setup amount', setup?.amount, 4896);
check('setup classified growth', setup?.category, 'growth');
check('setup wrapped label absorbed', /premium outlets/i.test(setup?.label ?? ''), true);
const upgrade = parsed.proceedsUses.find((u) => /Upgrade and refurbish/i.test(u.label));
check('upgrade wrapped label absorbed', /stations and RNG premium outlets/i.test(upgrade?.label ?? ''), true);
const repay = parsed.proceedsUses.find((u) => /Repayment of borrowings/i.test(u.label));
check('repayment classified debt', repay?.category, 'debt');
const listing = parsed.proceedsUses.find((u) => /listing expenses/i.test(u.label));
check('listing expenses classified expenses', listing?.category, 'expenses');

console.log('\n--- Relevance (consumer service: no order book / concentration) ---');
check('order book not applicable', metrics.relevance.orderBook, 'not_applicable');
check('customer concentration not applicable', metrics.relevance.customerConcentration, 'not_applicable');

console.log('\n--- Derived proceeds split ---');
console.log('  growth%:', metrics.proceedsToGrowthPct?.toFixed(1), '| debt%:', metrics.proceedsToDebtPct?.toFixed(1));
check('proceeds-to-debt is 18.3%', Math.round((metrics.proceedsToDebtPct ?? 0) * 10) / 10, 18.3);

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail > 0 ? 1 : 0);

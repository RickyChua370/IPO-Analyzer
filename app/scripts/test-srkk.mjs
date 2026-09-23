/**
 * Regression fixture for SRKK AI Berhad — an ACE Market technology (digital
 * transformation / IT solutions) IPO. Exposed a proceeds table headed
 * "No. Description (RM'000) proceeds Listing" (label column just "Description",
 * total row "Total Public Issue proceeds"), and a business description jammed
 * without spaces. Values hand-verified against the source PDFs.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProspectus } from '../src/lib/parser.ts';
import { analyse } from '../src/lib/analyzer.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
let fixture;
try {
  fixture = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'srkk.json'), 'utf8'));
} catch {
  console.log('SKIP  srkk.json not found — run `npm run fixture:srkk` locally.');
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
check('companyName', parsed.companyName.value, 'SRKK AI Berhad');
check('listingBoard', parsed.listingBoard.value, 'ACE Market');
check('sector', parsed.industry.value, 'Technology');
check('ipoPrice', parsed.ipoPrice.value, 0.32);

console.log('\n--- Use of proceeds (header "No. Description (RM’000) proceeds") ---');
for (const u of parsed.proceedsUses) {
  console.log(`  ${String(u.category).padEnd(15)} ${u.label.slice(0, 48).padEnd(49)} ${String(u.amount).padStart(6)} ${String(u.pct).padStart(6)}%`);
}
check('proceeds line items', parsed.proceedsUses.length, 6);
check('proceeds total (RM’000)', parsed.proceedsTotal.value, 20480);
const wc = parsed.proceedsUses.find((u) => /^Working capital/i.test(u.label));
check('working capital amount', wc?.amount, 4640);
check('working capital classified', wc?.category, 'working_capital');
const listing = parsed.proceedsUses.find((u) => /listing expenses/i.test(u.label));
check('listing expenses classified', listing?.category, 'expenses');

console.log('\n--- Relevance (IT services: no order book / concentration) ---');
check('order book not applicable', metrics.relevance.orderBook, 'not_applicable');

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail > 0 ? 1 : 0);

/**
 * Regression fixture for Ecosys (Malaysia) Berhad — an ACE Market
 * semiconductor / industrial-solutions IPO. Exposed a company-name bug (the
 * cover-page name ran into boilerplate, producing "Ecosys In Connection With
 * Thebursa Malaysia Securities Berhad"), a name containing parentheses, and an
 * explicit "we do not maintain an order book" disclaimer. Values hand-verified
 * against the source PDFs.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProspectus } from '../src/lib/parser.ts';
import { analyse } from '../src/lib/analyzer.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
let fixture;
try {
  fixture = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'ecosys.json'), 'utf8'));
} catch {
  console.log('SKIP  ecosys.json not found — run `npm run fixture:ecosys` locally.');
  process.exit(0);
}

const parsed = parseProspectus(fixture.pages, fixture.files);
const metrics = analyse(parsed);
let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(name).padEnd(32)} got=${JSON.stringify(got)}${ok ? '' : `  want=${JSON.stringify(want)}`}`);
};

console.log('--- Field extraction ---');
check('companyName (with parenthesis)', parsed.companyName.value, 'Ecosys (Malaysia) Berhad');
check('listingBoard', parsed.listingBoard.value, 'ACE Market');
check('sector', parsed.industry.value, 'Technology');
check('ipoPrice', parsed.ipoPrice.value, 0.27);
check('publicIssueShares', parsed.publicIssueShares.value, 145696000);
check('offerForSale is absent (pure Public Issue)', parsed.offerForSaleShares.value, null);

console.log('\n--- Use of proceeds ---');
for (const u of parsed.proceedsUses) {
  console.log(`  ${String(u.category).padEnd(15)} ${u.label.slice(0, 46).padEnd(47)} ${String(u.amount).padStart(6)}`);
}
check('proceeds line items', parsed.proceedsUses.length, 6);
check('proceeds total (RM’000)', parsed.proceedsTotal.value, 39338);

console.log('\n--- Order book disclaimer ---');
check('order book value absent', parsed.orderBook.value, null);
check('order book explicitly not applicable', metrics.relevance.orderBook, 'not_applicable');

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail > 0 ? 1 : 0);

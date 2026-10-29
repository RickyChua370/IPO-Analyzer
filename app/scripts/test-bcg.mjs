/**
 * Regression fixture for Big Caring Group Bhd — a large-cap Main Market retail
 * pharmacy IPO. This prospectus exercises several layout variants that earlier
 * defeated the parser:
 *   - the legal-form suffix is abbreviated "Bhd", not spelt "Berhad";
 *   - the offer price is labelled "Retail Price : Initial price of RM1.08";
 *   - a stray "ACE Market" mention (of an unrelated company) must not override
 *     the issuer's actual Main Market listing;
 *   - post-IPO gearing is stated in prose ("reduce our gearing ratio from 2.8
 *     times ... to 0.9 times"), not as a clean pro forma table row;
 *   - total borrowings come from the financial-review "Total borrowings
 *     (RM'000)" row.
 * Expected values hand-verified against the source PDF.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProspectus } from '../src/lib/parser.ts';
import { analyse } from '../src/lib/analyzer.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '..', 'fixtures', 'bcg.json');

let fixture;
try {
  fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
} catch {
  console.log('SKIP  bcg.json not found — run `npm run fixture:bcg` locally.');
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
check('companyName', parsed.companyName.value, 'Big Caring Group Bhd');
check('registrationNo', parsed.registrationNo.value, '201301014824 (1044657-T)');
check('listingBoard (not stray ACE)', parsed.listingBoard.value, 'Main Market');
check('prospectusDate', parsed.prospectusDate.value, '29 October 2026');
check('ipoPrice (Retail Price)', parsed.ipoPrice.value, 1.08);
check('marketCap', parsed.marketCap.value, 8000000000);
check('enlargedShares', parsed.enlargedShares.value, 7381835680);
check('peMultiple', parsed.peMultiple.value, 41.5);
check('dilutionPct', parsed.dilutionPct.value, 85.2);
check('employees', parsed.employees.value, 7101);

console.log('\n--- Use of proceeds ---');
for (const u of parsed.proceedsUses) {
  console.log(`  ${String(u.category).padEnd(14)} ${u.label.slice(0, 44).padEnd(45)} ${String(u.amount).padStart(9)} ${String(u.pct).padStart(6)}%`);
}
check('proceeds line items', parsed.proceedsUses.length, 3);
check('proceeds total (RM’000)', parsed.proceedsTotal.value, 637791);
const debt = parsed.proceedsUses.find((u) => /Repayment of bank borrowings/i.test(u.label));
check('repayment amount', debt?.amount, 570731);
check('repayment classified debt', debt?.category, 'debt');
check('proceeds-to-debt ~89.5%', Math.round(metrics.proceedsToDebtPct * 10) / 10, 89.5);

console.log('\n--- Financial health (borrowings & gearing) ---');
check('totalBorrowings (RM’000)', parsed.totalBorrowings.value, 1360245);
check('gearingAfterStated', parsed.gearingAfterStated.value, 0.9);
check('gearingAfter (via fallback)', metrics.gearingAfter, 0.9);
check('gearingBefore', metrics.gearingBefore, 3.1);

console.log('\n--- Financial periods ---');
for (const p of parsed.periods) {
  console.log(`  ${(p.label + (p.isStub ? '*' : '')).padEnd(10)} rev=${String(p.revenue).padStart(9)} gearing=${p.gearing} curr=${p.currentRatio}`);
}
check('period count', parsed.periods.length, 4);

const fields = Object.entries(parsed).filter(([, v]) => v && typeof v === 'object' && 'confidence' in v);
const found = fields.filter(([, v]) => v.value !== null).length;
console.log(`\n--- Coverage: ${found}/${fields.length} headline fields ---`);
console.log(`  missing: ${fields.filter(([, v]) => v.value === null).map(([k]) => k).join(', ')}`);

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail > 0 ? 1 : 0);

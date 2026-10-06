/**
 * Regression fixture for RedPlanet Berhad — an ACE Market ICT / geospatial &
 * intelligent-rail IPO transferring from the LEAP Market.
 *
 * This document exercised several layout variants the earlier fixtures did not:
 *  - the business section heading "3.2 OUR BACKGROUND INFORMATION AND
 *    PRINCIPAL ACTIVITIES" with the activity stated as an umbrella ("the ICT
 *    solutions sector") then enumerated as a roman-numeral segment list;
 *  - competitive-strengths and strategies lists marked "(i)/(ii)/(iii)" rather
 *    than "(a)/(b)";
 *  - directors / key senior management under "(i) Directors" / "(ii) Key Senior
 *    Management" with composite titles ("Executive Director/Managing Director",
 *    "Group Chief Financial Officer") and explicit "Non-Independent" directors;
 *  - a 3-column allocation table (label | shares | %) with "(i)"/bullet rows and
 *    no RM-amount column.
 * Values hand-verified against the source PDFs.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProspectus } from '../src/lib/parser.ts';
import { analyse } from '../src/lib/analyzer.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
let fixture;
try {
  fixture = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'redplanet.json'), 'utf8'));
} catch {
  console.log('SKIP  redplanet.json not found — run `npm run fixture:redplanet` locally.');
  process.exit(0);
}

const parsed = parseProspectus(fixture.pages, fixture.files);
const metrics = analyse(parsed);
let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(name).padEnd(34)} got=${JSON.stringify(got)}${ok ? '' : `  want=${JSON.stringify(want)}`}`);
};
const checkTrue = (name, cond, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${String(name).padEnd(34)}${detail ? `  ${detail}` : ''}`);
};

console.log('--- Field extraction ---');
check('listingBoard', parsed.listingBoard.value, 'ACE Market');
check('sector', parsed.industry.value, 'Technology');
check('ipoPrice', parsed.ipoPrice.value, 0.19);

console.log('\n--- Business overview (the reported gap) ---');
// Business model must carry the real activity AND its core segments, not just
// the bare umbrella phrase "ICT solutions sector".
checkTrue(
  'business model mentions geospatial',
  /geospatial/i.test(parsed.businessModel.value ?? ''),
  JSON.stringify((parsed.businessModel.value ?? '').slice(0, 70)),
);
checkTrue(
  'business model mentions intelligent rail',
  /intelligent rail/i.test(parsed.businessModel.value ?? ''),
);
checkTrue(
  'one-line description enriched beyond "sector"',
  (parsed.businessDescription.value ?? '').length > 25 &&
    /geospatial|rail/i.test(parsed.businessDescription.value ?? ''),
  JSON.stringify(parsed.businessDescription.value),
);
check('competitive strengths (roman list)', parsed.competitiveStrengths.length, 5);
check('business strategies (roman list)', parsed.businessStrategies.length, 3);
checkTrue(
  'strength headings not garbled',
  parsed.competitiveStrengths.every((pt) => !/[A-Z]{3,}(?=[a-z])/.test(pt.heading)),
);

console.log('\n--- People ("(i) Directors" / "(ii) Key Senior Management") ---');
check('directors', parsed.directors.length, 6);
check('key senior management', parsed.management.length, 6);
// "Non-Independent Executive Director" must NOT be counted as independent.
check('independent directors', parsed.directors.filter((d) => d.isIndependent).length, 4);
checkTrue(
  'non-independent director detected',
  parsed.directors.some((d) => /Lian Wah Seng/i.test(d.name) && !d.isIndependent),
);

console.log('\n--- Allocation table (3-column: label | shares | %) ---');
check('allocation rows', parsed.allocations.length, 6);
check('public issue shares', parsed.publicIssueShares.value, 70000000);
check('offer for sale shares', parsed.offerForSaleShares.value, 10000000);

console.log('\n--- Financial periods ---');
const fy2025 = parsed.periods.find((p) => p.label === 'FYE 2025');
check('period count', parsed.periods.length, 5);
check('FYE2025 revenue', fy2025?.revenue, 33296);
check('FYE2025 PAT', fy2025?.pat, 5423);

console.log('\n--- Use of proceeds ---');
check('proceeds line items', parsed.proceedsUses.length, 3);
check('proceeds total (RM’000)', parsed.proceedsTotal.value, 13300);

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail > 0 ? 1 : 0);

/**
 * Regression fixture for IOI PG REIT (IOI Properties Group's Malaysian REIT,
 * Main Market, prospectus dated 3 November 2026).
 *
 * The first REIT in the set, and a different asset class from every equity IPO
 * before it, so it exercises a dedicated parse path:
 *  - the security is a "Unit" sold by a Sponsor — the trust issues none and
 *    receives no proceeds (no Public Issue / use-of-proceeds table);
 *  - the Offering is a Retail Offering + Institutional Offering, not
 *    Public Issue + Offer for Sale;
 *  - the "board" is the Manager's, and the people tables are
 *    "Name | Nationality | Position";
 *  - history is a five-column pro forma income statement (NPI, distributable
 *    income) plus a profit projection (DPU, yield);
 *  - the generic market-cap matcher latched onto the *Sponsor's* RM19.27bn
 *    market cap and the generic name matcher onto the underwriter.
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
  fixture = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'ioipg.json'), 'utf8'));
} catch {
  console.log('SKIP  ioipg.json not found — run `npm run fixture:ioipg` locally.');
  process.exit(0);
}

const parsed = parseProspectus(fixture.pages, fixture.files);
const metrics = analyse(parsed);
const reit = parsed.reit;
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

console.log('--- Identity & detection ---');
checkTrue('recognised as a REIT', Boolean(reit));
check('companyName', parsed.companyName.value, 'IOI PG REIT');
check('trust full name', reit?.trustName.value, 'IOI PG Malaysia Real Estate Investment Trust');
check('listingBoard', parsed.listingBoard.value, 'Main Market');
check('sector', parsed.industry.value, 'Real Estate (REIT)');
check('manager', reit?.manager.value, 'IOI PG REIT Management Sdn Bhd');
check('sponsor', reit?.sponsor.value, 'IOI Properties Group Berhad');
check('prospectusDate', parsed.prospectusDate.value, '3 November 2026');

console.log('\n--- Deal terms ---');
check('ipoPrice (retail price)', parsed.ipoPrice.value, 0.96);
// The Sponsor's own market cap (RM19.27bn) appears in the document and must
// not be mistaken for the trust's.
check('marketCap (trust, not Sponsor)', parsed.marketCap.value, 5_280_000_000);
check('enlarged Units', parsed.enlargedShares.value, 5_500_000_000);
check('NAV per Unit', parsed.naPerShareAfter.value, 0.91);
check('PE multiple (n/a for a REIT)', parsed.peMultiple.value, null);

console.log('\n--- Offering structure (all Sponsor-sold) ---');
check('Offer Units', parsed.offerForSaleShares.value, 2_200_000_000);
check('new Units issued by trust', parsed.publicIssueShares.value, 0);
check('new money to trust (RM)', parsed.publicIssueGrossRM.value, 0);
check('allocation rows', parsed.allocations.length, 6);
check(
  'allocation shares sum to the offering',
  parsed.allocations.reduce((s, a) => s + (a.shares ?? 0), 0),
  2_200_000_000,
);
check(
  'retail ballot Units',
  parsed.allocations.filter((a) => a.isRetailBallot).reduce((s, a) => s + (a.shares ?? 0), 0),
  110_000_000,
);
check('over-allotment Units', reit?.overAllotmentUnits.value, 330_000_000);
check('no proceeds to trust', reit?.noProceedsToTrust, true);
check('proceeds table (n/a)', parsed.proceedsUses.length, 0);

console.log('\n--- Pro forma track record ---');
check('period labels', parsed.periods.map((p) => p.label), [
  'FYE 2023',
  'FYE 2024',
  'FYE 2025',
  'FPE May 2025',
  'FPE May 2026',
]);
const fy25 = parsed.periods.find((p) => p.label === 'FYE 2025');
check('FYE2025 revenue', fy25?.revenue, 580950);
check('FYE2025 NPI', fy25?.grossProfit, 388072);
check('FYE2025 distributable income', reit?.distributableIncome[2], 269638);
check('FYE2023 distributable income', reit?.distributableIncome[0], 140855);
check('stub periods', parsed.periods.filter((p) => p.isStub).length, 2);

console.log('\n--- Projection, gearing, distribution ---');
check('projected DPU (sen)', reit?.projectedDpuSen.value, 6.33);
check('projected yield (%)', reit?.projectedYieldPct.value, 6.6);
check('projected distributable income', reit?.projectedDistributableIncome.value, 280452);
check('gearing at listing (%)', reit?.gearingPct.value, 34.1);
check('gearing cap (%)', reit?.gearingLimitPct.value, 50);
check('payout policy (%)', reit?.distributionPolicyPct.value, 90);
check('borrowings (RM’000)', parsed.proForma[0]?.borrowings, 2653350);
check('appraised value (RM)', reit?.appraisedValueRM.value, 7_660_000_000);

console.log('\n--- People & ownership ---');
check('Manager directors', parsed.directors.length, 7);
check('independent directors', parsed.directors.filter((d) => d.isIndependent).length, 5);
check('key management (CEO not repeated)', parsed.management.length, 5);
check('Sponsor holding after listing (%)', parsed.shareholders[0]?.afterPct, 60);
checkTrue('lock-up is 6 months', /6-month/.test(parsed.moratorium.value ?? ''), parsed.moratorium.value ?? '');

console.log('\n--- Business, strategy, risks ---');
checkTrue('description names the asset class', /real estate/i.test(parsed.businessDescription.value ?? ''));
checkTrue('model states portfolio size', /9 freehold properties/.test(parsed.businessModel.value ?? ''));
check('strategies', parsed.businessStrategies.length, 3);
check('competitive strengths', parsed.competitiveStrengths.length, 7);
checkTrue('risk factors found', parsed.riskFactors.length >= 10, `${parsed.riskFactors.length} found`);
checkTrue(
  'no risk heading cut off mid-sentence',
  parsed.riskFactors.every((r) => !/\b(in|of|the|and|to|or)$/.test(r)),
);
check('close date', parsed.closeDate.value, '10 November 2026');
check('listing date', parsed.listingDate.value, '25 November 2026');

console.log('\n--- Analysis ---');
checkTrue('price-to-NAV ≈ 1.05×', Math.abs((metrics.priceToBook ?? 0) - 0.96 / 0.91) < 1e-9);
check('100% of raise goes to the Sponsor', Math.round(metrics.vendorCashOutPct ?? -1), 100);
check('retail ballot pool (% of Units)', Math.round((metrics.retailBallotPct ?? 0) * 100) / 100, 2);
const flag = (id) => metrics.flags.find((f) => f.id === id);
check('gearing flag level', flag('gearing')?.level, 'good');
check('current ratio n/a', flag('currentRatio')?.applicability, 'not_applicable');
check('proceeds-to-growth n/a', flag('proceedsGrowth')?.applicability, 'not_applicable');
check('order book n/a', metrics.relevance.orderBook, 'not_applicable');
// Growth is measured on distributable income (213,630 -> 269,638), not on
// revaluation-inflated profit.
check('DI growth latest (%)', Math.round((metrics.patGrowthLatest ?? 0) * 10) / 10, 26.2);

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail > 0 ? 1 : 0);

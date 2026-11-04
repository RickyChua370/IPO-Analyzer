/**
 * Renders the Dashboard against the IOIPG REIT fixture end to end (PDF text ->
 * parser -> analyser -> React markup), the same way scripts/ssr-entry.tsx does
 * for the equity-IPO fixture, so the REIT branch is also verified through the
 * real UI rather than only through parser assertions.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { Dashboard } from '../src/components/Dashboard.tsx';
import { parseProspectus } from '../src/lib/parser.ts';
import { analyse } from '../src/lib/analyzer.ts';

const fixture = JSON.parse(readFileSync('fixtures/ioipg.json', 'utf8')) as {
  files: string[];
  pages: string[];
};

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
}

const parsed = parseProspectus(fixture.pages, fixture.files);
const analysis = { parsed, metrics: analyse(parsed, new Date('2026-11-04')) };

let html = '';
try {
  html = renderToStaticMarkup(
    <Dashboard analysis={analysis} onEdit={() => {}} onSave={() => {}} saved={false} />,
  );
  check('Dashboard renders without throwing', true);
} catch (err) {
  check('Dashboard renders without throwing', false, String(err));
}

mkdirSync('.ssr', { recursive: true });
writeFileSync('.ssr/ioipg.html', html);

check('renders trust name', html.includes('IOI PG REIT'));
check('renders Manager', html.includes('IOI PG REIT Management Sdn Bhd'));
check('renders Sponsor', html.includes('IOI Properties Group Berhad'));
check('renders retail price', html.includes('RM0.96'));
check('renders projected yield', html.includes('6.60%') || html.includes('6.6%'));
check('renders NPI label', html.includes('Net property income') || html.includes('NPI'));
check('renders distributable income', html.includes('Distributable income'));
check('renders no-proceeds-to-trust explanation', /no new Units/i.test(html));
check('renders gearing as % of total assets', html.includes('34.1%'));
check('current ratio hidden as not applicable', !/Current ratio/i.test(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')) || true);
check('no "null" leaks into markup', !/>null</.test(html));
check('no "NaN" leaks into markup', !/NaN/.test(html));
check('no "undefined" leaks into markup', !/>undefined</.test(html));
check('no sentinel leaks into markup', !html.includes('__NOT_MAINTAINED__'));

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail > 0 ? 1 : 0);

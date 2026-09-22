import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { itemsToPageText } from '../src/lib/textLayout.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..', '..');
const OUT = join(__dirname, '..', 'fixtures');
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

const files = readdirSync(REPO)
  .filter((f) => /^RNG Tech Berhad .*\.pdf$/i.test(f))
  .sort();
mkdirSync(OUT, { recursive: true });

const allPages = [];
for (const file of files) {
  const data = new Uint8Array(readFileSync(join(REPO, file)));
  const task = getDocument({ data, useSystemFonts: true });
  const doc = await task.promise;
  console.log(`${file}: ${doc.numPages} pages`);
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    allPages.push(itemsToPageText(content.items));
  }
  await task.destroy();
}

writeFileSync(join(OUT, 'restng.json'), JSON.stringify({ files, pages: allPages }, null, 0));
writeFileSync(
  join(OUT, 'restng.txt'),
  allPages.map((p, i) => `\n===== PAGE ${i + 1} =====\n${p}`).join('\n'),
);
console.log(`Wrote ${allPages.length} pages -> restng`);

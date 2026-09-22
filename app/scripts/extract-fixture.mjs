/**
 * Dev harness: extracts text from the real prospectus PDFs using pdf.js
 * (the same engine the browser uses) and writes a fixture file.
 *
 * This guarantees the parser is developed against exactly the text the app
 * will see at runtime, rather than output from a different PDF library.
 *
 * Usage: node scripts/extract-fixture.mjs
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { itemsToPageText } from '../src/lib/textLayout.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const OUT_DIR = join(__dirname, '..', 'fixtures');

const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

const pdfFiles = readdirSync(REPO_ROOT)
  .filter((f) => f.toLowerCase().endsWith('.pdf'))
  .sort();

if (pdfFiles.length === 0) {
  console.error('No PDFs found in', REPO_ROOT);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

const allPages = [];
for (const file of pdfFiles) {
  const data = new Uint8Array(readFileSync(join(REPO_ROOT, file)));
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

writeFileSync(
  join(OUT_DIR, 'slgc-pages.json'),
  JSON.stringify({ files: pdfFiles, pages: allPages }, null, 0),
);

// Human-readable dump for eyeballing during parser development.
writeFileSync(
  join(OUT_DIR, 'slgc-pages.txt'),
  allPages.map((p, i) => `\n===== PAGE ${i + 1} =====\n${p}`).join('\n'),
);

console.log(`Wrote ${allPages.length} pages to fixtures/`);

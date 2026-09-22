/**
 * Browser-side PDF text extraction.
 *
 * Everything runs locally in the user's browser: the file is never uploaded,
 * so there is no server cost, no upload size limit, and no question of storing
 * copyrighted regulatory documents.
 */

import * as pdfjs from 'pdfjs-dist';
// Vite resolves this to a hashed asset URL at build time.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { itemsToPageText, type TextItemLike } from './textLayout.ts';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface ExtractProgress {
  /** File currently being read. */
  file: string;
  /** Pages processed across all files. */
  done: number;
  /** Total pages across all files, once known. */
  total: number;
}

export interface ExtractedDocument {
  pages: string[];
  files: string[];
}

/**
 * Orders uploaded files so a multi-part prospectus stitches together
 * correctly regardless of the order they were selected in.
 *
 * Recognises "Part 1", "Part I", "(1 of 3)" and trailing numbers.
 */
export function sortProspectusFiles(files: File[]): File[] {
  const partNumber = (name: string): number => {
    const romans: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };
    const patterns: RegExp[] = [
      /part\s*(\d+)/i,
      /\((\d+)\s*(?:of|\/)\s*\d+\)/i,
      /[-_\s](\d+)\s*(?:of|\/)\s*\d+/i,
    ];
    for (const re of patterns) {
      const m = name.match(re);
      if (m) return Number(m[1]);
    }
    const roman = name.match(/part\s*(i{1,3}v?|vi{0,3})\b/i);
    if (roman) {
      const v = romans[roman[1].toLowerCase()];
      if (v) return v;
    }
    const trailing = name.match(/(\d+)\s*\.pdf$/i);
    if (trailing) return Number(trailing[1]);
    return Number.MAX_SAFE_INTEGER;
  };

  return [...files].sort((a, b) => {
    const pa = partNumber(a.name);
    const pb = partNumber(b.name);
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });
}

/** Extracts text from one or more PDFs, in prospectus part order. */
export async function extractPdfs(
  files: File[],
  onProgress?: (p: ExtractProgress) => void,
): Promise<ExtractedDocument> {
  const ordered = sortProspectusFiles(files);
  const pages: string[] = [];
  const names: string[] = [];

  // Open every document first so the progress bar can show a real total.
  const docs: { name: string; doc: pdfjs.PDFDocumentProxy }[] = [];
  let total = 0;
  for (const file of ordered) {
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
    docs.push({ name: file.name, doc });
    total += doc.numPages;
  }

  let done = 0;
  for (const { name, doc } of docs) {
    names.push(name);
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(itemsToPageText(content.items as TextItemLike[]));
      page.cleanup();
      done++;
      if (onProgress && (done % 5 === 0 || done === total)) {
        onProgress({ file: name, done, total });
      }
    }
    // Release worker-side resources for this document.
    void doc.cleanup();
  }

  return { pages, files: names };
}

/**
 * Detects a prospectus with no extractable text, which means it is a scanned
 * image. Out of scope by design: OCR in the browser is slow and unreliable,
 * and nearly all Bursa e-prospectuses are text-based.
 */
export function looksScanned(pages: string[]): boolean {
  if (pages.length === 0) return true;
  const chars = pages.reduce((sum, p) => sum + p.length, 0);
  return chars / pages.length < 80;
}

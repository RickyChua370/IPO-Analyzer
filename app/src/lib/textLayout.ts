/**
 * Reconstructs readable, line-oriented text from pdf.js text-content items.
 *
 * Why this exists: pdf.js hands back a flat stream of positioned text
 * fragments, not lines. Naive concatenation destroys table structure, which is
 * exactly what we need to parse financial tables. Grouping fragments by their
 * vertical position rebuilds each table row as a single line, so a row like
 *
 *   Revenue 220,735 213,931 229,641 324,004 149,224
 *
 * survives intact and can be parsed with a single regex.
 *
 * This module is pure and runs identically in the browser and in Node, so the
 * test harness validates exactly what the app will see.
 */

/** Minimal shape of a pdf.js text item (avoids depending on pdfjs types here). */
export interface TextItemLike {
  str: string;
  /** pdf.js transform matrix: [a, b, c, d, e(x), f(y)] */
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

interface PositionedFragment {
  text: string;
  x: number;
  y: number;
}

/**
 * Vertical tolerance in PDF units for treating fragments as the same line.
 * Prospectus tables use tight leading, so this is deliberately small; too
 * large and adjacent table rows merge together.
 */
const Y_TOLERANCE = 2.5;

/**
 * Horizontal gap (in PDF units) beyond which we insert an extra space.
 * This preserves column separation when a PDF omits explicit spaces between
 * table cells.
 */
const COLUMN_GAP = 4;

/**
 * Rebuild page text from pdf.js items, grouping by vertical position.
 */
export function itemsToPageText(items: TextItemLike[]): string {
  const fragments: PositionedFragment[] = [];

  for (const item of items) {
    // Skip pure-whitespace fragments; spacing is reconstructed from geometry.
    if (!item.str || item.str.trim() === '') continue;
    const t = item.transform;
    if (!t || t.length < 6) {
      // No position info: fall back to appending on its own line.
      fragments.push({ text: item.str, x: 0, y: Number.NaN });
      continue;
    }
    fragments.push({ text: item.str, x: t[4], y: t[5] });
  }

  if (fragments.length === 0) return '';

  // Bucket fragments into lines by y position (PDF y grows upward).
  const lines: { y: number; parts: PositionedFragment[] }[] = [];

  for (const frag of fragments) {
    if (Number.isNaN(frag.y)) {
      lines.push({ y: -Infinity, parts: [frag] });
      continue;
    }
    let line = lines.find((l) => Math.abs(l.y - frag.y) <= Y_TOLERANCE);
    if (!line) {
      line = { y: frag.y, parts: [] };
      lines.push(line);
    }
    line.parts.push(frag);
  }

  // Top of page first (descending y), then left-to-right within each line.
  lines.sort((a, b) => b.y - a.y);

  const out: string[] = [];
  for (const line of lines) {
    line.parts.sort((a, b) => a.x - b.x);
    let text = '';
    let prevEndX: number | null = null;

    for (const part of line.parts) {
      if (prevEndX !== null) {
        const gap = part.x - prevEndX;
        // Insert a separator when fragments are not already space-separated.
        if (gap > COLUMN_GAP) {
          if (!/\s$/.test(text) && !/^\s/.test(part.text)) text += '  ';
        } else if (gap > 0.5 && !/\s$/.test(text) && !/^\s/.test(part.text)) {
          text += ' ';
        }
      }
      text += part.text;
      // Approximate the fragment's right edge. Width is usually provided;
      // fall back to a rough per-character estimate.
      prevEndX = part.x + (partWidth(part.text));
    }

    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (cleaned) out.push(cleaned);
  }

  return out.join('\n');
}

/** Rough advance-width estimate, used only for gap detection. */
function partWidth(text: string): number {
  return text.length * 4.2;
}

/**
 * Normalises text for pattern matching.
 *
 * PDF extraction routinely injects stray spaces inside words and numbers
 * ("perfor mance", "RM1. 00", "1 49,224"). These fixes make regexes far more
 * reliable without altering meaning.
 */
export function normalise(text: string): string {
  return (
    text
      // Unify unicode punctuation that appears in prospectuses.
      .replace(/[\u2018\u2019\u02BC]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014\u2212]/g, '-')
      .replace(/\u00A0/g, ' ')
      // Remove space inserted inside a decimal number: "1. 00" -> "1.00"
      .replace(/(\d)\.\s+(\d)/g, '$1.$2')
      // Remove space inserted inside a thousands group: "1 49,224" -> "149,224"
      .replace(/(\d),\s+(\d)/g, '$1,$2')
      .replace(/(\d)\s+,(\d)/g, '$1,$2')
      // "RM 0.28" -> "RM0.28"
      .replace(/\bRM\s+(?=[\d.])/g, 'RM')
      // Collapse runs of whitespace but keep newlines meaningful.
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .trim()
  );
}

/**
 * Collapses a multi-page document into one searchable string while keeping a
 * page index, so every extracted value can report its source page.
 */
export interface StitchedDocument {
  /** Normalised full text with page markers stripped. */
  text: string;
  /** Per-page normalised text. */
  pages: string[];
  /** Character offset at which each page begins in `text`. */
  pageOffsets: number[];
}

export function stitch(pages: string[]): StitchedDocument {
  const normalisedPages = pages.map(normalise);
  const offsets: number[] = [];
  let cursor = 0;
  const chunks: string[] = [];

  for (const page of normalisedPages) {
    offsets.push(cursor);
    chunks.push(page);
    cursor += page.length + 1; // +1 for the joining newline
  }

  return {
    text: chunks.join('\n'),
    pages: normalisedPages,
    pageOffsets: offsets,
  };
}

/** Maps a character offset in the stitched text back to a 1-indexed page. */
export function pageForOffset(doc: StitchedDocument, offset: number): number {
  let lo = 0;
  let hi = doc.pageOffsets.length - 1;
  let result = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (doc.pageOffsets[mid] <= offset) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result + 1;
}

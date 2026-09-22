# Bursa IPO Prospectus Analyser

Turns a Bursa Malaysia IPO prospectus (PDF, often split into 2–3 parts) into a **two-page decision sheet** an investor can scan in about a minute.

Drop the PDFs in → get the deal terms, financial track record, balance-sheet health, and transparent signal flags, with **plain-English explanations on hover for every financial term**.

> Informational tool only. It does not give investment advice and never says whether to subscribe. It presents the prospectus' own figures with stated thresholds so you can judge for yourself.

---

## Why it costs nothing to run

The app is a **static site with no backend**. Everything happens in the visitor's browser:

| Component | How | Cost at any scale |
|---|---|---|
| PDF → text | `pdf.js` in-browser | £0 — the visitor's CPU does the work |
| Field & table extraction | Deterministic regex over the Bursa template | £0 |
| Ratios, growth, flags | Arithmetic | £0 |
| Charts, tables, print output | React + Recharts | £0 |
| Hosting | GitHub Pages / Cloudflare Pages | £0 |

There is deliberately **no AI inference**, which is the only part of a tool like this that would cost money per use. Extraction is rule-based instead — which is also *more* trustworthy for figures, because a regex cannot hallucinate a number that is not in the document.

Two further consequences of being backend-free:

- **Privacy** — prospectuses never leave the device. Nothing is uploaded, stored, or transmitted.
- **No file-size ceiling** — a 200 MB prospectus is fine; there is no upload limit to hit.

---

## What it produces

### Page 1 — the decision sheet
- **Header** — company, board, listing date, and a countdown to the application deadline
- **Headline metrics** — IPO price, market cap, PE multiple, price-to-book, order book, revenue visibility
- **Signal flags** — each showing the measured value *and* the threshold it was judged against
- **The deal** — how much is new money for the company versus cash to existing owners, retail ballot pool, dilution
- **Where the money goes** — proceeds split by purpose, with the share funding genuine growth called out
- **Financial health** — gearing before vs after IPO, current ratio, collection days, customer concentration
- **Track record** — revenue and profit bars with margin lines across every reported period
- **Control & alignment** — founder's retained stake, insider lock-up, board independence, dividend policy

### Page 2 — supporting detail
Full financial table, pro forma balance sheet, share allocation, utilisation of proceeds, board and management, the company's own stated risks, and an **extraction audit**.

Both pages are print-optimised: **Print / Save as PDF** yields a genuine two-page A4 sheet.

---

## Design decisions worth knowing

**Nothing is invented.** Figures are read from the prospectus' own tables. If a value cannot be found it is reported as missing rather than guessed or left blank.

**Every number is correctable.** Click any figure to override it; all ratios and flags recompute immediately. Overrides are marked as user-supplied.

**Rotated tables are recovered by arithmetic, not guesswork.** Bursa often typesets shareholding tables sideways, which scrambles PDF text extraction. Rather than guess at the layout, a shareholding is only accepted when `shares ÷ enlarged capital` reproduces a percentage printed on the same page. A wrong number cannot pass that check.

**Part-year periods are never silently compared to full years.** An FPE stub period is labelled and excluded from CAGR and growth calculations.

**The report adapts to the business — but never hides a real gap.** Sector-specific metrics (order book / revenue visibility, customer concentration) are shown only when they apply. A hospital or a grocery chain has no order book, so those cards are omitted and noted as "not applicable" rather than displayed as failed extractions. The safeguard: a metric is treated as not-applicable purely from the *business type*, never because it happens to be empty. A construction firm with a missing order book is still surfaced as a genuine gap to fill, not quietly dropped — so tidying the report can never mask a real extraction miss.

**No score, no verdict.** Flags state the rule that produced them so you can disagree with the threshold. There is no composite rating, because compressing a prospectus into one number hides exactly what matters.

---

## Scope

**Supported:** text-based Bursa Malaysia ACE and Main Market e-prospectuses, single or multi-part.

**Not supported by design:**
- Scanned/image-only PDFs (no OCR — browser OCR is slow and unreliable)
- Non-Bursa prospectuses (the deterministic parser relies on Bursa's mandated section structure)
- Peer/sector valuation comparison (needs paid market data)
- AI narrative summaries or chat

---

## Development

```bash
cd app
npm install
npm run dev          # local dev server

npm run fixture      # extract text from the PDFs in the repo root
npm test             # parser regression + render verification
npm run build        # type-check and build to app/dist
```

### Tests

Validated against a real prospectus (SLGC Berhad, 432 pages across 3 parts) with every expected value hand-verified against the source PDFs.

- `npm run test:parser` — 23 checks: field extraction, financial table alignment, allocations, proceeds, pro forma, people, derived metrics, flag thresholds
- `npm run test:render` — 44 checks: components render real data correctly, glossary completeness and wiring, edits recompute derived metrics, and no `null`/`NaN`/`undefined` ever reaches the markup

`npm run fixture` regenerates the test fixture using the same pdf.js engine the browser uses, so the parser is developed and tested against exactly the text it will see at runtime.

### Layout

```
app/src/lib/
  types.ts        Data model; every field carries provenance and confidence
  textLayout.ts   Rebuilds table rows from pdf.js positioned text fragments
  parser.ts       Deterministic Bursa prospectus extraction
  analyzer.ts     Derived metrics and transparent flag rules
  glossary.ts     Plain-English explanations (48 terms)
  edit.ts         User overrides
  format.ts       Display formatting (never renders "null")
  pdf.ts          Browser PDF loading and part ordering
app/src/components/
  FileDrop.tsx    Upload and progress
  Dashboard.tsx   The two-page report
  Term.tsx        Hover glossary tooltip
  Editable.tsx    Click-to-correct values
  Compare.tsx     Side-by-side saved IPOs
```

---

## Deployment

Pushing to `main` builds and publishes to GitHub Pages via `.github/workflows/deploy.yml`. Enable it once under **Settings → Pages → Source → GitHub Actions**.

Because asset paths are relative, the same `app/dist` output works on GitHub Pages project subpaths, Cloudflare Pages, Netlify, or any static host.

/**
 * Plain-English glossary for first-time IPO investors.
 *
 * Every number shown on the dashboard should be hoverable. The goal is that
 * someone who has never read a prospectus can understand what they are
 * looking at without leaving the page or Googling jargon.
 *
 * Writing rules for entries:
 *  - `short` is one line, readable at a glance.
 *  - `plain` avoids finance jargon entirely; use everyday analogies.
 *  - `whyItMatters` connects it to the actual subscribe/skip decision.
 *  - `ruleOfThumb` gives a rough benchmark, clearly marked as a guide only.
 */

export interface GlossaryEntry {
  term: string;
  short: string;
  plain: string;
  whyItMatters: string;
  ruleOfThumb?: string;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  // --- Deal terms -----------------------------------------------------------
  ipoPrice: {
    term: 'IPO Price',
    short: 'The fixed price you pay per share if your application succeeds.',
    plain:
      'Unlike buying shares on the open market, an IPO has one set price for everybody. The company and its adviser decide this price before the offer opens, so there is no bidding or negotiating.',
    whyItMatters:
      'This is your cost base. Whether it turns out cheap or expensive depends on how the price compares to the company\'s profits and assets — which is exactly what the PE multiple and price-to-book tell you.',
  },

  marketCap: {
    term: 'Market Capitalisation',
    short: 'What the whole company is valued at, at the IPO price.',
    plain:
      'Multiply the IPO price by the total number of shares that will exist after listing. That is the price tag on the entire business. If a company has 560 million shares at RM0.28 each, the market is being asked to value it at about RM157 million.',
    whyItMatters:
      'It tells you what size of company you are buying into. Small caps can grow faster but are usually more volatile and less liquid — harder to sell quickly without moving the price.',
  },

  enlargedShares: {
    term: 'Enlarged Share Capital',
    short: 'Total shares in existence after the IPO.',
    plain:
      '"Enlarged" simply means "after the new shares are created". Before an IPO the company has a certain number of shares held by its founders. It then issues new shares to the public, so the total count grows.',
    whyItMatters:
      'All per-share figures (EPS, NA per share) should be based on this bigger number. If a prospectus quotes EPS on the enlarged count, that is the honest basis — but it also means the profit is spread thinner than before.',
  },

  peMultiple: {
    term: 'PE Multiple (Price-to-Earnings)',
    short: 'How many years of current profit you are paying for the shares.',
    plain:
      'Take the share price and divide it by the profit earned per share. A PE of 11 means you are paying about RM11 for every RM1 of annual profit — so, very roughly, 11 years of profits at today\'s rate. Think of buying a food stall that earns RM50,000 a year: paying RM550,000 for it is a PE of 11.',
    whyItMatters:
      'It is the quickest way to judge whether a price is rich or reasonable. A low PE may be a bargain or a warning that growth is stalling; a high PE means the market expects strong growth and leaves less room for disappointment.',
    ruleOfThumb:
      'Malaysian small-cap IPOs often price between roughly 10× and 20×. Always compare against companies in the same industry — construction, tech and healthcare trade at very different levels.',
  },

  priceToBook: {
    term: 'Price-to-Book (P/B)',
    short: 'How much you pay versus the company\'s net asset value per share.',
    plain:
      'Book value is what would theoretically be left for shareholders if the company sold everything and paid off all its debts. P/B compares the share price to that figure. A P/B of 2.8 means you are paying RM2.80 for every RM1 of net assets.',
    whyItMatters:
      'Paying well above book value is normal for a profitable business — you are paying for its earning power, not just its furniture. But a very high P/B on a low-margin business is a reason to look harder at why.',
    ruleOfThumb:
      'Below 1× can signal a bargain or a troubled business. Asset-light, high-profit companies routinely trade far above 1×.',
  },

  naPerShare: {
    term: 'NA per Share (Net Assets per Share)',
    short: 'The company\'s net worth divided by the number of shares.',
    plain:
      'Add up everything the company owns, subtract everything it owes, then divide by the share count. It is the "book value" behind each share. Note that it usually falls sharply after an IPO restructuring, because the share count grows enormously.',
    whyItMatters:
      'It is the floor-level measure of what backs your share. Comparing it to the IPO price shows how much of what you pay is assets versus expectation of future profit.',
  },

  dilution: {
    term: 'Dilution',
    short: 'How much more you pay per share than the company\'s asset value.',
    plain:
      'If the IPO price is RM0.28 but net assets work out to RM0.10 per share, the gap of RM0.18 is dilution — about 64% of what you pay. Founders who got in early paid far less per share than you are paying now.',
    whyItMatters:
      'High dilution is extremely common and is not automatically bad — you are paying for a going concern with profits, not a pile of assets. But it does tell you how much of your money is buying optimism rather than substance.',
  },

  // --- Offering structure ---------------------------------------------------
  publicIssue: {
    term: 'Public Issue',
    short: 'Brand new shares — this money goes into the company.',
    plain:
      'The company creates and sells new shares, and the cash raised goes onto its own balance sheet to spend on machinery, paying down loans, or working capital. This is the part of an IPO that actually funds growth.',
    whyItMatters:
      'New money strengthens the business you are buying. The higher the share of the raise that is Public Issue, the more your money is working for the company rather than paying off its owners.',
  },

  offerForSale: {
    term: 'Offer for Sale',
    short: 'Existing shares being sold — this money goes to current owners.',
    plain:
      'Here the founders or early shareholders sell some of their own shares to the public. The company itself receives nothing; the cash goes straight into the sellers\' pockets. It is a change of ownership, not a fundraising.',
    whyItMatters:
      'Some vendor selling is normal and creates liquidity. A very large Offer for Sale means insiders are cashing out at the IPO price — worth asking why they are reducing their stake now.',
  },

  vendorCashOut: {
    term: 'Vendor Cash-Out',
    short: 'The share of the total raise that goes to existing owners, not the company.',
    plain:
      'This splits the total IPO into two buckets: money that funds the business, and money that pays existing shareholders. If RM47 million is raised and RM17.6 million goes to the founders, the cash-out portion is roughly 37%.',
    whyItMatters:
      'It reveals the purpose of the listing. Mostly new money suggests raising capital to grow; mostly vendor sales suggests providing an exit for insiders.',
    ruleOfThumb:
      'Above about 50% going to existing owners deserves a closer look at their reasons and at how much they still hold afterwards.',
  },

  balloting: {
    term: 'Balloting',
    short: 'A lottery that decides which retail applicants get shares.',
    plain:
      'Only a small slice of an IPO is set aside for ordinary members of the public. When more people apply than there are shares available, allocation is decided by random ballot, so applying does not guarantee you get any.',
    whyItMatters:
      'For a popular IPO your chance of being allotted can be low, and applying for more shares does not necessarily improve your odds much. Check the size of the retail pool before assuming you will get in.',
  },

  retailBallotPct: {
    term: 'Retail Ballot Pool',
    short: 'How much of the company is actually available to ordinary investors.',
    plain:
      'Most IPO shares go to institutions and approved private placement investors. The portion reserved for the general Malaysian public via balloting is often only a few percent of the company.',
    whyItMatters:
      'A small retail pool means heavy competition and low allotment odds. It also means fewer shares in public hands at listing, which can make early trading more volatile.',
  },

  bumiputeraAllocation: {
    term: 'Bumiputera Allocation / MITI Approval',
    short: 'Shares reserved for Bumiputera investors under Malaysian policy.',
    plain:
      'Malaysian listing rules require a portion of shares to be offered to Bumiputera investors, some through public balloting and some through private placement to investors approved by the Ministry of Investment, Trade and Industry (MITI).',
    whyItMatters:
      'It is a regulatory requirement rather than a signal of quality. It does affect how many shares are left for everyone else in the general retail ballot.',
  },

  moratorium: {
    term: 'Moratorium (Lock-Up)',
    short: 'A period when insiders are legally barred from selling their shares.',
    plain:
      'Bursa rules stop founders and major shareholders from dumping their shares immediately after listing. Typically the full stake is locked for six months, then a large portion stays locked for another six, after which it is released gradually.',
    whyItMatters:
      'It protects you from insiders selling out on day one. It also means the expiry dates are worth noting — a wave of shares can become sellable when a lock-up ends, which sometimes pressures the price.',
  },

  underwriting: {
    term: 'Underwriting',
    short: 'A bank guarantees to buy unsold shares.',
    plain:
      'An underwriter promises that if the public does not take up all the shares on offer, it will buy the leftovers itself. This assures the company it will get its money regardless of demand.',
    whyItMatters:
      'It means the IPO will almost certainly complete. It does not mean the offer is attractive — only that the shortfall risk sits with the underwriter rather than the company.',
  },

  // --- Profit & loss --------------------------------------------------------
  revenue: {
    term: 'Revenue',
    short: 'Total money coming in from sales, before any costs.',
    plain:
      'Also called turnover or "top line". It is everything billed to customers before paying for materials, wages, rent, interest or tax. A company can have huge revenue and still lose money.',
    whyItMatters:
      'Growing revenue shows demand and scale. But on its own it says nothing about profitability — always read it alongside the margins.',
  },

  grossProfit: {
    term: 'Gross Profit (GP)',
    short: 'Revenue minus the direct cost of doing the work.',
    plain:
      'For a builder, this is contract value minus materials, subcontractors and site labour. It excludes head-office costs like management salaries, marketing and interest.',
    whyItMatters:
      'It shows whether the core work is priced profitably. If gross profit is thin, there is very little cushion left to cover overheads and still make money.',
  },

  gpMargin: {
    term: 'Gross Profit Margin',
    short: 'Gross profit as a percentage of revenue.',
    plain:
      'If a company bills RM100 and the direct costs are RM85, the gross margin is 15%. It answers: out of every ringgit of sales, how much is left after paying for the actual work?',
    whyItMatters:
      'The trend matters more than the level. A rising margin suggests better pricing power or efficiency; a falling margin suggests cost pressure or bidding too cheaply to win work.',
    ruleOfThumb:
      'Construction and contracting typically run thin, often 8%–18%. Software and branded products run far higher. Compare only within the same industry.',
  },

  pbt: {
    term: 'PBT (Profit Before Tax)',
    short: 'Profit after all costs but before paying tax.',
    plain:
      'This is what is left once every expense — direct costs, salaries, rent, depreciation and loan interest — has been deducted, but before the tax authority takes its share.',
    whyItMatters:
      'It shows operating performance without the distortion of tax incentives or one-off tax items, which makes year-on-year comparison a bit cleaner.',
  },

  pat: {
    term: 'PAT (Profit After Tax)',
    short: 'The final profit, after everything including tax. The "bottom line".',
    plain:
      'This is the real profit that belongs to shareholders once all costs and taxes are paid. It is the number that earnings per share is calculated from.',
    whyItMatters:
      'This is the profit you are buying a claim on. The PE multiple is built directly from it, so the quality and consistency of PAT drives the whole valuation.',
  },

  patMargin: {
    term: 'Net Profit Margin (PAT Margin)',
    short: 'Final profit as a percentage of revenue.',
    plain:
      'Out of every RM100 of sales, how many ringgit end up as actual profit? A 4% net margin means RM4 from every RM100 billed. Thin margins mean small cost overruns can wipe out profit entirely.',
    whyItMatters:
      'It measures how much of all that activity actually turns into money for shareholders, and how much resilience the business has if costs rise unexpectedly.',
  },

  eps: {
    term: 'EPS (Earnings Per Share)',
    short: 'Profit divided by the number of shares, usually shown in sen.',
    plain:
      'If a company earns RM14 million and has 560 million shares, each share earned about 2.5 sen. It converts total profit into a per-share figure you can compare against the price you pay.',
    whyItMatters:
      'EPS is the engine of the PE multiple. One caveat: prospectuses normally compute EPS on the post-IPO share count, which makes it look smaller than the company\'s historical EPS — that is the correct, conservative basis.',
  },

  cagr: {
    term: 'CAGR (Compound Annual Growth Rate)',
    short: 'The average yearly growth rate over several years.',
    plain:
      'It smooths a bumpy multi-year journey into one steady annual growth figure. Going from RM220 million to RM324 million over three years works out to roughly 14% per year compounded.',
    whyItMatters:
      'It lets you compare growth across companies with different time spans. Watch out though: a single exceptional year can flatter the average, so check the year-by-year numbers too.',
  },

  marginTrend: {
    term: 'Margin Trend',
    short: 'Whether profitability is improving or being squeezed over time.',
    plain:
      'Rather than one year\'s margin, this looks at the direction across all reported periods. Margins that climb steadily suggest growing strength; margins that slip while revenue grows suggest the company is buying growth by cutting prices.',
    whyItMatters:
      'Revenue growth with falling margins is a classic warning pattern — the company gets busier without getting richer.',
  },

  stubPeriod: {
    term: 'FPE / Stub Period',
    short: 'A part-year of results, not a full 12 months.',
    plain:
      'FYE means "financial year ended" — a complete year. FPE means "financial period ended" — a shorter stretch, often a few months, included to bring the figures close to the IPO date.',
    whyItMatters:
      'Never compare a stub period directly against a full year: it will look artificially small. Seasonality also means you cannot simply multiply it up to estimate a full year.',
  },

  // --- Balance sheet & health ----------------------------------------------
  gearing: {
    term: 'Gearing Ratio',
    short: 'How much the company owes compared to what shareholders own.',
    plain:
      'Divide total borrowings by shareholders\' equity. A gearing of 3 times means the company has borrowed RM3 for every RM1 the owners have put in. Think of a house bought with a RM100,000 deposit and a RM300,000 loan — heavily geared. Debt boosts returns when business is good and accelerates losses when it is not.',
    whyItMatters:
      'High gearing means interest must be paid regardless of whether projects go well, and leaves little slack if revenue dips. It is a major reason companies list — to raise equity and bring gearing down.',
    ruleOfThumb:
      'Under 1× is generally comfortable, 1×–2× is manageable, and above 2× is high and deserves scrutiny of whether cash flow reliably covers interest.',
  },

  borrowings: {
    term: 'Borrowings',
    short: 'Total interest-bearing debt owed to banks and lenders.',
    plain:
      'All loans, overdrafts, term facilities and hire-purchase obligations on which the company pays interest. It excludes money owed to suppliers, which is normally interest-free trade credit.',
    whyItMatters:
      'Debt has to be serviced in bad years as well as good. Seeing how much IPO money goes to repaying borrowings tells you how much of your investment funds growth versus repairing the balance sheet.',
  },

  currentRatio: {
    term: 'Current Ratio',
    short: 'Whether short-term assets cover short-term bills.',
    plain:
      'Divide assets expected to turn into cash within a year (cash, receivables, inventory) by bills due within a year. A ratio of 1.0 means they exactly match, with no cushion. Below 1.0 means short-term obligations exceed short-term resources.',
    whyItMatters:
      'It is a basic liquidity check. A company can be profitable on paper yet still struggle to pay suppliers on time, which in construction can stall projects.',
    ruleOfThumb:
      'Around 1.5× or more is comfortable. Near 1.0× is tight. Below 1.0× warrants a careful read of the cash flow statement and available banking facilities.',
  },

  workingCapital: {
    term: 'Working Capital',
    short: 'Day-to-day cash needed to keep operations running.',
    plain:
      'The money tied up in running the business — paying wages, buying materials and waiting for customers to settle invoices. Project businesses often have to spend heavily long before they get paid.',
    whyItMatters:
      'When IPO proceeds are earmarked for working capital, it funds existing operations rather than new capacity. Useful and often necessary, but it is not growth spending.',
  },

  receivablesDays: {
    term: 'Trade Receivables Turnover (Days)',
    short: 'How long customers take to pay, on average.',
    plain:
      'If this is 60 days, the company waits about two months after invoicing before the cash arrives. Meanwhile it still has to pay its own workers and suppliers.',
    whyItMatters:
      'Shorter is better — it means cash comes in faster and less is tied up. A lengthening trend can signal customers in difficulty or weak collection discipline, both of which strain cash flow.',
    ruleOfThumb:
      'Construction commonly runs 60–120 days because of progress billing and retention. A falling trend is a genuinely good sign.',
  },

  retentionSum: {
    term: 'Retention Sum',
    short: 'Money the customer holds back until the work is proven sound.',
    plain:
      'Clients typically withhold a small percentage of each payment — often around 5% — until the defect liability period ends, as security that any faults will be fixed. The contractor has done the work but cannot collect this slice for months or years.',
    whyItMatters:
      'Retention sums lock up cash and are sometimes never fully recovered if disputes arise over defects. They are a real, recurring cash-flow drag in construction.',
  },

  proForma: {
    term: 'Pro Forma',
    short: '"What the accounts would look like if" — a simulated snapshot.',
    plain:
      'Pro forma figures adjust real audited accounts to show the effect of events that have not happened yet, such as receiving IPO money and spending it as planned. They are illustrative, not actual results.',
    whyItMatters:
      'They show the balance sheet you are actually buying into after the IPO, which is usually much healthier than the historical one — especially where proceeds repay debt.',
  },

  // --- Operations -----------------------------------------------------------
  orderBook: {
    term: 'Order Book / Unbilled Contract Value',
    short: 'Work already won but not yet billed — future revenue in hand.',
    plain:
      'Contracts have been signed and the work is committed, but it has not been carried out and invoiced yet. For a builder with RM1 billion unbilled, that revenue will be recognised gradually as construction progresses over the coming years.',
    whyItMatters:
      'It is the clearest view of near-term revenue visibility. A large order book means the company is not starting from zero next year — though it still must execute profitably and on time.',
  },

  orderBookCoverage: {
    term: 'Order Book Coverage',
    short: 'How many years of revenue are already secured.',
    plain:
      'Divide the order book by the most recent full year\'s revenue. An order book of RM1 billion against RM324 million of annual revenue gives roughly three years of work already in hand.',
    whyItMatters:
      'It converts a big, abstract order-book number into something intuitive. More than two years of coverage generally means decent visibility; under one year means the company depends heavily on winning new work immediately.',
    ruleOfThumb:
      'Over 2 years is comfortable for a contractor, 1–2 years is adequate, under 1 year means near-term revenue depends on fresh wins.',
  },

  customerConcentration: {
    term: 'Customer Concentration',
    short: 'How much revenue depends on just a handful of customers.',
    plain:
      'If the top five customers account for 80% of sales, losing even one could hit revenue badly. Many project-based companies are naturally concentrated because individual contracts are large.',
    whyItMatters:
      'It is one of the most underrated IPO risks. High concentration means less negotiating power on price and serious exposure if a key client stops awarding work or runs into trouble.',
    ruleOfThumb:
      'Above 70% from the top five is high concentration; 40%–70% is moderate; below 40% is well diversified.',
  },

  proceedsToGrowth: {
    term: 'Proceeds to Growth',
    short: 'The share of IPO money actually spent on expanding the business.',
    plain:
      'Splits the company\'s share of the raise into growth spending (machinery, capacity, technology) versus everything else (repaying loans, day-to-day working capital, and the cost of listing itself).',
    whyItMatters:
      'Money spent on new capacity can generate future profits. Money spent repaying debt strengthens the balance sheet but adds no new earning power, and listing expenses simply disappear.',
    ruleOfThumb:
      'Above roughly half going to genuine growth is encouraging. A low figure is not automatically bad — cutting heavy debt can be sensible — but you should know which you are funding.',
  },

  employees: {
    term: 'Employee Count',
    short: 'Number of people the company employs.',
    plain:
      'Headcount at the latest reporting date. In construction, note that much of the actual labour is often supplied by subcontractors rather than direct employees.',
    whyItMatters:
      'Revenue per employee gives a rough sense of how labour-intensive and efficient the operation is, and how heavily it leans on subcontracting.',
  },

  // --- Ownership & governance ----------------------------------------------
  promoter: {
    term: 'Promoter',
    short: 'A founder or key person behind bringing the company to market.',
    plain:
      'Promoters are the individuals who built the business and are driving the listing — usually the founder and close family or long-standing partners. They typically hold the largest stakes.',
    whyItMatters:
      'Promoters usually run the company day to day. Their track record, and how much of their own wealth stays invested after listing, tells you a lot about alignment with new shareholders.',
  },

  substantialShareholder: {
    term: 'Substantial Shareholder',
    short: 'Anyone holding 5% or more of the company.',
    plain:
      'Malaysian rules require disclosure once a holding reaches 5%, because at that size a shareholder can meaningfully influence decisions and voting outcomes.',
    whyItMatters:
      'Knowing who holds large stakes shows where real control sits, and whether decisions are likely to be dominated by one person or a family.',
  },

  founderRetained: {
    term: 'Founder Retained Stake',
    short: 'How much of the company the founder still owns after the IPO.',
    plain:
      'The IPO dilutes the founder\'s percentage because new shares are created and some existing shares are sold. What remains shows how much personal wealth is still tied to the company\'s performance.',
    whyItMatters:
      'A founder keeping a large stake stays strongly motivated to make the business succeed — their interests line up with yours. A sharply reduced stake is worth questioning.',
    ruleOfThumb:
      'Above 50% means continued control and strong alignment, though it also means minority shareholders have limited ability to outvote them.',
  },

  independentDirector: {
    term: 'Independent Director',
    short: 'A board member with no management role or business ties.',
    plain:
      'Independent directors are outsiders appointed to challenge management objectively and protect all shareholders, including small ones. They do not work in the business or depend on it financially.',
    whyItMatters:
      'A board dominated by insiders offers weaker checks on decisions like related-party deals. More independent voices generally means better governance for minority investors.',
    ruleOfThumb:
      'Bursa requires at least one-third of the board to be independent.',
  },

  // --- Returns & policy -----------------------------------------------------
  dividendPolicy: {
    term: 'Dividend Policy',
    short: 'Whether the company commits to paying out part of its profits.',
    plain:
      'A formal policy states a target — for example, paying out 30% of annual profit. Many newly listed companies deliberately avoid committing, preferring to reinvest cash into growth.',
    whyItMatters:
      'No formal policy means you should not count on dividend income; your return would depend entirely on the share price rising. Past dividends paid before listing are not a reliable guide to future ones.',
  },

  // --- Market & regulatory -------------------------------------------------
  aceMarket: {
    term: 'ACE Market',
    short: 'Bursa Malaysia\'s board for smaller, growing companies.',
    plain:
      'ACE has lighter entry requirements than the Main Market, so it suits younger or smaller businesses. Companies can later transfer to the Main Market once they meet its stricter profit and size tests.',
    whyItMatters:
      'ACE companies are typically smaller and can be more volatile and less liquid. The lighter admission bar means the burden of due diligence sits more heavily on you.',
  },

  mainMarket: {
    term: 'Main Market',
    short: 'Bursa Malaysia\'s primary board for larger, established companies.',
    plain:
      'The Main Market sets higher thresholds for profit history, size and public spread. Malaysia\'s biggest and best-known listed companies sit here.',
    whyItMatters:
      'Main Market listings are generally larger and more liquid, with a longer proven track record than ACE companies.',
  },

  lpd: {
    term: 'LPD (Latest Practicable Date)',
    short: 'The cut-off date for information in the prospectus.',
    plain:
      'Preparing a prospectus takes months, so the law requires a stated cut-off — the latest practicable date — for figures like the order book and shareholdings. Anything after that is not reflected.',
    whyItMatters:
      'Some information may already be weeks or months old by the time you read it. Check the LPD to know how current the figures actually are.',
  },

  liquidatedDamages: {
    term: 'Liquidated Damages (LD)',
    short: 'A penalty for finishing a project late.',
    plain:
      'Construction contracts usually fix a daily or weekly penalty if the contractor misses the completion deadline. The amount is agreed upfront, so the client does not need to prove actual loss.',
    whyItMatters:
      'Late projects directly reduce profit through these penalties. A history of paying LD suggests weaknesses in project scheduling or delivery.',
  },

  defectsLiability: {
    term: 'Defects Liability Period (DLP)',
    short: 'The window after handover when the builder must fix faults free.',
    plain:
      'After a project is certified complete, the contractor remains responsible for rectifying defects for an agreed period — commonly 12 to 30 months — at its own cost.',
    whyItMatters:
      'Rectification costs come out of profit that was already booked, and the client holds retention money until the period ends. Poor build quality can therefore reverse earlier profits.',
  },

  cidbG7: {
    term: 'CIDB G7 Grade',
    short: 'The highest Malaysian contractor licence — no project size limit.',
    plain:
      'Malaysia\'s Construction Industry Development Board grades contractors from G1 to G7 by capability and paid-up capital. G7 is the top grade and carries no cap on tender value.',
    whyItMatters:
      'G7 status means the company can bid for the largest projects, which widens its opportunity set. It is a licensing threshold, not a guarantee of profitability.',
  },
};

/** Safe lookup used by the tooltip component. */
export function lookup(key: string | undefined): GlossaryEntry | null {
  if (!key) return null;
  return GLOSSARY[key] ?? null;
}

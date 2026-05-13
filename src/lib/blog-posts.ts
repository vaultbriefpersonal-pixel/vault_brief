export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  date: string;
  readTime: string;
  featured?: boolean;
  content: BlogSection[];
}

export interface BlogSection {
  type: "lead" | "p" | "h2" | "code" | "cta";
  text?: string;
  code?: string;
}

export const POSTS: BlogPost[] = [
  {
    slug: "how-to-calculate-runway-crypto-treasury",
    title: "How to Calculate Runway When Your Treasury is 80% Native Token",
    excerpt:
      "Most founders get this wrong. If your runway calculation assumes you can liquidate your native token at current prices, you are probably overestimating by 2-3x.",
    category: "Treasury Management",
    date: "April 28, 2026",
    readTime: "6 min read",
    // Demoted from featured — the v3 lead is the top-of-funnel piece
    // "Why Web3 Investor Reporting Is Still Broken" so it gets the
    // featured slot.
    content: [
      {
        type: "lead",
        text: "Most founders get this wrong. If your runway calculation assumes you can liquidate your native token at current prices, you are probably overestimating by 2-3x.",
      },
      {
        type: "p",
        text: "When your treasury is predominantly composed of your own project token, traditional runway calculations break down. Liquidating large positions moves the market against you, and the price you see on CoinGecko today is not the price you will actually realize.",
      },
      { type: "h2", text: "The liquidity-adjusted approach" },
      {
        type: "p",
        text: "Instead of using spot price, estimate what percentage of your token holdings you can realistically liquidate over a 30-day window without moving the price more than 15%. Most projects should assume they can access 20-40% of their native token position per month through OTC, DEX, or programmatic selling.",
      },
      {
        type: "code",
        code: "Effective treasury = Stablecoins + ETH + (Native token * 0.30)\nRunway = Effective treasury / Monthly burn rate",
      },
      {
        type: "p",
        text: "This gives you a more honest picture of how much time you actually have. Share this number with your investors — they will respect the transparency more than an inflated figure.",
      },
      { type: "h2", text: "Where Vault Brief fits today" },
      {
        type: "p",
        text: "Vault Brief surfaces the nominal runway from each snapshot — total treasury value divided by trailing monthly burn — so the headline figure is consistent month to month. We don't apply a fixed liquidity haircut on the native-token position automatically (token liquidity profiles vary too much between projects to hard-code a number), but the executive summary is prompted to surface the haircut question explicitly when native-token exposure is the majority of the treasury, and you can adjust the narrative inline before sending the report.",
      },
    ],
  },
  {
    slug: "investor-update-frequency-web3",
    title: "How Often Should Web3 Projects Send Investor Updates?",
    excerpt:
      "Monthly is the sweet spot. Less than that and investors lose confidence. More than that and you waste engineering time on reporting.",
    category: "Investor Relations",
    date: "April 15, 2026",
    readTime: "4 min read",
    content: [
      {
        type: "lead",
        text: "Monthly is the sweet spot. Less than that and investors lose confidence. More than that and you waste engineering time on reporting.",
      },
      {
        type: "p",
        text: "Looking at public investor-update cadences across active crypto projects, the pattern is consistent: teams that report monthly stay top-of-mind with their cap table and surface problems early. Quarterly reporters tend to slip into half-yearly, and by then investors are filling the information gap with their own assumptions — usually the worst ones.",
      },
      { type: "h2", text: "What to include every month" },
      {
        type: "p",
        text: "A good monthly investor update covers four things: treasury balance and runway, burn rate and what drove it, development progress (commits, releases, milestones), and a short founder narrative on what changed and why. Anything beyond that is noise. Your investors are busy — a tight, data-backed 2-page update is better than a 10-page deck.",
      },
      { type: "h2", text: "The consistency problem" },
      {
        type: "p",
        text: "Most projects start with good intentions and slip to quarterly by month three. The reason is always the same: pulling treasury data manually takes 4-6 hours every month. When you are under deadline pressure, reporting gets deprioritized. The solution is not more discipline — it is automation.",
      },
      {
        type: "p",
        text: "Vault Brief generates your monthly report automatically from on-chain data on the 1st of every month. You review, add a personal note, and send. The whole process takes 15 minutes instead of half a day.",
      },
    ],
  },
  {
    slug: "multi-chain-treasury-tracking-guide",
    title: "The Complete Guide to Multi-Chain Treasury Tracking in 2026",
    excerpt:
      "Managing funds across Ethereum, Arbitrum, Solana, and Base is genuinely painful. Here is how we think about it.",
    category: "Treasury Management",
    date: "April 3, 2026",
    readTime: "9 min read",
    content: [
      {
        type: "lead",
        text: "Managing funds across Ethereum, Arbitrum, Solana, and Base is genuinely painful. Most treasury tools only cover one chain. Here is how to think about it properly.",
      },
      {
        type: "p",
        text: "By 2026, most active DeFi projects operate across at least three chains. The reasons vary — lower gas costs on L2s, user bases on Solana, liquidity pools on Base. But the treasury complexity compounds quickly. A project with wallets on five chains needs five different block explorers, five CSV exports, and manual reconciliation every time they want a balance sheet.",
      },
      { type: "h2", text: "The core challenge: unified accounting" },
      {
        type: "p",
        text: "The fundamental problem is that on-chain accounting is address-based, not entity-based. Your company is one entity, but it might have 12 wallet addresses across six chains. Getting a single number for 'how much do we have' requires aggregating balances, converting to a common currency, and accounting for in-flight transactions. Most projects handle this in Google Sheets and update it manually once a month.",
      },
      { type: "h2", text: "What to track" },
      {
        type: "p",
        text: "For each chain, you need: native token balances, ERC-20 / SPL token positions, LP positions (if any), and vesting contract balances. The last one is often forgotten — tokens sitting in a vesting contract are illiquid and should be excluded from your operational runway calculation.",
      },
      { type: "h2", text: "Stablecoins as the anchor" },
      {
        type: "p",
        text: "Treat your stablecoin balance as the ground truth for runway. ETH and SOL can be included at a conservative discount (typically 60-70% of current price). Native tokens should be discounted heavily based on your realistic liquidation capacity. A simple rule: stablecoins count at 100%, blue-chips at 65%, native token at 25-35%.",
      },
    ],
  },
  {
    slug: "burn-rate-vs-runway-difference",
    title: "Burn Rate vs Runway: What Crypto Investors Actually Want to See",
    excerpt:
      "Your investors care less about the number and more about the trend. Here is how to frame your burn metrics to build confidence.",
    category: "Investor Relations",
    date: "March 22, 2026",
    readTime: "5 min read",
    content: [
      {
        type: "lead",
        text: "Your investors care less about the absolute number and more about the trend. A $300K monthly burn is fine if it is falling. It is alarming if it has doubled in three months.",
      },
      {
        type: "p",
        text: "Burn rate and runway are the two numbers investors look at first in any treasury report. But how you present them matters as much as what they say. A raw number without context leaves investors to fill in their own narrative — and they will almost always assume the worst.",
      },
      { type: "h2", text: "Show the 3-month trend, not just the current month" },
      {
        type: "p",
        text: "A single month's burn rate is meaningless without context. Always show the trailing three months alongside the current month. If burn is increasing, explain why — hiring, infrastructure, marketing campaign. If it is decreasing, highlight that proactively. Investors remember when founders get ahead of bad news.",
      },
      { type: "h2", text: "Break down burn by category" },
      {
        type: "p",
        text: "Total burn broken into payroll, infrastructure, marketing, and other is dramatically more useful than a single number. It shows operational maturity and lets investors see where money is actually going. Most projects avoid this level of detail because it is tedious to compile. That is exactly why doing it builds trust — it signals you have your house in order.",
      },
      { type: "h2", text: "Runway: give a range, not a point" },
      {
        type: "p",
        text: "Instead of '14 months runway', say '12-16 months depending on hiring pace'. This is more honest and shows you have modeled different scenarios. Investors who have seen many portfolio companies fail know that point estimates are fiction — a range tells them you understand your own uncertainty.",
      },
    ],
  },
  {
    slug: "gnosis-safe-reporting",
    title: "Reporting Treasury Data from Gnosis Safe: A Practical Guide",
    excerpt:
      "Multisig wallets add complexity to financial reporting. We cover how to pull accurate data and avoid common pitfalls.",
    category: "Web3 Finance",
    date: "March 10, 2026",
    readTime: "7 min read",
    content: [
      {
        type: "lead",
        text: "Gnosis Safe is the standard for institutional crypto treasury management, but it adds real complexity to financial reporting. Here is how to get accurate data without going mad.",
      },
      {
        type: "p",
        text: "Safe's transaction model is fundamentally different from an EOA. Internal transactions, batch calls, delegate calls, and module interactions all appear differently in block explorer data. A simple 'export CSV from Etherscan' workflow breaks down immediately when you try to categorize Safe transactions.",
      },
      { type: "h2", text: "Use the Safe Transaction Service API" },
      {
        type: "p",
        text: "The most reliable way to get structured data from a Safe is the official Safe Transaction Service API (transaction.safe.global). It gives you decoded transaction data, signers, execution status, and historical queued transactions. Unlike raw RPC calls or explorer scraping, it is consistent across chains and handles all Safe-specific transaction types correctly.",
      },
      { type: "h2", text: "Handling multi-asset transfers" },
      {
        type: "p",
        text: "A single Safe transaction can move multiple tokens in one on-chain call. Most reporting tools treat this as one transaction and miss the individual line items. You need to parse the internal transfer events from the transaction receipt to get accurate per-asset accounting. This is where most manual reporting goes wrong.",
      },
      { type: "h2", text: "How Vault Brief handles Safe wallets today" },
      {
        type: "p",
        text: "Today, Vault Brief reads Safe multisig balances and transaction history through Alchemy and Dune Sim — the same path used for any EVM treasury address. Internal-transfer parsing and Safe-specific categorisation (signers, queued transactions, module calls) is on the near-term roadmap; for now Safe transactions are reported as standard ERC-20 / native transfers, which is enough for the treasury-balance and inflow / outflow numbers most monthly reports need. If you operate a Safe and need richer Safe-aware parsing, drop us a note at hello@vaultbrief.io — that input directly shapes the prioritisation.",
      },
    ],
  },
  {
    slug: "vaultbrief-changelog-march-2026",
    title: "What We Shipped in March: Base Chain, Expense Classification, and Faster PDFs",
    excerpt:
      "Base chain support, an upgraded expense classifier across DeFi categories, and a 4x cut in PDF render time. The March release in three bullets.",
    category: "Product Updates",
    date: "March 31, 2026",
    readTime: "3 min read",
    content: [
      {
        type: "lead",
        text: "March was a release-quality month — no new headline features, but three things that materially change the day-to-day experience: Base support, better expense categorisation, and PDFs that render in under three seconds.",
      },
      { type: "h2", text: "Base chain support" },
      {
        type: "p",
        text: "Wallet addresses on Base now sync automatically alongside Ethereum, Arbitrum, Optimism, Polygon, and Solana. If you have a treasury contract that operates across L2s, you can add the same address per chain and Vault Brief will aggregate the balances and flows into a single project view. No separate setup, no extra plan tier needed.",
      },
      { type: "h2", text: "Improved expense classification" },
      {
        type: "p",
        text: "Our expense classifier got a fresh training pass focused on DeFi-native transaction shapes — staking deposits, LP position changes, protocol fee distributions, governance token claims. Categorisation accuracy on those moved up materially. If you spot a transaction we still mislabel, fix it in the editor; the correction informs how that pattern is classified for your project next time.",
      },
      { type: "h2", text: "PDF rendering, 4x faster" },
      {
        type: "p",
        text: "Investor-ready PDFs now generate in under three seconds, down from twelve to fifteen seconds in the previous release. The win comes from dropping the headless Chromium round-trip in favour of @react-pdf/renderer running directly on the server. Click \"Download PDF\" and the file is in your downloads before you've moved your mouse.",
      },
      {
        type: "p",
        text: "Up next in April: GitHub org integration and custom report branding. Watch the /changelog page for the full release log.",
      },
    ],
  },
  {
    slug: "why-web3-investor-reporting-is-still-broken",
    title: "Why Web3 Investor Reporting Is Still Broken",
    excerpt:
      "Web3 teams have public financial data, public development activity, and public token metrics. Reporting should be easier than in Web2. In practice, it is often messier.",
    category: "Investor Relations",
    date: "May 2026",
    readTime: "5 min read",
    featured: true,
    content: [
      {
        type: "lead",
        text: "Web3 teams have public financial data, public development activity, and public token metrics. Reporting should be easier than in Web2. In practice, it is often messier.",
      },
      {
        type: "p",
        text: "Web3 should have better investor reporting than traditional startups. Most treasury activity is on chain. Development activity often lives on GitHub. Token metrics are public. DAO activity, governance, and ecosystem growth can usually be tracked without asking the team for a spreadsheet.",
      },
      {
        type: "p",
        text: "And yet, monthly investor updates are still painful. Founders copy balances from block explorers. They manually check stablecoin exposure. They estimate burn from outgoing transactions. They pull GitHub activity by hand. They paste token charts into decks. Then they turn all of that into a report investors can understand.",
      },
      {
        type: "p",
        text: "The data exists. The workflow is broken.",
      },
      { type: "h2", text: "The main problem is fragmentation" },
      {
        type: "p",
        text: "A Web3 project can have treasury wallets across Ethereum, Base, Arbitrum, Solana, Polygon, and other chains. Each wallet may hold stablecoins, native assets, governance tokens, vested tokens, or LP positions. Some spending happens on chain. Some happens off chain. GitHub activity sits in another system. Token metrics sit somewhere else. Narrative context sits in the founder's head.",
      },
      { type: "h2", text: "This creates three problems" },
      {
        type: "p",
        text: "First, reporting takes too much time. A founder or ops lead can easily spend half a day every month collecting numbers before writing a single sentence. That is wasted attention.",
      },
      {
        type: "p",
        text: "Second, reports become inconsistent. One month the team reports runway. Next month they forget. One month they include GitHub progress. Next month they only mention product milestones. Investors receive updates, but not a reliable reporting format.",
      },
      {
        type: "p",
        text: "Third, investors get less signal. Raw data is not enough. Investors need to know what changed, why it changed, and what the team is doing next. A wallet balance alone does not explain burn quality, runway risk, hiring pace, product progress, or token exposure.",
      },
      { type: "h2", text: "Good Web3 reporting should combine five layers" },
      {
        type: "p",
        text: "1. Treasury overview — how much capital does the project control, where is it held, and how did it change?",
      },
      {
        type: "p",
        text: "2. Burn and runway — how much was spent, what categories drove spending, and how long can the team operate at current burn?",
      },
      {
        type: "p",
        text: "3. Token metrics — how did token price, liquidity, holders, and market cap change during the period?",
      },
      {
        type: "p",
        text: "4. Development progress — what shipped, who contributed, and how active was the engineering pipeline?",
      },
      {
        type: "p",
        text: "5. Executive narrative — what changed this month, why it matters, and what comes next?",
      },
      { type: "h2", text: "This is exactly where automation helps" },
      {
        type: "p",
        text: "The goal is not to remove the founder from reporting. The goal is to remove copy-paste work. The founder should review, correct, and approve the final report. But the first structured report should be generated from the source data automatically.",
      },
      {
        type: "p",
        text: "That is the direction Web3 investor reporting needs to move toward. Less manual spreadsheet work. More source-based reporting. More consistency. More context. Better investor trust.",
      },
    ],
  },
  {
    slug: "what-investors-want-in-a-web3-monthly-update",
    title: "What Investors Want in a Web3 Monthly Update",
    excerpt:
      "A good Web3 investor update is not a marketing post. It is a clear operating report that explains treasury, runway, product progress, and risks.",
    category: "Investor Relations",
    date: "May 2026",
    readTime: "6 min read",
    content: [
      {
        type: "lead",
        text: "A good Web3 investor update is not a marketing post. It is a clear operating report that explains treasury, runway, product progress, and risks.",
      },
      {
        type: "p",
        text: "Most investor updates are too vague. They say the team is building. They mention partnerships. They include a few product screenshots. They say the market is volatile. Then they end with a positive closing note.",
      },
      {
        type: "p",
        text: "That is not enough. Investors want signal. They want to understand whether the project is financially healthy, whether the team is shipping, whether the roadmap is realistic, and whether new risks appeared during the month.",
      },
      {
        type: "p",
        text: "For Web3 teams, a strong monthly investor report should include six sections.",
      },
      { type: "h2", text: "1. Executive summary" },
      {
        type: "p",
        text: "Start with the most important changes. What happened this month? What improved? What got worse? What should investors pay attention to? This section should be short and explain the month in plain English.",
      },
      { type: "h2", text: "2. Treasury overview" },
      {
        type: "p",
        text: "Investors need to understand the project's financial position: total treasury balance, stablecoin balance, native asset exposure, token exposure, monthly inflows, monthly outflows, change from previous month.",
      },
      {
        type: "p",
        text: "Asset composition matters. A treasury with 80 percent stablecoins is very different from a treasury mostly exposed to volatile native tokens.",
      },
      { type: "h2", text: "3. Burn and runway" },
      {
        type: "p",
        text: "Treasury balance is incomplete without burn. A good report should explain monthly burn, largest spending categories, change versus previous period, estimated runway, and any unusual expenses. Runway is one of the clearest investor signals — if it changes materially, explain why.",
      },
      { type: "h2", text: "4. Product and engineering progress" },
      {
        type: "p",
        text: "Investors do not need every commit. They need proof that the team is moving. Useful GitHub metrics: commits, merged pull requests, active contributors, releases, major technical milestones. This section should translate development activity into business context.",
      },
      { type: "h2", text: "5. Token and market context" },
      {
        type: "p",
        text: "For tokenized projects, token data belongs in the report: price, market cap, holder count, liquidity context, circulating supply changes, major unlocks. Don't turn this into price commentary — explain material changes that affect project perception, treasury value, or stakeholder confidence.",
      },
      { type: "h2", text: "6. Risks and next steps" },
      {
        type: "p",
        text: "Good reporting is not only positive. Investors respect clarity. If burn increased, explain why. If a launch slipped, explain what changed. If liquidity weakened, say so. A clear risk section builds more trust than vague optimism.",
      },
      { type: "h2", text: "Consistency is what most teams are missing" },
      {
        type: "p",
        text: "The best reports use the same structure every month. They show comparable metrics. They explain changes. They separate facts from narrative. The data is already there. The hard part is turning it into a report investors can read quickly and trust.",
      },
    ],
  },
  {
    slug: "from-wallets-to-investor-reports",
    title: "From Wallets to Investor Reports",
    excerpt:
      "A treasury wallet is not a report. Investors need context, categories, runway, development progress, and a clear monthly narrative.",
    category: "Treasury Management",
    date: "May 2026",
    readTime: "6 min read",
    content: [
      {
        type: "lead",
        text: "A treasury wallet is not a report. Investors need context, categories, runway, development progress, and a clear monthly narrative.",
      },
      {
        type: "p",
        text: "A wallet balance tells you how much money exists at one moment. It does not explain what happened during the month. It does not explain why funds moved. It does not explain whether spending was healthy. It does not explain what the team shipped.",
      },
      {
        type: "p",
        text: "For a Web3 team, the reporting workflow usually starts with wallets. A founder, finance lead, or operations person opens block explorers, checks multisigs, copies balances, looks at token holdings, and tries to understand inflows and outflows. Then they repeat that across multiple chains. That is only the first layer.",
      },
      {
        type: "p",
        text: "The real value comes from turning wallet data into investor context.",
      },
      { type: "h2", text: "Step 1: Identify treasury wallets" },
      {
        type: "p",
        text: "The first input is a list of project-controlled wallets — multisigs, EOAs, exchange deposit addresses, or operational wallets. The important thing is clarity. A token contract is not the same as a treasury wallet. A treasury wallet holds project assets; a token contract represents the asset itself.",
      },
      { type: "h2", text: "Step 2: Capture balances" },
      {
        type: "p",
        text: "The report should show what the project holds now: stablecoins, native assets, project token, other tokens, LP positions where relevant. Stablecoin percentage is especially important because it gives a quick view of treasury stability.",
      },
      { type: "h2", text: "Step 3: Analyze flows" },
      {
        type: "p",
        text: "Balances alone are not enough. The report should show inflows, outflows, net change, large transactions, recurring spending, and unusual movements. This helps investors understand whether treasury movement came from revenue, grants, fundraising, market movement, operational spending, or one-time events.",
      },
      { type: "h2", text: "Step 4: Estimate burn and runway" },
      {
        type: "p",
        text: "Burn turns wallet activity into an operating metric. If a project spent $180,000 this month and holds $2.4 million in usable assets, the runway conversation becomes concrete. Investors can understand whether the team is moving efficiently or running too hot.",
      },
      { type: "h2", text: "Step 5: Add development activity" },
      {
        type: "p",
        text: "Treasury reports are stronger when paired with building progress. If burn increased because the team hired engineers and shipped major releases, that is different from burn increasing without visible output. GitHub activity adds useful signal: commits, pull requests, contributors, releases, major shipped features.",
      },
      { type: "h2", text: "Step 6: Add narrative" },
      {
        type: "p",
        text: "The final report should explain the month. What changed? Why did it change? What progress did the team make? What risks appeared? What happens next? This is where raw data becomes useful. A good investor report does not hide the numbers — it explains them.",
      },
      {
        type: "p",
        text: "That is the reporting standard Web3 teams should aim for: source-based data, consistent structure, clear narrative, and review before sharing. The best investor updates are not the longest ones. They are the clearest.",
      },
    ],
  },
  {
    slug: "monthly-investor-report-checklist-web3",
    title: "The Web3 Founder's Monthly Investor Report Checklist",
    excerpt:
      "Twelve concrete items every monthly investor update should answer — printable, source-tied, and built around the questions investors actually ask between board meetings.",
    category: "Investor Relations",
    date: "May 2026",
    readTime: "7 min read",
    content: [
      {
        type: "lead",
        text: "Investors don't read your monthly update to feel good about the project. They read it to answer a small, fixed set of questions before they have to think about you again next month. The checklist below covers those questions in the order they get asked.",
      },
      {
        type: "p",
        text: "Most founders treat the monthly update as a writing exercise. That's why they slip on it — writing is open-ended and feels easy to deprioritise. Treat it as a checklist instead. Each item below has a definite source (on-chain, GitHub, calendar, or a single sentence from you), so the report can be assembled in twenty minutes once the data is in front of you.",
      },
      { type: "h2", text: "Treasury, in three numbers" },
      {
        type: "p",
        text: "1. Total treasury value at period end, with month-over-month change. 2. Stablecoin balance — separate, because it's the only asset that doesn't move with the market. 3. Native-token share of the treasury as a percentage. If that number is above 70%, the runway conversation needs a haircut applied.",
      },
      { type: "h2", text: "Flows, in two numbers" },
      {
        type: "p",
        text: "4. Total inflows for the period (grants, token sales, revenue). 5. Total outflows broken down into operating categories (payroll, infra, marketing, grants, legal) plus a separate \"treasury operations\" line for token-sale rebalances. The reason for separating treasury ops is simple — investors who see a $2M outflow without context will assume burn, not rebalance.",
      },
      { type: "h2", text: "Runway, with a caveat" },
      {
        type: "p",
        text: "6. Trailing-three-month operating burn (not just this month — single months are noisy). 7. Months of runway at that burn, using the operationally-liquid portion of the treasury (stablecoins + a conservative haircut on native ETH, near-zero credit on the project's own token if it's thinly traded). A range is more honest than a point estimate.",
      },
      { type: "h2", text: "Engineering, in three signals" },
      {
        type: "p",
        text: "8. Commits and merged PRs across the engineering org for the period. 9. Active contributor count — proxy for headcount engagement. 10. One sentence on the major shipped item this month, with a public link if available (Etherscan tx, repo release, blog post). The first two come straight from GitHub; the third is the only piece you write fresh.",
      },
      { type: "h2", text: "Token, when relevant" },
      {
        type: "p",
        text: "11. If you have a public token: price change MoM, market cap, holder count delta, and the next vesting / unlock event with a date and percentage. Skip this section entirely if you don't have a public token — padding it with vague \"market context\" looks worse than not including it.",
      },
      { type: "h2", text: "The one thing investors will actually email about" },
      {
        type: "p",
        text: "12. A two-line \"asks\" section. New hire intros, BD intros to specific firms, a request to be added to a fund's portfolio dashboard. Investors who feel useful re-up next round. Investors who get pure-status updates feel like passengers and start to disengage.",
      },
      { type: "h2", text: "How to actually do this every month" },
      {
        type: "p",
        text: "Pick a fixed day (most teams find the 3rd works — late enough that the previous month is fully closed, early enough that the report lands while investors are still planning the new month). Generate the source data in one pass; write only the executive summary, the one-line major-ship, and the asks fresh. The other ten items are mechanical. Vault Brief automates the mechanical ones — leaving you with three sentences to write.",
      },
      {
        type: "cta",
        text: "Want this checklist as a Vault Brief report template? Sign up — the 14-day trial generates a real report for your treasury inside ten minutes.",
      },
    ],
  },
  {
    slug: "10-minute-web3-treasury-health-check",
    title: "How to Audit Your Web3 Treasury Health in 10 Minutes",
    excerpt:
      "A short, repeatable diagnostic. Open Etherscan, your GitHub org, and a calculator — answer five questions and you'll know whether your treasury is in a defensible position before the next investor email lands.",
    category: "Treasury Management",
    date: "May 2026",
    readTime: "5 min read",
    content: [
      {
        type: "lead",
        text: "You don't need a full monthly report to know whether your treasury is healthy. You need five answers, and you can pull them in ten minutes from public sources. Run this diagnostic on the first of every month — it's the lightweight cousin of a full investor report, and it'll catch problems before they require a deck.",
      },
      { type: "h2", text: "1. What's the stablecoin floor?" },
      {
        type: "p",
        text: "Open your treasury wallet on Etherscan (or whatever explorer matches the chain). Sum up USDC, USDT, DAI, USDS, and any other major stables. Divide that number by your trailing three-month operating burn. The result is your stablecoin-only runway in months. If it's under six, you have a market-independent runway problem. Native-token price could go to zero tomorrow and this is the only number you control.",
      },
      { type: "h2", text: "2. What's the native-token concentration?" },
      {
        type: "p",
        text: "Take the value of your project's own token sitting in the treasury (token count × current price) and divide by the total treasury value. If it's above 70%, your reported runway is fragile — a 50% price drop on your native asset rewrites your runway story in a single weekend. This is the single most underdiscussed risk on monthly investor calls, and the easiest one to spot with five clicks.",
      },
      { type: "h2", text: "3. Where's the last 30 days of outflow going?" },
      {
        type: "p",
        text: "Open the last 30 days of outgoing transactions. Look at the top three by value. Categorise them in your head — payroll, infra, marketing, grants, partner payments, treasury rebalance. If you can't tell from on-chain data alone what the largest outflow was for, that's the single most useful piece of investor copy you'll write all month: explain it before they ask.",
      },
      { type: "h2", text: "4. Is engineering output keeping pace with burn?" },
      {
        type: "p",
        text: "Open your main GitHub org. Sort repos by recent activity. Glance at commits-per-week and merged-PRs-per-week across the top five repos. If those have been flat or declining for three months while burn is steady, you have a productivity-per-dollar problem that investors will eventually ask about. The reverse — engineering output rising while burn is flat — is the single best signal you can put in front of your cap table.",
      },
      { type: "h2", text: "5. What changed materially this month?" },
      {
        type: "p",
        text: "Write one sentence. Not a paragraph — one sentence. \"Treasury rebalanced from native to stables: $1.5M.\" \"Lead engineer joined from Optimism.\" \"V2 contracts deployed to mainnet, $4M TVL within 48 hours.\" If you can't come up with a one-sentence material change, the month wasn't material — that's also useful information for your cap table, and worth communicating cleanly rather than padding with filler.",
      },
      { type: "h2", text: "The point of the diagnostic" },
      {
        type: "p",
        text: "If you do this on the first of every month, you'll know which of your investor reports needs proactive explanation and which is routine. The teams that get caught flat-footed by an investor question almost always failed to ask the question of themselves first. Ten minutes, five answers, no spreadsheet.",
      },
      {
        type: "cta",
        text: "Vault Brief automates the data-collection half of this diagnostic — balances, flows, category breakdowns, and GitHub signals are pre-filled on the first of each month. You're left with the one-sentence material change, which is the part only you can write.",
      },
    ],
  },
];

// One disclaimer, three surfaces (PDF, public report page, investor email).
// A single source of truth so the three cannot drift from each other or
// contradict the "never write your own disclaimer" rule this same feature
// adds to the LLM's system prompt (see report-sections.ts's Rules block) —
// there is exactly one disclaimer in this product, and it is platform-
// rendered, never model-written.
//
// Dependency-free on purpose: this reaches `pdf-template.tsx`, which is
// itself imported into server-side rendering code that must stay
// import-clean, and `app/r/[reportId]/page.tsx` and `email-sender.ts`,
// neither of which should pick up anything heavier than a string.

export const REPORT_DISCLAIMER =
  "This report is for informational purposes only and does not constitute financial, investment, or legal advice. Any recommendations concern the treasury's own operations and are not a solicitation to buy, sell, or hold any token. Figures are derived from on-chain data and third-party price feeds and may not reflect audited financials.";

// Address → counterparty lookup: which known exchange, payout contract, audit
// firm or infrastructure vendor sits behind a given address.
//
// Why this is its own file rather than part of expense-classifier.ts, where
// these sets used to live: expense-classifier.ts has `import OpenAI from
// "openai"` at module top. Report sections need the same lookup to name the
// counterparty on a transaction, and report-sections.ts is imported by
// ReportTemplateEditor.tsx, which is "use client" — so report-sections.ts and
// everything it transitively imports ships to the browser. Importing the
// classifier from a section would drag the entire OpenAI SDK into the
// settings-page bundle.
//
// Hence the same discipline as treasury-attribution.ts: ZERO imports. No
// `@/server/db`, no `openai`, no `node:*`, no `process.env`. Please don't fold
// this back into the classifier, and don't add an import here to save a few
// lines — either one silently re-inflates a client bundle, and the damage is
// invisible until someone reads a bundle report.
//
// All keys are lowercased at definition-time so callers can compare with
// `addr.toLowerCase()` without allocating per-tx. Sources: Etherscan tagged
// labels, public DAO docs, Sablier/Superfluid registry pages, common
// audit-firm multisigs.
//
// Coverage philosophy: better to miss-classify than mis-classify. A
// counterparty NOT in this list falls through to the recurring-transfer
// signal and (failing that) to the LLM. Adding an entry here costs nothing at
// runtime; deleting one is harmless. So lean towards including known entities
// even if usage will be sparse.

const EXCHANGE_LABELS: Record<string, string> = {
  "0xd551234ae421e3bcba99a0da6d736074f22192ff": "Binance",
  "0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be": "Binance",
  "0x28c6c06298d514db089934071355e5743bf21d60": "Binance",
  "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance",
  "0x71660c4005ba85c37ccec55d0c4493e66fe775d3": "Coinbase",
  "0x503828976d22510aad0201ac7ec88293211d23da": "Coinbase",
  "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740": "Coinbase",
  "0xa090e606e30bd747d4e6245a1517ebe430f0057e": "Coinbase",
  "0x2910543af39aba0cd09dbb2d50200b3e800a63d2": "Kraken",
  "0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0": "Kraken",
  "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": "OKX",
  "0x876eabf441b2ee5b5b0554fd502a8e0600950cfa": "Bitfinex",
  "0x07ee55aa48bb72dcc6e9d78256648910de513eca": "Gemini",
  "0xa09871aeadf4994ca12f5c0b6056bbd1d343c029": "dYdX",
};

// Multisend / Disperse are generic batch-payout helpers many DAOs use to pay
// contributors in one tx. Sablier and Superfluid are streaming-payment
// protocols — a DAO routing payroll through streams targets their lockups.
const PAYROLL_LABELS: Record<string, string> = {
  "0xc5a076cad94176c2996b32d8466be1ce757faa27": "Gnosis Safe Multisend",
  "0xa84cd91eb4f10a2a0aaf81786064a76b8d0cbe44": "Gnosis Safe Multisend",
  "0x8d29be29923b68abfdd21e541b9374737b36aa0f": "Disperse.app",
  "0xcd18eaa163733da39c232722cbc4e8940b1d8888": "Sablier",
  "0xb10daee1fcf62243ae27776d7a92d39dc8740f95": "Sablier",
  "0xafb979d9afad1ad27c5eff4e27226e3ab9e5dcc9": "Sablier",
  "0x3e14dc1b13c488a8d5d310918780c983bd5982e7": "Superfluid",
  "0xd1eed8e3766d40a3deb39d8e95cd83a86bbe5fee": "Superfluid",
};

// Audit firm payment addresses. Outflows here are almost always invoiced
// security audits → category "legal" (there's no separate "audit" category in
// the schema).
const AUDIT_FIRM_LABELS: Record<string, string> = {
  "0xafd5dee72e0d6c8ec1e8c4a78e8a9bcdc97cd2ec": "Trail of Bits",
  "0x35918cdebebcb2dab3d44a7d2aa90d1be38d3a40": "OpenZeppelin",
  "0xe725a8d6e3a73c3f4f67ee2bb3b0d0bc7b07a27f": "Spearbit",
  "0x123633c0c8f44c4c47b7ca5d49d79f59a9f74a73": "Code4rena",
};

// Infrastructure paymasters: SaaS billing addresses that show up in DAO
// treasuries. Recognising these prevents Vercel / Alchemy bills landing in
// `operational` and matches them to `infrastructure`.
const INFRASTRUCTURE_LABELS: Record<string, string> = {
  "0xe53c697d62d33b35a48b2d34f3e69a40fea2da2d": "Alchemy", // ops (placeholder pattern)
  // Add Vercel, AWS billing addrs as they're discovered. Sparse for now —
  // these vendors usually accept fiat, not on-chain payments.
};

function addressSet(labels: Record<string, string>): ReadonlySet<string> {
  return new Set(Object.keys(labels).map((a) => a.toLowerCase()));
}

export const KNOWN_EXCHANGE_ADDRESSES = addressSet(EXCHANGE_LABELS);
export const KNOWN_PAYROLL_CONTRACTS = addressSet(PAYROLL_LABELS);
export const KNOWN_AUDIT_FIRMS = addressSet(AUDIT_FIRM_LABELS);
export const KNOWN_INFRASTRUCTURE_ADDRESSES = addressSet(INFRASTRUCTURE_LABELS);

// A Map, not a plain object: lookups take caller-supplied strings, and an
// object would answer `labelCounterparty("constructor")` with something off
// Object.prototype instead of null.
const ADDRESS_LABELS: ReadonlyMap<string, string> = new Map(
  [
    EXCHANGE_LABELS,
    PAYROLL_LABELS,
    AUDIT_FIRM_LABELS,
    INFRASTRUCTURE_LABELS,
  ].flatMap((labels) =>
    Object.entries(labels).map(
      ([address, label]) => [address.toLowerCase(), label] as [string, string]
    )
  )
);

/**
 * Human-readable name for a counterparty address ("Binance", "Trail of
 * Bits"), or null when the address isn't one we recognise — which is the
 * common case, and not an error.
 *
 * Matching is case-insensitive because EVM addresses reach us in whatever
 * casing their source used: EIP-55 checksummed from an explorer, all-lower
 * from an RPC log, and mixed once a founder has pasted one by hand. Never
 * throws — a bad address is just an unknown one.
 */
export function labelCounterparty(address: string): string | null {
  if (typeof address !== "string") return null;
  const key = address.trim().toLowerCase();
  if (!key) return null;
  return ADDRESS_LABELS.get(key) ?? null;
}

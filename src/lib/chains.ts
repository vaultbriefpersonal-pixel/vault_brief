// `alchemyNetwork` is the network slug Alchemy's Portfolio API expects in its
// `addresses[].networks` array — the same slug already embedded in each
// `rpcUrl` below, lifted out so balance fetching can name it directly instead
// of string-parsing a URL. NULL for Solana, which goes through Helius
// (solana-sync.ts) and never touches the EVM balance path.
//
// `duneChainId` is retained but DEAD for balances: the Dune Sim API it named
// was sunset on 2026-08-01 and now answers every request with HTTP 410, which
// is what silently wrote $0.00 treasuries for five days. See
// `fetchAlchemyBalances` in wallet-sync.ts.
export const CHAINS = {
  ethereum: {
    id: 1,
    name: "Ethereum",
    duneChainId: "ethereum",
    alchemyNetwork: "eth-mainnet",
    nativeToken: "ETH",
    // `g.alchemy.com`, NOT the legacy `eth-mainnet.alchemyapi.io`. That
    // deprecated host answers with a network-level `fetch failed`, and because
    // it was the only entry here still using it, anything reading this field
    // for Ethereum silently got nothing back while the other four chains
    // worked. safe-info.ts documents having duplicated this whole map rather
    // than depend on the broken entry; transaction-sync.ts likewise keeps its
    // own. Fixed at the source so the next reader does not need a workaround.
    rpcUrl: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  },
  polygon: {
    id: 137,
    name: "Polygon",
    duneChainId: "polygon",
    alchemyNetwork: "polygon-mainnet",
    nativeToken: "MATIC",
    rpcUrl: `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  },
  arbitrum: {
    id: 42161,
    name: "Arbitrum",
    duneChainId: "arbitrum",
    alchemyNetwork: "arb-mainnet",
    nativeToken: "ETH",
    rpcUrl: `https://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  },
  base: {
    id: 8453,
    name: "Base",
    duneChainId: "base",
    alchemyNetwork: "base-mainnet",
    nativeToken: "ETH",
    rpcUrl: `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  },
  optimism: {
    id: 10,
    name: "Optimism",
    duneChainId: "optimism",
    alchemyNetwork: "opt-mainnet",
    nativeToken: "ETH",
    rpcUrl: `https://opt-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  },
  solana: {
    id: null,
    name: "Solana",
    duneChainId: "solana",
    alchemyNetwork: null,
    nativeToken: "SOL",
    rpcUrl: "https://api.mainnet-beta.solana.com",
  },
} as const;

export type ChainKey = keyof typeof CHAINS;

// Caller MUST `.toUpperCase()` the symbol before lookup — every entry here is
// uppercase to keep that contract one-way and obvious.
export const STABLECOIN_SYMBOLS = new Set([
  // Major USD stables
  "USDC",
  "USDT",
  "DAI",
  "USDS", // Sky/Maker rebrand of DAI
  "PYUSD", // PayPal
  "USDE", // Ethena
  "FDUSD", // First Digital
  "USDP", // Paxos
  "GUSD", // Gemini
  "TUSD", // TrueUSD
  "FRAX",
  "FRXUSD", // Frax v3
  "CRVUSD", // Curve
  "GHO", // Aave
  "LUSD", // Liquity
  "MIM", // Magic Internet Money
  "BUSD", // Binance (deprecated but still on-chain)
  "USDD",
  "USDB",
  "SUSD", // sUSD (Synthetix) — uppercase per the contract above
  "USR", // Resolv
  // Yield-bearing stables (Spark sDAI etc.) — still 1:1 USD-pegged
  "SDAI",
  "SUSDE", // Ethena staked
  // EUR stables
  "EURC",
  "EURS",
]);

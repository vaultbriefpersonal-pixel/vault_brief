export const CHAINS = {
  ethereum: {
    id: 1,
    name: "Ethereum",
    duneChainId: "ethereum",
    nativeToken: "ETH",
    rpcUrl: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`,
  },
  polygon: {
    id: 137,
    name: "Polygon",
    duneChainId: "polygon",
    nativeToken: "MATIC",
    rpcUrl: `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  },
  arbitrum: {
    id: 42161,
    name: "Arbitrum",
    duneChainId: "arbitrum",
    nativeToken: "ETH",
    rpcUrl: `https://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  },
  base: {
    id: 8453,
    name: "Base",
    duneChainId: "base",
    nativeToken: "ETH",
    rpcUrl: `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  },
  optimism: {
    id: 10,
    name: "Optimism",
    duneChainId: "optimism",
    nativeToken: "ETH",
    rpcUrl: `https://opt-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  },
  solana: {
    id: null,
    name: "Solana",
    duneChainId: "solana",
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

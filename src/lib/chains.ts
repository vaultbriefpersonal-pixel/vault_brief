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

export const STABLECOIN_SYMBOLS = new Set([
  "USDC",
  "USDT",
  "DAI",
  "FRAX",
  "BUSD",
  "TUSD",
  "USDP",
  "GUSD",
  "LUSD",
  "sUSD",
  "MIM",
  "USDD",
  "USDB",
]);

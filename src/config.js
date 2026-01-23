import 'dotenv/config';

export const config = {
  // Network configuration
  rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  chainId: parseInt(process.env.CHAIN_ID || '8453'),
  
  // Fallback RPC URLs (public endpoints - use env var for paid RPC)
  fallbackRpcs: [
    'https://mainnet.base.org',
    'https://base.drpc.org',
    'https://1rpc.io/base',
    'https://base.meowrpc.com',
  ],
  
  // Contract addresses (Base Mainnet)
  contracts: {
    giraffeRace: '0x9f9e34af1ee8429902056d33fb486bd23fbdc590',
    giraffeNFT: '0xa67e746383dcc73f1bfe9144102274443d8bac4e',
    houseTreasury: '0xc3134fd57f606d880b581d0a28bc92af8a0d4b66',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  
  // Race constants
  race: {
    laneCount: 6,
    submissionWindowBlocks: 30,
    bettingWindowBlocks: 30,
    postRaceCooldownBlocks: 30,
    trackLength: 1000,
    maxTicks: 500,
    speedRange: 10,
  },
  
  // Bot settings
  bot: {
    pollIntervalMs: 3000, // Slightly longer than Base block time to reduce RPC load
  },
};

export default config;

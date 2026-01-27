import 'dotenv/config';

// Detect if running on local chain
const isLocalChain = process.env.RPC_URL?.includes('127.0.0.1') || 
                     process.env.RPC_URL?.includes('localhost') ||
                     process.env.CHAIN_ID === '31337';

export const config = {
  // Network configuration
  chainId: parseInt(process.env.CHAIN_ID || '8453'),
  
  // RPC URLs - use RPC_URL env var for local/custom, otherwise use fallback list
  fallbackRpcs: process.env.RPC_URL 
    ? [process.env.RPC_URL]  // Single RPC for local/custom
    : [
        'https://base.drpc.org',        // Most reliable public RPC
        'https://1rpc.io/base',
        'https://base.meowrpc.com',
        'https://mainnet.base.org',     // Official but rate-limited
      ],
  
  // Contract address (set via env var for local testing)
  giraffeRaceContract: process.env.GIRAFFE_RACE_CONTRACT || '0x9f9e34af1ee8429902056d33fb486bd23fbdc590',
  
  // Privileged addresses (set via env var for local testing)
  addresses: {
    raceBot: process.env.RACE_BOT_ADDRESS || '0xbA7106581320DCCF42189682EF35ab523f4D97D1',
  },
  
  // Race window constants (in blocks)
  race: {
    laneCount: 6,
    oddsWindowBlocks: 10,
    bettingWindowBlocks: 30,
    postRaceCooldownBlocks: 30,
    trackLength: 1000,
    maxTicks: 500,
    speedRange: 10,
  },
  
  // Monte Carlo settings
  monteCarlo: {
    samples: parseInt(process.env.MONTE_CARLO_SAMPLES || '50000'),
  },
  
  // Bot settings
  bot: {
    pollIntervalMs: 2000,
    presenceApiUrl: process.env.PRESENCE_API_URL || 'https://giraffe-race.vercel.app/api/presence',
    presenceCheckIntervalMs: 5000,
    // Skip presence check on local chain (no real users)
    skipPresenceCheck: isLocalChain || process.env.SKIP_PRESENCE_CHECK === 'true',
  },
  
  // Debug flag
  isLocalChain,
};

export default config;

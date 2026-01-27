import 'dotenv/config';

export const config = {
  // Network configuration
  rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  chainId: parseInt(process.env.CHAIN_ID || '8453'),
  
  // Fallback RPC URLs (ordered by reliability - use env var for paid RPC)
  fallbackRpcs: [
    'https://base.drpc.org',        // Most reliable public RPC
    'https://1rpc.io/base',
    'https://base.meowrpc.com',
    'https://mainnet.base.org',     // Official but rate-limited
  ],
  
  // Contract address
  giraffeRaceContract: '0x9f9e34af1ee8429902056d33fb486bd23fbdc590',
  
  // Privileged addresses
  addresses: {
    raceBot: '0xbA7106581320DCCF42189682EF35ab523f4D97D1',
    treasuryOwner: '0x6935d26Ba98b86e07Bedf4FFBded0eA8a9eDD5Fb',
  },
  
  // Race window constants (in blocks)
  race: {
    laneCount: 6,
    oddsWindowBlocks: 10,         // Time for bot to call setOdds() after createRace()
    bettingWindowBlocks: 30,      // Time for users to place bets after odds are set
    postRaceCooldownBlocks: 30,   // Wait period after settlement before next race
    trackLength: 1000,
    maxTicks: 500,
    speedRange: 10,
  },
  
  // Monte Carlo settings
  monteCarlo: {
    samples: 50000,               // Number of simulations for probability calculation
    // NOTE: House edge is applied ON-CHAIN, not by the bot
  },
  
  // Bot settings
  bot: {
    pollIntervalMs: 2000,         // Poll interval when waiting (Base ~2s blocks)
    presenceApiUrl: process.env.PRESENCE_API_URL || 'https://giraffe-race.vercel.app/api/presence',
    presenceCheckIntervalMs: 5000, // Check for users every 5s when idle
  },
};

export default config;

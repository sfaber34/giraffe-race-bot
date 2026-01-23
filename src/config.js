import 'dotenv/config';

export const config = {
  // Network configuration
  rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  testnetRpcUrl: process.env.BASE_TESTNET_RPC_URL || 'https://sepolia.base.org',
  chainId: parseInt(process.env.CHAIN_ID || '8453'),
  
  // Base network constants
  networks: {
    mainnet: {
      name: 'base',
      chainId: 8453,
      rpcUrl: 'https://mainnet.base.org',
    },
    testnet: {
      name: 'base-sepolia',
      chainId: 84532,
      rpcUrl: 'https://sepolia.base.org',
    },
  },
};

export default config;

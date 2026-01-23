import 'dotenv/config';
import { ethers } from 'ethers';

// Validate required environment variables
if (!process.env.PRIVATE_KEY) {
  console.error('❌ PRIVATE_KEY is required in .env file');
  process.exit(1);
}

// Initialize provider for Base network
const provider = new ethers.JsonRpcProvider(
  process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  {
    name: 'base',
    chainId: parseInt(process.env.CHAIN_ID || '8453'),
  }
);

// Initialize wallet with private key
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

async function main() {
  try {
    console.log('🦒 Giraffe Race Bot starting...');
    console.log(`📍 Connected to Base network (Chain ID: ${process.env.CHAIN_ID || '8453'})`);
    
    // Get wallet address and balance
    const address = wallet.address;
    const balance = await provider.getBalance(address);
    
    console.log(`💰 Wallet: ${address}`);
    console.log(`💵 Balance: ${ethers.formatEther(balance)} ETH`);
    
    // Get current block number
    const blockNumber = await provider.getBlockNumber();
    console.log(`📦 Current block: ${blockNumber}`);
    
    console.log('\n✅ Bot initialized successfully!');
    console.log('📝 Ready to interact with contracts on Base network.\n');
    
  } catch (error) {
    console.error('❌ Error initializing bot:', error.message);
    process.exit(1);
  }
}

main();

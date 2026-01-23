import 'dotenv/config';
import { ethers } from 'ethers';
import config from './config.js';
import { GIRAFFE_RACE_ABI } from './abi.js';

// ============================================================================
// SETUP & VALIDATION
// ============================================================================

if (!process.env.PRIVATE_KEY) {
  console.error('❌ PRIVATE_KEY is required in .env file');
  process.exit(1);
}

// Initialize providers with fallbacks
const providers = config.fallbackRpcs.map(url => 
  new ethers.JsonRpcProvider(url, {
    name: 'base',
    chainId: config.chainId,
  })
);

let currentProviderIndex = 0;
let provider = providers[currentProviderIndex];
let wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
let giraffeRace = new ethers.Contract(
  config.contracts.giraffeRace,
  GIRAFFE_RACE_ABI,
  wallet
);

// Switch to next RPC provider
function switchProvider() {
  currentProviderIndex = (currentProviderIndex + 1) % providers.length;
  provider = providers[currentProviderIndex];
  wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  giraffeRace = new ethers.Contract(
    config.contracts.giraffeRace,
    GIRAFFE_RACE_ABI,
    wallet
  );
  log('🔀', `Switched to RPC: ${config.fallbackRpcs[currentProviderIndex]}`);
}

// ============================================================================
// LOGGING UTILITIES
// ============================================================================

function timestamp() {
  return new Date().toISOString();
}

function log(emoji, message) {
  console.log(`[${timestamp()}] ${emoji} ${message}`);
}

function logHeader(title) {
  console.log('\n' + '═'.repeat(60));
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

function logDivider() {
  console.log('─'.repeat(60));
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const BLOCK_TIME_MS = 2000; // Base has ~2 second blocks
const BUFFER_BLOCKS = 2;    // Wake up 2 blocks early to be ready

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function blocksToMs(blocks) {
  return Number(blocks) * BLOCK_TIME_MS;
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

// Smart sleep - waits for blocks minus buffer, with a minimum wait
async function sleepUntilBlock(targetBlock, currentBlock, reason) {
  const blocksToWait = Number(targetBlock) - currentBlock - BUFFER_BLOCKS;
  
  if (blocksToWait <= 0) {
    return; // Already at or past target
  }
  
  const sleepMs = blocksToMs(blocksToWait);
  log('😴', `Sleeping ${formatDuration(sleepMs)} (~${blocksToWait} blocks) - ${reason}`);
  log('⏰', `Will wake at block ~${currentBlock + blocksToWait} (target: ${targetBlock})`);
  console.log(''); // Blank line for readability
  
  await sleep(sleepMs);
}

// Retry wrapper for RPC calls with provider fallback
async function withRetry(fn, maxRetries = 3, delayMs = 1000) {
  let lastError;
  const totalProviders = providers.length;
  
  for (let providerAttempt = 0; providerAttempt < totalProviders; providerAttempt++) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          log('🔄', `RPC call failed, retrying (${attempt}/${maxRetries})...`);
          await sleep(delayMs);
        }
      }
    }
    
    if (providerAttempt < totalProviders - 1) {
      switchProvider();
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function getWalletInfo() {
  const address = wallet.address;
  const balance = await withRetry(() => provider.getBalance(address));
  return {
    address,
    balance: ethers.formatEther(balance),
  };
}

// ============================================================================
// RACE STATE FUNCTIONS
// ============================================================================

async function getRaceState(raceId) {
  const [bettingCloseBlock, settled, winner, seed, totalPot, totalOnLane] = 
    await withRetry(() => giraffeRace.getRaceById(raceId));
  
  const [, submissionCloseBlock, settledAtBlock] = 
    await withRetry(() => giraffeRace.getRaceScheduleById(raceId));
  
  const [assignedCount, tokenIds, originalOwners] = 
    await withRetry(() => giraffeRace.getRaceGiraffesById(raceId));
  
  const entryCount = await withRetry(() => giraffeRace.getRaceEntryCount(raceId));

  return {
    raceId,
    bettingCloseBlock,
    submissionCloseBlock,
    settledAtBlock,
    settled,
    winner,
    totalPot,
    assignedCount: Number(assignedCount),
    entryCount: Number(entryCount),
  };
}

function logRaceState(state, currentBlock) {
  logDivider();
  log('📊', `Race #${state.raceId} State:`);
  console.log(`    ├─ Settled: ${state.settled ? '✅ Yes' : '❌ No'}`);
  console.log(`    ├─ Giraffes Assigned: ${state.assignedCount}/6`);
  console.log(`    ├─ Entry Pool Size: ${state.entryCount}`);
  
  const subBlocksLeft = Number(state.submissionCloseBlock) - currentBlock;
  const betBlocksLeft = Number(state.bettingCloseBlock) - currentBlock;
  
  console.log(`    ├─ Submission Close: Block ${state.submissionCloseBlock} ${subBlocksLeft <= 0 ? '(CLOSED)' : `(${subBlocksLeft} blocks / ~${formatDuration(blocksToMs(subBlocksLeft))})`}`);
  console.log(`    ├─ Betting Close: Block ${state.bettingCloseBlock} ${betBlocksLeft <= 0 ? '(CLOSED)' : `(${betBlocksLeft} blocks / ~${formatDuration(blocksToMs(betBlocksLeft))})`}`);
  console.log(`    └─ Total Pot: ${ethers.formatUnits(state.totalPot, 6)} USDC`);
  
  if (state.settled) {
    console.log(`    └─ Winner: Lane ${state.winner}`);
  }
}

// ============================================================================
// TRANSACTION FUNCTIONS
// ============================================================================

async function executeCreateRace() {
  log('🏁', 'Creating new race...');
  try {
    const tx = await giraffeRace.createRace();
    log('📤', `Transaction sent: ${tx.hash}`);
    log('⏳', 'Waiting for confirmation...');
    
    const receipt = await tx.wait();
    log('✅', `Race created! Gas used: ${receipt.gasUsed.toString()}`);
    return true;
  } catch (error) {
    log('❌', `Failed to create race: ${error.message}`);
    return false;
  }
}

async function executeFinalizeRaceGiraffes() {
  log('🦒', 'Finalizing race giraffes (selecting lineup)...');
  try {
    const tx = await giraffeRace.finalizeRaceGiraffes();
    log('📤', `Transaction sent: ${tx.hash}`);
    log('⏳', 'Waiting for confirmation...');
    
    const receipt = await tx.wait();
    log('✅', `Lineup finalized! Gas used: ${receipt.gasUsed.toString()}`);
    return true;
  } catch (error) {
    log('❌', `Failed to finalize giraffes: ${error.message}`);
    return false;
  }
}

async function executeSettleRace() {
  log('🏆', 'Settling race (determining winner)...');
  try {
    const tx = await giraffeRace.settleRace();
    log('📤', `Transaction sent: ${tx.hash}`);
    log('⏳', 'Waiting for confirmation...');
    
    const receipt = await tx.wait();
    log('✅', `Race settled! Gas used: ${receipt.gasUsed.toString()}`);
    return true;
  } catch (error) {
    log('❌', `Failed to settle race: ${error.message}`);
    return false;
  }
}

// ============================================================================
// MAIN BOT LOOP - STATE MACHINE
// ============================================================================

const BotState = {
  CHECK_STATUS: 'CHECK_STATUS',
  WAIT_FOR_COOLDOWN: 'WAIT_FOR_COOLDOWN',
  CREATE_RACE: 'CREATE_RACE',
  WAIT_FOR_SUBMISSIONS: 'WAIT_FOR_SUBMISSIONS',
  FINALIZE_LINEUP: 'FINALIZE_LINEUP',
  WAIT_FOR_BETTING: 'WAIT_FOR_BETTING',
  SETTLE_RACE: 'SETTLE_RACE',
};

async function runBot() {
  logHeader('🦒 GIRAFFE RACE BOT (Smart Mode)');
  
  // Display startup info
  const walletInfo = await getWalletInfo();
  log('💰', `Wallet: ${walletInfo.address}`);
  log('💵', `Balance: ${walletInfo.balance} ETH`);
  log('📍', `Network: Base Mainnet (Chain ID: ${config.chainId})`);
  log('📜', `Contract: ${config.contracts.giraffeRace}`);
  log('🌐', `RPC Pool: ${config.fallbackRpcs.length} endpoints`);
  log('🔗', `Active RPC: ${config.fallbackRpcs[currentProviderIndex]}`);
  log('🧠', `Smart sleep enabled - will only poll when action is near`);
  
  logHeader('🔄 STARTING BOT LOOP');
  
  while (true) {
    try {
      const currentBlock = await withRetry(() => provider.getBlockNumber());
      log('📦', `Current Block: ${currentBlock}`);
      
      // Get cooldown status
      const [canCreate, blocksRemaining, cooldownEndsAtBlock] = 
        await withRetry(() => giraffeRace.getCreateRaceCooldown());
      
      // Get latest race info
      const nextId = await withRetry(() => giraffeRace.nextRaceId());
      const hasRaces = nextId > 0n;
      const latestRaceId = hasRaces ? nextId - 1n : null;
      
      log('🔢', `Latest Race ID: ${latestRaceId ?? 'None'} | Can Create: ${canCreate ? '✅' : '❌'}`);
      
      // CASE 1: No races exist - create first one
      if (!hasRaces) {
        if (canCreate) {
          log('🎯', 'ACTION: Creating first race');
          await executeCreateRace();
          await sleep(3000); // Brief pause after tx
          continue;
        } else {
          log('⏱️', `Cooldown: ${blocksRemaining} blocks until we can create`);
          await sleepUntilBlock(cooldownEndsAtBlock, currentBlock, 'waiting for cooldown to end');
          continue;
        }
      }
      
      // CASE 2: We have races - check the latest one
      const raceState = await getRaceState(latestRaceId);
      logRaceState(raceState, currentBlock);
      
      // CASE 2a: Race is settled - create new one (if cooldown allows)
      if (raceState.settled) {
        if (canCreate) {
          log('🎯', 'ACTION: Previous race settled - creating new race');
          await executeCreateRace();
          await sleep(3000);
          continue;
        } else {
          log('⏱️', `Cooldown: ${blocksRemaining} blocks remaining`);
          await sleepUntilBlock(cooldownEndsAtBlock, currentBlock, 'waiting for cooldown after settled race');
          continue;
        }
      }
      
      // CASE 2b: Race is active - determine what phase we're in
      const submissionsClosed = currentBlock >= Number(raceState.submissionCloseBlock);
      const bettingClosed = currentBlock >= Number(raceState.bettingCloseBlock);
      const lineupFinalized = raceState.assignedCount === 6;
      
      // Phase 1: Waiting for submissions to close
      if (!submissionsClosed) {
        log('📝', `PHASE: Submission window open`);
        await sleepUntilBlock(raceState.submissionCloseBlock, currentBlock, 'waiting for submission window to close');
        continue;
      }
      
      // Phase 2: Submissions closed, need to finalize
      if (submissionsClosed && !lineupFinalized) {
        log('🎯', 'ACTION: Submission window closed - finalizing lineup');
        await executeFinalizeRaceGiraffes();
        await sleep(3000);
        continue;
      }
      
      // Phase 3: Lineup finalized, waiting for betting to close
      if (lineupFinalized && !bettingClosed) {
        log('🎰', `PHASE: Betting window open`);
        await sleepUntilBlock(raceState.bettingCloseBlock, currentBlock, 'waiting for betting window to close');
        continue;
      }
      
      // Phase 4: Betting closed, need to settle
      if (lineupFinalized && bettingClosed && !raceState.settled) {
        log('🎯', 'ACTION: Betting window closed - settling race');
        await executeSettleRace();
        await sleep(3000);
        continue;
      }
      
      // Fallback - shouldn't reach here
      log('❓', 'Unknown state - sleeping briefly and retrying');
      await sleep(5000);
      
    } catch (error) {
      log('❌', `Error in bot loop: ${error.message}`);
      log('🔄', 'Retrying in 10 seconds...');
      await sleep(10000);
    }
  }
}

// ============================================================================
// ENTRY POINT
// ============================================================================

log('🚀', 'Initializing Giraffe Race Bot...');

runBot().catch((error) => {
  log('💥', `Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});

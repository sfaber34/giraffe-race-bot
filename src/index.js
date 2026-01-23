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
const ACTIVE_POLL_MS = 2000; // Poll interval when actively waiting for target block

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

// Wait for a specific block to be reached, sleeping long when far, polling when close
async function waitForBlock(targetBlock, reason) {
  const target = Number(targetBlock);
  let currentBlock = await withRetry(() => provider.getBlockNumber());
  let blocksLeft = target - currentBlock;
  
  // If we're far from target, do a long sleep first
  if (blocksLeft > BUFFER_BLOCKS) {
    const sleepBlocks = blocksLeft - BUFFER_BLOCKS;
    const sleepMs = blocksToMs(sleepBlocks);
    log('😴', `Sleeping ${formatDuration(sleepMs)} (~${sleepBlocks} blocks) - ${reason}`);
    log('⏰', `Will wake at block ~${currentBlock + sleepBlocks} (target: ${target})`);
    console.log('');
    await sleep(sleepMs);
  }
  
  // Now poll until we reach the target
  let lastLoggedBlock = 0;
  while (true) {
    currentBlock = await withRetry(() => provider.getBlockNumber());
    blocksLeft = target - currentBlock;
    
    if (currentBlock >= target) {
      log('✅', `Reached target block ${target}`);
      return currentBlock;
    }
    
    // Only log once per block to avoid spam
    if (currentBlock !== lastLoggedBlock) {
      log('⏳', `Waiting for block ${target} (${blocksLeft} left) - ${reason}`);
      lastLoggedBlock = currentBlock;
    }
    
    await sleep(ACTIVE_POLL_MS);
  }
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
// PRESENCE DETECTION
// ============================================================================

async function getActiveUsers() {
  try {
    const response = await fetch(config.bot.presenceApiUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    return data.activeUsers || 0;
  } catch (error) {
    log('⚠️', `Failed to check presence API: ${error.message}`);
    return 0; // Assume no users if API fails
  }
}

// Wait until at least one user is active
async function waitForActiveUsers() {
  log('👀', 'No active users - waiting for someone to visit the site...');
  
  while (true) {
    const activeUsers = await getActiveUsers();
    
    if (activeUsers > 0) {
      log('🎉', `${activeUsers} active user(s) detected! Starting race...`);
      return activeUsers;
    }
    
    log('💤', `No users online. Checking again in ${config.bot.presenceCheckIntervalMs / 1000}s...`);
    await sleep(config.bot.presenceCheckIntervalMs);
  }
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
  log('👥', `Presence API: ${config.bot.presenceApiUrl}`);
  
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
      
      // CASE 1: No races exist - create first one (if users are active)
      if (!hasRaces) {
        if (canCreate) {
          // Check if anyone is online before creating a race
          const activeUsers = await getActiveUsers();
          if (activeUsers === 0) {
            await waitForActiveUsers();
            continue; // Re-check state after users arrive
          }
          log('🎯', 'ACTION: Creating first race');
          await executeCreateRace();
          await sleep(3000); // Brief pause after tx
          continue;
        } else {
          log('⏱️', `Cooldown: ${blocksRemaining} blocks until we can create`);
          await waitForBlock(cooldownEndsAtBlock, 'cooldown ending');
          continue;
        }
      }
      
      // CASE 2: We have races - check the latest one
      const raceState = await getRaceState(latestRaceId);
      logRaceState(raceState, currentBlock);
      
      // CASE 2a: Race is settled - create new one (if cooldown allows AND users active)
      if (raceState.settled) {
        if (canCreate) {
          // Check if anyone is online before creating a new race
          const activeUsers = await getActiveUsers();
          log('👥', `Active users: ${activeUsers}`);
          
          if (activeUsers === 0) {
            await waitForActiveUsers();
            continue; // Re-check state after users arrive
          }
          
          log('🎯', 'ACTION: Previous race settled - creating new race');
          await executeCreateRace();
          await sleep(3000);
          continue;
        } else {
          log('⏱️', `Cooldown: ${blocksRemaining} blocks remaining`);
          await waitForBlock(cooldownEndsAtBlock, 'cooldown ending');
          continue;
        }
      }
      
      // CASE 2b: Race is active - determine what phase we're in
      const lineupFinalized = raceState.assignedCount === 6;
      
      // Phase 1: Waiting for submissions to close
      if (currentBlock < Number(raceState.submissionCloseBlock)) {
        log('📝', `PHASE: Submission window open`);
        await waitForBlock(raceState.submissionCloseBlock, 'submission window closing');
        continue;
      }
      
      // Phase 2: Submissions closed, need to finalize
      if (!lineupFinalized) {
        log('🎯', 'ACTION: Submission window closed - finalizing lineup');
        await executeFinalizeRaceGiraffes();
        await sleep(3000);
        continue;
      }
      
      // Phase 3: Lineup finalized, waiting for betting to close
      if (currentBlock < Number(raceState.bettingCloseBlock)) {
        log('🎰', `PHASE: Betting window open`);
        await waitForBlock(raceState.bettingCloseBlock, 'betting window closing');
        continue;
      }
      
      // Phase 4: Betting closed, need to settle
      if (!raceState.settled) {
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

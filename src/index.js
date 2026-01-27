import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync, writeFileSync, existsSync } from 'fs';
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
// GAS TRACKING
// ============================================================================

const GAS_TRACKING_FILE = 'gas-usage.json';

function loadGasTracking() {
  try {
    if (existsSync(GAS_TRACKING_FILE)) {
      const data = readFileSync(GAS_TRACKING_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    log('⚠️', `Failed to load gas tracking file: ${error.message}`);
  }
  return { races: {}, totals: { createRace: 0, finalizeLineup: 0, settleRace: 0, total: 0 } };
}

function saveGasTracking(data) {
  try {
    writeFileSync(GAS_TRACKING_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    log('⚠️', `Failed to save gas tracking file: ${error.message}`);
  }
}

function trackGasUsage(raceId, transactionType, gasUsed, txHash) {
  const data = loadGasTracking();
  const raceKey = raceId.toString();
  
  // Initialize race entry if doesn't exist
  if (!data.races[raceKey]) {
    data.races[raceKey] = {};
  }
  
  // Store transaction data
  data.races[raceKey][transactionType] = {
    gasUsed: Number(gasUsed),
    txHash,
    timestamp: new Date().toISOString(),
  };
  
  // Calculate total gas used for this race
  const raceData = data.races[raceKey];
  const raceTotalGas = 
    (raceData.createRace?.gasUsed || 0) + 
    (raceData.finalizeLineup?.gasUsed || 0) + 
    (raceData.settleRace?.gasUsed || 0);
  
  // Rebuild race object with correct order: createRace, finalizeLineup, settleRace, totalGasUsed
  const orderedRaceData = {};
  if (raceData.createRace) orderedRaceData.createRace = raceData.createRace;
  if (raceData.finalizeLineup) orderedRaceData.finalizeLineup = raceData.finalizeLineup;
  if (raceData.settleRace) orderedRaceData.settleRace = raceData.settleRace;
  orderedRaceData.totalGasUsed = raceTotalGas;
  data.races[raceKey] = orderedRaceData;
  
  // Update global totals
  data.totals[transactionType] = (data.totals[transactionType] || 0) + Number(gasUsed);
  data.totals.total = (data.totals.total || 0) + Number(gasUsed);
  
  saveGasTracking(data);
  log('📊', `Gas tracked for Race #${raceId} ${transactionType}: ${gasUsed} (race total: ${raceTotalGas.toLocaleString()})`);
}

function logGasSummary() {
  const data = loadGasTracking();
  const raceCount = Object.keys(data.races).length;
  
  if (raceCount === 0) {
    log('📊', 'No gas usage tracked yet');
    return;
  }
  
  log('📊', `Gas Summary (${raceCount} races tracked):`);
  console.log(`    ├─ Create Race Total: ${data.totals.createRace?.toLocaleString() || 0} gas`);
  console.log(`    ├─ Finalize Total: ${data.totals.finalizeLineup?.toLocaleString() || 0} gas`);
  console.log(`    ├─ Settle Total: ${data.totals.settleRace?.toLocaleString() || 0} gas`);
  console.log(`    └─ Grand Total: ${data.totals.total?.toLocaleString() || 0} gas`);
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
const POLL_INTERVAL_MS = 2000; // Poll interval when waiting

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
      log('🎉', `${activeUsers} active user(s) detected! Ready to start race...`);
      return activeUsers;
    }
    
    log('💤', `No users online. Checking again in ${config.bot.presenceCheckIntervalMs / 1000}s...`);
    await sleep(config.bot.presenceCheckIntervalMs);
  }
}

// ============================================================================
// RACE STATE FUNCTIONS (using new ABI)
// ============================================================================

async function getRaceActionability(raceId) {
  const [
    canFinalizeNow,
    canSettleNow,
    bettingCloseBlock,
    submissionCloseBlock,
    finalizeEntropyBlock,
    finalizeBlockhashExpiresAt,
    settleBlockhashExpiresAt,
    blocksUntilFinalizeExpiry,
    blocksUntilSettleExpiry
  ] = await withRetry(() => giraffeRace.getRaceActionabilityById(raceId));

  return {
    canFinalizeNow,
    canSettleNow,
    bettingCloseBlock: Number(bettingCloseBlock),
    submissionCloseBlock: Number(submissionCloseBlock),
    finalizeEntropyBlock: Number(finalizeEntropyBlock),
    finalizeBlockhashExpiresAt: Number(finalizeBlockhashExpiresAt),
    settleBlockhashExpiresAt: Number(settleBlockhashExpiresAt),
    blocksUntilFinalizeExpiry: Number(blocksUntilFinalizeExpiry),
    blocksUntilSettleExpiry: Number(blocksUntilSettleExpiry),
  };
}

async function getRaceBasicInfo(raceId) {
  const [bettingCloseBlock, settled, winner, seed, totalPot, totalOnLane] = 
    await withRetry(() => giraffeRace.getRaceById(raceId));
  
  const [assignedCount] = 
    await withRetry(() => giraffeRace.getRaceGiraffesById(raceId));
  
  const entryCount = await withRetry(() => giraffeRace.getRaceEntryCount(raceId));

  return {
    raceId,
    settled,
    winner: Number(winner),
    totalPot,
    assignedCount: Number(assignedCount),
    entryCount: Number(entryCount),
  };
}

function logRaceState(basic, actionability, currentBlock) {
  logDivider();
  log('📊', `Race #${basic.raceId} State:`);
  console.log(`    ├─ Settled: ${basic.settled ? '✅ Yes' : '❌ No'}`);
  console.log(`    ├─ Giraffes Assigned: ${basic.assignedCount}/6`);
  console.log(`    ├─ Entry Pool Size: ${basic.entryCount}`);
  console.log(`    ├─ Total Pot: ${ethers.formatUnits(basic.totalPot, 6)} USDC`);
  
  if (basic.settled) {
    console.log(`    └─ Winner: Lane ${basic.winner}`);
  } else {
    console.log(`    ├─ Can Finalize Now: ${actionability.canFinalizeNow ? '✅ YES' : '❌ No'}`);
    console.log(`    ├─ Can Settle Now: ${actionability.canSettleNow ? '✅ YES' : '❌ No'}`);
    
    const subBlocksLeft = actionability.submissionCloseBlock - currentBlock;
    const betBlocksLeft = actionability.bettingCloseBlock - currentBlock;
    
    if (subBlocksLeft > 0) {
      console.log(`    ├─ Submission closes in: ${subBlocksLeft} blocks (~${formatDuration(blocksToMs(subBlocksLeft))})`);
    }
    if (betBlocksLeft > 0 && actionability.bettingCloseBlock > 0) {
      console.log(`    ├─ Betting closes in: ${betBlocksLeft} blocks (~${formatDuration(blocksToMs(betBlocksLeft))})`);
    }
    if (actionability.blocksUntilFinalizeExpiry > 0) {
      console.log(`    ├─ Finalize expires in: ${actionability.blocksUntilFinalizeExpiry} blocks`);
    }
    if (actionability.blocksUntilSettleExpiry > 0) {
      console.log(`    └─ Settle expires in: ${actionability.blocksUntilSettleExpiry} blocks`);
    }
  }
}

// ============================================================================
// TRANSACTION FUNCTIONS (with gas tracking)
// ============================================================================

// Track which race we're currently working on
let currentRaceId = null;

async function executeCreateRace() {
  log('🏁', 'Creating new race...');
  try {
    // Get the race ID BEFORE creating - nextRaceId() tells us what ID will be assigned
    // This avoids RPC sync delays that can cause latestRaceId() to return the wrong value
    const newRaceId = await withRetry(() => giraffeRace.nextRaceId());
    log('📋', `New race will be #${newRaceId}`);
    
    const tx = await giraffeRace.createRace();
    log('📤', `Transaction sent: ${tx.hash}`);
    log('⏳', 'Waiting for confirmation...');
    
    const receipt = await tx.wait();
    const gasUsed = receipt.gasUsed.toString();
    log('✅', `Race #${newRaceId} created! Gas used: ${gasUsed}`);
    
    currentRaceId = newRaceId;
    trackGasUsage(newRaceId, 'createRace', gasUsed, tx.hash);
    
    return { success: true, gasUsed, txHash: tx.hash };
  } catch (error) {
    log('❌', `Failed to create race: ${error.message}`);
    return { success: false };
  }
}

async function executeFinalizeRaceGiraffes(raceId) {
  log('🦒', 'Finalizing race giraffes (selecting lineup)...');
  try {
    const tx = await giraffeRace.finalizeRaceGiraffes();
    log('📤', `Transaction sent: ${tx.hash}`);
    log('⏳', 'Waiting for confirmation...');
    
    const receipt = await tx.wait();
    const gasUsed = receipt.gasUsed.toString();
    log('✅', `Lineup finalized! Gas used: ${gasUsed}`);
    
    // Track gas for this race
    if (raceId) {
      trackGasUsage(raceId, 'finalizeLineup', gasUsed, tx.hash);
    }
    
    return { success: true, gasUsed, txHash: tx.hash };
  } catch (error) {
    log('❌', `Failed to finalize giraffes: ${error.message}`);
    return { success: false };
  }
}

async function executeSettleRace(raceId) {
  log('🏆', 'Settling race (determining winner)...');
  try {
    const tx = await giraffeRace.settleRace();
    log('📤', `Transaction sent: ${tx.hash}`);
    log('⏳', 'Waiting for confirmation...');
    
    const receipt = await tx.wait();
    const gasUsed = receipt.gasUsed.toString();
    log('✅', `Race settled! Gas used: ${gasUsed}`);
    
    // Track gas for this race
    if (raceId) {
      trackGasUsage(raceId, 'settleRace', gasUsed, tx.hash);
    }
    
    return { success: true, gasUsed, txHash: tx.hash };
  } catch (error) {
    log('❌', `Failed to settle race: ${error.message}`);
    return { success: false };
  }
}

// ============================================================================
// SMART WAITING
// ============================================================================

// Wait for condition to be true, with smart sleeping
async function waitForCondition(checkFn, getBlocksToWait, reason) {
  while (true) {
    const result = await checkFn();
    if (result.ready) {
      return result;
    }
    
    const blocksToWait = getBlocksToWait(result);
    if (blocksToWait > 2) {
      // Sleep for most of the wait time
      const sleepBlocks = blocksToWait - 2;
      const sleepMs = blocksToMs(sleepBlocks);
      log('😴', `Sleeping ${formatDuration(sleepMs)} (~${sleepBlocks} blocks) - ${reason}`);
      console.log('');
      await sleep(sleepMs);
    } else {
      // Close to ready, poll frequently
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

// ============================================================================
// MAIN BOT LOOP
// ============================================================================

async function runBot() {
  logHeader('🦒 GIRAFFE RACE BOT (Smart Mode v2)');
  
  // Display startup info
  const walletInfo = await getWalletInfo();
  log('💰', `Wallet: ${walletInfo.address}`);
  log('💵', `Balance: ${walletInfo.balance} ETH`);
  log('📍', `Network: Base Mainnet (Chain ID: ${config.chainId})`);
  log('📜', `Contract: ${config.contracts.giraffeRace}`);
  log('🌐', `RPC Pool: ${config.fallbackRpcs.length} endpoints`);
  log('🔗', `Active RPC: ${config.fallbackRpcs[currentProviderIndex]}`);
  log('👥', `Presence API: ${config.bot.presenceApiUrl}`);
  log('🧠', `Using canFinalizeNow/canSettleNow from contract - no more guessing!`);
  log('💾', `Gas tracking file: ${GAS_TRACKING_FILE}`);
  
  // Show existing gas summary
  logGasSummary();
  
  logHeader('🔄 STARTING BOT LOOP');
  
  while (true) {
    try {
      const currentBlock = await withRetry(() => provider.getBlockNumber());
      log('📦', `Current Block: ${currentBlock}`);
      
      // Check for active race
      const activeRaceId = await withRetry(() => giraffeRace.getActiveRaceIdOrZero());
      const hasActiveRace = activeRaceId > 0n;
      
      // Get cooldown status
      const [canCreate, blocksRemaining, cooldownEndsAtBlock] = 
        await withRetry(() => giraffeRace.getCreateRaceCooldown());
      
      log('🔢', `Active Race: ${hasActiveRace ? `#${activeRaceId}` : 'None'} | Can Create: ${canCreate ? '✅' : '❌'}`);
      
      // ========================================
      // CASE 1: No active race - create one
      // ========================================
      if (!hasActiveRace) {
        if (!canCreate) {
          // Wait for cooldown
          log('⏱️', `Cooldown: ${blocksRemaining} blocks remaining (ends at ${cooldownEndsAtBlock})`);
          const sleepBlocks = Number(blocksRemaining) > 2 ? Number(blocksRemaining) - 2 : 0;
          if (sleepBlocks > 0) {
            log('😴', `Sleeping ${formatDuration(blocksToMs(sleepBlocks))} until cooldown ends...`);
            console.log('');
            await sleep(blocksToMs(sleepBlocks));
          } else {
            await sleep(POLL_INTERVAL_MS);
          }
          continue;
        }
        
        // Check if anyone is online before creating a race
        const activeUsers = await getActiveUsers();
        log('👥', `Active users: ${activeUsers}`);
        
        if (activeUsers === 0) {
          await waitForActiveUsers();
          continue; // Re-check state after users arrive
        }
        
        log('🎯', 'ACTION: Creating new race');
        await executeCreateRace();
        await sleep(3000);
        continue;
      }
      
      // ========================================
      // CASE 2: Active race exists - manage it
      // ========================================
      const basic = await getRaceBasicInfo(activeRaceId);
      const actionability = await getRaceActionability(activeRaceId);
      logRaceState(basic, actionability, currentBlock);
      
      // Race is settled - shouldn't happen if getActiveRaceIdOrZero works correctly
      if (basic.settled) {
        log('✅', 'Race already settled, checking for next action...');
        await sleep(3000);
        continue;
      }
      
      // ----------------------------------------
      // Check if we can FINALIZE now
      // ----------------------------------------
      if (actionability.canFinalizeNow) {
        // Wait 1 extra block to ensure all RPC nodes are synced
        log('🎯', 'ACTION: Contract says canFinalizeNow=true - waiting 1 block for RPC sync...');
        await sleep(BLOCK_TIME_MS);
        
        log('🦒', 'Finalizing lineup...');
        const result = await executeFinalizeRaceGiraffes(activeRaceId);
        if (result.success) {
          await sleep(3000);
        } else {
          // If failed, wait a bit and retry
          log('⏳', 'Finalize failed, waiting before retry...');
          await sleep(5000);
        }
        continue;
      }
      
      // ----------------------------------------
      // Check if we can SETTLE now
      // ----------------------------------------
      if (actionability.canSettleNow) {
        // Wait 1 extra block to ensure all RPC nodes are synced
        log('🎯', 'ACTION: Contract says canSettleNow=true - waiting 1 block for RPC sync...');
        await sleep(BLOCK_TIME_MS);
        
        log('🏆', 'Settling race...');
        const result = await executeSettleRace(activeRaceId);
        if (result.success) {
          await sleep(3000);
        } else {
          // If failed, wait a bit and retry
          log('⏳', 'Settle failed, waiting before retry...');
          await sleep(5000);
        }
        continue;
      }
      
      // ----------------------------------------
      // Neither action available - wait for the right time
      // ----------------------------------------
      const lineupFinalized = basic.assignedCount === 6;
      
      if (!lineupFinalized) {
        // Waiting for submission window to close + entropy block
        const targetBlock = actionability.finalizeEntropyBlock || actionability.submissionCloseBlock;
        const blocksToWait = targetBlock - currentBlock;
        
        if (blocksToWait > 0) {
          log('📝', `PHASE: Waiting to finalize (target block: ${targetBlock})`);
          const sleepBlocks = blocksToWait > 2 ? blocksToWait - 2 : 0;
          if (sleepBlocks > 0) {
            log('😴', `Sleeping ${formatDuration(blocksToMs(sleepBlocks))} (~${sleepBlocks} blocks)...`);
            console.log('');
            await sleep(blocksToMs(sleepBlocks));
          } else {
            await sleep(POLL_INTERVAL_MS);
          }
        } else {
          // Should be able to finalize soon, poll
          log('⏳', 'Waiting for finalize to become available...');
          await sleep(POLL_INTERVAL_MS);
        }
        continue;
      }
      
      // Lineup finalized, waiting for betting to close
      const blocksToWait = actionability.bettingCloseBlock - currentBlock;
      
      if (blocksToWait > 0) {
        log('🎰', `PHASE: Betting window open (closes in ${blocksToWait} blocks)`);
        const sleepBlocks = blocksToWait > 2 ? blocksToWait - 2 : 0;
        if (sleepBlocks > 0) {
          log('😴', `Sleeping ${formatDuration(blocksToMs(sleepBlocks))} (~${sleepBlocks} blocks)...`);
          console.log('');
          await sleep(blocksToMs(sleepBlocks));
        } else {
          await sleep(POLL_INTERVAL_MS);
        }
      } else {
        // Betting closed, waiting for settle to become available
        log('⏳', 'Waiting for settle to become available...');
        await sleep(POLL_INTERVAL_MS);
      }
      
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

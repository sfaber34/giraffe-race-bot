import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import config from './config.js';
import { GIRAFFE_RACE_ABI, BOT_ACTION, BOT_ACTION_NAMES } from './abi.js';
import { calculateProbabilities, formatProbabilitiesForLog } from './monte-carlo.js';

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
  config.giraffeRaceContract,
  GIRAFFE_RACE_ABI,
  wallet
);

// Switch to next RPC provider
function switchProvider() {
  currentProviderIndex = (currentProviderIndex + 1) % providers.length;
  provider = providers[currentProviderIndex];
  wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  giraffeRace = new ethers.Contract(
    config.giraffeRaceContract,
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
  return { races: {}, totals: { createRace: 0, setOdds: 0, settleRace: 0, cancelRace: 0, total: 0 } };
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
  
  if (!data.races[raceKey]) {
    data.races[raceKey] = {};
  }
  
  data.races[raceKey][transactionType] = {
    gasUsed: Number(gasUsed),
    txHash,
    timestamp: new Date().toISOString(),
  };
  
  // Calculate total gas for this race
  const raceData = data.races[raceKey];
  const raceTotalGas = 
    (raceData.createRace?.gasUsed || 0) + 
    (raceData.setOdds?.gasUsed || 0) + 
    (raceData.settleRace?.gasUsed || 0) +
    (raceData.cancelRace?.gasUsed || 0);
  
  // Rebuild with correct order
  const orderedRaceData = {};
  if (raceData.createRace) orderedRaceData.createRace = raceData.createRace;
  if (raceData.setOdds) orderedRaceData.setOdds = raceData.setOdds;
  if (raceData.settleRace) orderedRaceData.settleRace = raceData.settleRace;
  if (raceData.cancelRace) orderedRaceData.cancelRace = raceData.cancelRace;
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
  console.log(`    ├─ Set Odds Total: ${data.totals.setOdds?.toLocaleString() || 0} gas`);
  console.log(`    ├─ Settle Total: ${data.totals.settleRace?.toLocaleString() || 0} gas`);
  console.log(`    ├─ Cancel Total: ${data.totals.cancelRace?.toLocaleString() || 0} gas`);
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

const BLOCK_TIME_MS = 2000;
const POLL_INTERVAL_MS = config.bot.pollIntervalMs;

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
    return 0;
  }
}

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
// BOT DASHBOARD
// ============================================================================

/**
 * Get the current bot action from the contract.
 * @returns {{ action: number, raceId: bigint, blocksRemaining: number, scores: number[] }}
 */
async function getBotDashboard() {
  const [action, raceId, blocksRemaining, scores] = await withRetry(() => 
    giraffeRace.getBotDashboard()
  );
  
  return {
    action: Number(action),
    raceId,
    blocksRemaining: Number(blocksRemaining),
    scores: scores.map(s => Number(s)),
  };
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
    const gasUsed = receipt.gasUsed.toString();
    
    // Get raceId from return value (parsed from logs/receipt)
    // The contract returns raceId, but we need to decode it from the transaction
    // For now, get it from dashboard on next iteration
    const dashboard = await getBotDashboard();
    const raceId = dashboard.raceId;
    
    log('✅', `Race #${raceId} created! Gas used: ${gasUsed}`);
    trackGasUsage(raceId, 'createRace', gasUsed, tx.hash);
    
    return { success: true, raceId, gasUsed, txHash: tx.hash };
  } catch (error) {
    log('❌', `Failed to create race: ${error.message}`);
    return { success: false };
  }
}

async function executeSetOdds(raceId, scores) {
  log('🎲', `Calculating probabilities for Race #${raceId}...`);
  
  try {
    // Run Monte Carlo simulation to get raw probabilities
    // NOTE: House edge is applied ON-CHAIN, not here
    const result = calculateProbabilities(scores, config.monteCarlo.samples);
    
    log('📊', `Probabilities calculated in ${result.elapsedMs}ms (${config.monteCarlo.samples.toLocaleString()} simulations)`);
    console.log(formatProbabilitiesForLog(result));
    
    // Submit probabilities to contract (contract applies house edge to convert to odds)
    log('📝', 'Submitting probabilities to contract...');
    const tx = await giraffeRace.setOdds(raceId, result.winProbBps, result.placeProbBps, result.showProbBps);
    log('📤', `Transaction sent: ${tx.hash}`);
    log('⏳', 'Waiting for confirmation...');
    
    const receipt = await tx.wait();
    const gasUsed = receipt.gasUsed.toString();
    log('✅', `Odds set for Race #${raceId}! Gas used: ${gasUsed}`);
    
    trackGasUsage(raceId, 'setOdds', gasUsed, tx.hash);
    
    return { success: true, gasUsed, txHash: tx.hash, probabilities: result };
  } catch (error) {
    log('❌', `Failed to set odds: ${error.message}`);
    return { success: false };
  }
}

async function executeSettleRace(raceId) {
  log('🏆', `Settling Race #${raceId}...`);
  try {
    // settleRace() takes no parameters - it settles the active race
    const tx = await giraffeRace.settleRace();
    log('📤', `Transaction sent: ${tx.hash}`);
    log('⏳', 'Waiting for confirmation...');
    
    const receipt = await tx.wait();
    const gasUsed = receipt.gasUsed.toString();
    log('✅', `Race #${raceId} settled! Gas used: ${gasUsed}`);
    
    trackGasUsage(raceId, 'settleRace', gasUsed, tx.hash);
    
    return { success: true, gasUsed, txHash: tx.hash };
  } catch (error) {
    log('❌', `Failed to settle race: ${error.message}`);
    return { success: false };
  }
}

async function executeCancelRace(raceId) {
  log('🚫', `Cancelling Race #${raceId} (no odds set in time)...`);
  try {
    // Option 1: Explicitly cancel
    // const tx = await giraffeRace.cancelRaceNoOdds(raceId);
    
    // Option 2: Just create a new race - it auto-cancels the expired one
    log('🔄', 'Creating new race (auto-cancels expired race)...');
    return await executeCreateRace();
  } catch (error) {
    log('❌', `Failed to cancel race: ${error.message}`);
    return { success: false };
  }
}

// ============================================================================
// MAIN BOT LOOP
// ============================================================================

async function runBot() {
  logHeader('🦒 GIRAFFE RACE BOT v3 (Dashboard Mode)');
  
  // Display startup info
  const walletInfo = await getWalletInfo();
  const networkName = config.isLocalChain ? 'Local Chain' : 'Base Mainnet';
  
  log('💰', `Wallet: ${walletInfo.address}`);
  log('💵', `Balance: ${walletInfo.balance} ETH`);
  log('📍', `Network: ${networkName} (Chain ID: ${config.chainId})`);
  log('📜', `Contract: ${config.giraffeRaceContract}`);
  log('🔗', `RPC: ${config.fallbackRpcs[currentProviderIndex]}`);
  log('🎲', `Monte Carlo: ${config.monteCarlo.samples.toLocaleString()} samples`);
  
  if (config.isLocalChain) {
    log('🧪', 'LOCAL MODE: Presence check disabled');
  } else {
    log('👥', `Presence API: ${config.bot.presenceApiUrl}`);
  }
  
  log('💾', `Gas tracking: ${GAS_TRACKING_FILE}`);
  
  // Verify wallet is raceBot
  if (walletInfo.address.toLowerCase() !== config.addresses.raceBot.toLowerCase()) {
    log('⚠️', `WARNING: Wallet is not raceBot! Only ${config.addresses.raceBot} can call setOdds()`);
    log('⚠️', `Current wallet: ${walletInfo.address}`);
  }
  
  logGasSummary();
  
  logHeader('🔄 STARTING BOT LOOP');
  
  while (true) {
    try {
      const currentBlock = await withRetry(() => provider.getBlockNumber());
      const dashboard = await getBotDashboard();
      
      logDivider();
      log('📦', `Block: ${currentBlock} | Action: ${BOT_ACTION_NAMES[dashboard.action]} | Race: ${dashboard.raceId > 0n ? `#${dashboard.raceId}` : 'None'} | Blocks Remaining: ${dashboard.blocksRemaining}`);
      
      switch (dashboard.action) {
        // ========================================
        // CASE 0: Nothing to do - wait
        // ========================================
        case BOT_ACTION.NONE: {
          if (dashboard.blocksRemaining > 0) {
            const waitMs = blocksToMs(dashboard.blocksRemaining);
            log('😴', `Waiting ${formatDuration(waitMs)} (~${dashboard.blocksRemaining} blocks)...`);
            // Sleep for most of the time, but leave a buffer
            const sleepBlocks = Math.max(0, dashboard.blocksRemaining - 2);
            if (sleepBlocks > 0) {
              await sleep(blocksToMs(sleepBlocks));
            } else {
              await sleep(POLL_INTERVAL_MS);
            }
          } else {
            await sleep(POLL_INTERVAL_MS);
          }
          break;
        }
        
        // ========================================
        // CASE 1: Create a new race
        // ========================================
        case BOT_ACTION.CREATE_RACE: {
          // Check if anyone is online before creating a race (skip on local chain)
          if (!config.bot.skipPresenceCheck) {
            const activeUsers = await getActiveUsers();
            log('👥', `Active users: ${activeUsers}`);
            
            if (activeUsers === 0) {
              await waitForActiveUsers();
              continue;
            }
          }
          
          log('🎯', 'ACTION: Create new race');
          const result = await executeCreateRace();
          if (result.success) {
            await sleep(3000);
          } else {
            await sleep(5000);
          }
          break;
        }
        
        // ========================================
        // CASE 2: Calculate and set odds
        // ========================================
        case BOT_ACTION.SET_ODDS: {
          log('🎯', `ACTION: Set odds for Race #${dashboard.raceId}`);
          log('🦒', `Scores: [${dashboard.scores.join(', ')}]`);
          log('⏰', `Deadline: ${dashboard.blocksRemaining} blocks remaining`);
          
          const result = await executeSetOdds(dashboard.raceId, dashboard.scores);
          if (result.success) {
            await sleep(3000);
          } else {
            // Failed to set odds - will need to cancel if time runs out
            log('⚠️', 'Failed to set odds - will retry...');
            await sleep(2000);
          }
          break;
        }
        
        // ========================================
        // CASE 3: Settle the race
        // ========================================
        case BOT_ACTION.SETTLE_RACE: {
          log('🎯', `ACTION: Settle Race #${dashboard.raceId}`);
          const result = await executeSettleRace(dashboard.raceId);
          if (result.success) {
            await sleep(3000);
          } else {
            await sleep(5000);
          }
          break;
        }
        
        // ========================================
        // CASE 4: Cancel expired race
        // ========================================
        case BOT_ACTION.CANCEL_RACE: {
          log('🎯', `ACTION: Cancel Race #${dashboard.raceId} (odds window expired)`);
          const result = await executeCancelRace(dashboard.raceId);
          if (result.success) {
            await sleep(3000);
          } else {
            await sleep(5000);
          }
          break;
        }
        
        default:
          log('❓', `Unknown action: ${dashboard.action}`);
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

log('🚀', 'Initializing Giraffe Race Bot v3...');

runBot().catch((error) => {
  log('💥', `Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});

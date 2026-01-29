// GiraffeRace Diamond Contract ABI (Key Functions)
export const GIRAFFE_RACE_ABI = [
  // Bot Dashboard - single function for all bot decisions
  {
    type: 'function',
    name: 'getBotDashboard',
    inputs: [],
    outputs: [
      { name: 'action', type: 'uint8' },
      { name: 'raceId', type: 'uint256' },
      { name: 'blocksRemaining', type: 'uint64' },
      { name: 'scores', type: 'uint8[6]' },
      { name: 'expiredRaceIds', type: 'uint256[]' }
    ],
    stateMutability: 'view'
  },
  
  // Write functions
  {
    type: 'function',
    name: 'createRace',
    inputs: [],
    outputs: [{ name: 'raceId', type: 'uint256' }],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'setProbabilities',
    inputs: [
      { name: 'raceId', type: 'uint256' },
      { name: 'winProbBps', type: 'uint16[6]' },
      { name: 'placeProbBps', type: 'uint16[6]' },
      { name: 'showProbBps', type: 'uint16[6]' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'settleRace',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'cancelRaceNoOdds',
    inputs: [{ name: 'raceId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'function',
    name: 'cleanupExpiredRace',
    inputs: [{ name: 'raceId', type: 'uint256' }],
    outputs: [{ name: 'released', type: 'uint256' }],
    stateMutability: 'nonpayable'
  },
  
  // Bot action constants (read from contract)
  {
    type: 'function',
    name: 'BOT_ACTION_NONE',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'BOT_ACTION_CREATE_RACE',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'BOT_ACTION_SET_PROBABILITIES',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'BOT_ACTION_SETTLE_RACE',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'BOT_ACTION_CANCEL_RACE',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view'
  },
];

// Bot action constants (match contract)
export const BOT_ACTION = {
  NONE: 0,
  CREATE_RACE: 1,
  SET_PROBABILITIES: 2,
  SETTLE_RACE: 3,
  CANCEL_RACE: 4,
};

export const BOT_ACTION_NAMES = {
  [BOT_ACTION.NONE]: 'NONE',
  [BOT_ACTION.CREATE_RACE]: 'CREATE_RACE',
  [BOT_ACTION.SET_PROBABILITIES]: 'SET_PROBABILITIES',
  [BOT_ACTION.SETTLE_RACE]: 'SETTLE_RACE',
  [BOT_ACTION.CANCEL_RACE]: 'CANCEL_RACE',
};

// Custom error selectors (first 4 bytes of keccak256 hash)
export const CONTRACT_ERRORS = {
  '0x2a66a557': 'NotRaceBot',
  '0x5ea20ad6': 'OddsWindowExpired',
  '0x79edacbe': 'OddsAlreadySet',
  '0x8d83e189': 'OddsNotSet',
  '0x337bb30c': 'OddsWindowNotExpired',
  '0x42e6ce25': 'InvalidRace',
  '0x54e37625': 'AlreadyCancelled',
  '0x560ff900': 'AlreadySettled',
  '0x23ed26ff': 'PreviousRaceNotSettled',
  '0xa22b745e': 'CooldownNotElapsed',
  '0x5c5e4add': 'OddsWindowActive',
  '0x61c54c4a': 'BettingClosed',
  '0x4b5956ac': 'BettingNotClosed',
};

/**
 * Decode a custom error from transaction revert data
 * @param {Error} error - The error object from ethers
 * @returns {string} - Human-readable error message
 */
export function decodeContractError(error) {
  // Check for revert data in various places ethers might put it
  const data = error.data || error.error?.data || error.transaction?.data;
  
  if (data && typeof data === 'string') {
    const selector = data.slice(0, 10).toLowerCase();
    const errorName = CONTRACT_ERRORS[selector];
    if (errorName) {
      return errorName;
    }
  }
  
  // Check error message for selector patterns
  const message = error.message || '';
  for (const [selector, name] of Object.entries(CONTRACT_ERRORS)) {
    if (message.toLowerCase().includes(selector.toLowerCase())) {
      return name;
    }
  }
  
  // Return original message if no custom error found
  return error.shortMessage || error.message || 'Unknown error';
}

export default GIRAFFE_RACE_ABI;

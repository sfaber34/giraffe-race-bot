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
      { name: 'scores', type: 'uint8[6]' }
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
    name: 'setOdds',
    inputs: [
      { name: 'raceId', type: 'uint256' },
      { name: 'winOddsBps', type: 'uint32[6]' },
      { name: 'placeOddsBps', type: 'uint32[6]' },
      { name: 'showOddsBps', type: 'uint32[6]' }
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
    name: 'BOT_ACTION_SET_ODDS',
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
  SET_ODDS: 2,
  SETTLE_RACE: 3,
  CANCEL_RACE: 4,
};

export const BOT_ACTION_NAMES = {
  [BOT_ACTION.NONE]: 'NONE',
  [BOT_ACTION.CREATE_RACE]: 'CREATE_RACE',
  [BOT_ACTION.SET_ODDS]: 'SET_ODDS',
  [BOT_ACTION.SETTLE_RACE]: 'SETTLE_RACE',
  [BOT_ACTION.CANCEL_RACE]: 'CANCEL_RACE',
};

export default GIRAFFE_RACE_ABI;

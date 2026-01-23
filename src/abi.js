// GiraffeRace Diamond Contract ABI (Key Functions)
export const GIRAFFE_RACE_ABI = [
  // Write functions
  'function createRace() external',
  'function finalizeRaceGiraffes() external',
  'function settleRace() external',
  
  // Read functions - Race creation
  'function getCreateRaceCooldown() view returns (bool canCreate, uint64 blocksRemaining, uint64 cooldownEndsAtBlock)',
  'function getActiveRaceIdOrZero() view returns (uint256 raceId)',
  
  // Read functions - Race info
  'function nextRaceId() view returns (uint256)',
  'function latestRaceId() view returns (uint256)',
  'function getRaceById(uint256 raceId) view returns (uint256 bettingCloseBlock, bool settled, uint8 winner, bytes32 seed, uint256 totalPot, uint256[6] totalOnLane)',
  'function getRaceScheduleById(uint256 raceId) view returns (uint256 bettingCloseBlock, uint256 submissionCloseBlock, uint256 settledAtBlock)',
  'function getRaceGiraffesById(uint256 raceId) view returns (uint8 assignedCount, uint256[6] tokenIds, address[6] originalOwners)',
  'function getRaceEntryCount(uint256 raceId) view returns (uint256)',
  
  // Read functions - Actionability (MOST IMPORTANT!)
  'function getRaceActionabilityById(uint256 raceId) view returns (bool canFinalizeNow, bool canSettleNow, uint64 bettingCloseBlock, uint64 submissionCloseBlock, uint64 finalizeEntropyBlock, uint64 finalizeBlockhashExpiresAt, uint64 settleBlockhashExpiresAt, uint64 blocksUntilFinalizeExpiry, uint64 blocksUntilSettleExpiry)',
];

export default GIRAFFE_RACE_ABI;

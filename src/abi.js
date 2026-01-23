// GiraffeRace Diamond Contract ABI (Key Functions)
export const GIRAFFE_RACE_ABI = [
  // Write functions
  'function createRace() external',
  'function finalizeRaceGiraffes() external',
  'function settleRace() external',
  
  // Read functions
  'function getCreateRaceCooldown() view returns (bool canCreate, uint256 blocksRemaining, uint256 cooldownEndsAtBlock)',
  'function nextRaceId() view returns (uint256)',
  'function latestRaceId() view returns (uint256)',
  'function getRaceById(uint256 raceId) view returns (uint256 bettingCloseBlock, bool settled, uint8 winner, bytes32 seed, uint256 totalPot, uint256[6] totalOnLane)',
  'function getRaceScheduleById(uint256 raceId) view returns (uint256 bettingCloseBlock, uint256 submissionCloseBlock, uint256 settledAtBlock)',
  'function getRaceGiraffesById(uint256 raceId) view returns (uint8 assignedCount, uint256[6] tokenIds, address[6] originalOwners)',
  'function getRaceEntryCount(uint256 raceId) view returns (uint256)',
  'function getRaceActionabilityById(uint256 raceId) view returns (bool canFinalize, bool canSettle, bool canBet)',
];

export default GIRAFFE_RACE_ABI;

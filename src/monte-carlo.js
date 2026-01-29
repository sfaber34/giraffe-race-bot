/**
 * Monte Carlo probability calculator for 6-lane giraffe races.
 * Outputs raw Win, Place, and Show probabilities for each lane in basis points.
 * These probabilities are meant to be committed on-chain; the contract applies house edge.
 *
 * Output:
 *   - Win probability: chance of finishing 1st
 *   - Place probability: chance of finishing 1st OR 2nd
 *   - Show probability: chance of finishing 1st, 2nd, OR 3rd
 *
 * WINNER DETERMINATION: First to cross the finish line (1000 units) wins!
 * - Uses fractional tick interpolation for precise ordering
 * - Calculates exactly when within a tick each racer crosses 1000
 * - Lower finish time = higher position
 * - Dead heats only when finish time is exactly equal (very rare)
 *
 * Dead Heat Rules:
 *   - If tied for last qualifying position, probability is split
 *   - Example: 2-way tie for 2nd → each gets 0.5 credit for Place
 *
 * Note: House edge is NOT applied here. The contract applies edge when converting
 * probabilities to odds: odds = (1 - houseEdge) / probability
 */

const LANE_COUNT = 6;
const SPEED_RANGE = 10;
const TRACK_LENGTH = 1000;
const FINISH_OVERSHOOT = 10; // Run until last place is this far past finish
const MAX_TICKS = 500;
const FINISH_TIME_PRECISION = 10000; // Precision for fractional tick calculation

// -----------------------
// Fast PRNG (xorshift128) - ~10-50x faster than keccak256
// -----------------------

class FastRng {
  constructor(seed) {
    // Initialize state from numeric seed
    this.s0 = seed >>> 0 || 0x12345678;
    this.s1 = Math.imul(seed, 0x85ebca6b) >>> 0 || 0x9abcdef0;
    this.s2 = Math.imul(seed, 0xc2b2ae35) >>> 0 || 0xdeadbeef;
    this.s3 = Math.imul(seed, 0x27d4eb2f) >>> 0 || 0xcafebabe;
    // Warm up
    for (let i = 0; i < 20; i++) this.next();
  }

  // xorshift128 - returns 32-bit unsigned integer
  next() {
    let t = this.s3;
    const s = this.s0;
    this.s3 = this.s2;
    this.s2 = this.s1;
    this.s1 = s;
    t ^= t << 11;
    t ^= t >>> 8;
    this.s0 = (t ^ s ^ (s >>> 19)) >>> 0;
    return this.s0;
  }

  // Returns random integer in [0, n-1]
  roll(n) {
    if (n <= 1) return 0;
    return this.next() % n;
  }
}

// -----------------------
// Fast seed generator (splitmix32)
// -----------------------

function splitmix32Next(state) {
  state.x = (state.x + 0x9e3779b9) >>> 0;
  let z = state.x;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return (z ^ (z >>> 16)) >>> 0;
}

// -----------------------
// Score/BPS helpers
// -----------------------

function clampScore(r) {
  const x = Math.floor(Number(r));
  if (!Number.isFinite(x) || x < 1) return 1;
  if (x > 10) return 10;
  return x;
}

// Match Solidity/TS: minBps + (score-1) * (10000-minBps) / 9
function scoreBps(score) {
  const r = clampScore(score);
  const minBps = 9585; // 0.9585x at score=1
  const range = 10_000 - minBps; // 415
  return minBps + Math.floor(((r - 1) * range) / 9);
}

// -----------------------
// Full race simulation (runs until ALL racers finish)
// -----------------------

/**
 * Simulate a full race and return the finish order.
 * Runs until ALL racers are past TRACK_LENGTH + FINISH_OVERSHOOT.
 *
 * WINNER DETERMINATION: First to cross the finish line (1000 units) wins!
 * - Uses fractional tick interpolation for precise ordering
 * - Calculates exactly when within a tick each racer crosses 1000
 * - Lower finish time = higher position
 * - Dead heats only when finish time is exactly equal (very rare)
 *
 * @param {number} seed - Numeric seed for RNG
 * @param {number[]} scores - Array of 6 scores (1-10)
 * @returns {{ finishOrder: Object, finalDistances: number[], finishTimes: number[] }}
 */
function simulateFullRace(seed, scores) {
  const rng = new FastRng(seed);
  const distances = [0, 0, 0, 0, 0, 0];
  const bps = [
    scoreBps(scores[0]),
    scoreBps(scores[1]),
    scoreBps(scores[2]),
    scoreBps(scores[3]),
    scoreBps(scores[4]),
    scoreBps(scores[5]),
  ];

  // Track precise finish time for each lane (-1 = hasn't crossed)
  // Format: tick * FINISH_TIME_PRECISION + fractionalPart
  // fractionalPart = (distanceToFinish * PRECISION) / speedThisTick
  // Lower value = crossed finish line earlier within the tick
  const finishTimes = [-1, -1, -1, -1, -1, -1];

  const finishLine = TRACK_LENGTH + FINISH_OVERSHOOT;

  // Run until ALL racers have finished
  for (let t = 0; t < MAX_TICKS; t++) {
    // Check if all finished
    let allFinished = true;
    for (let a = 0; a < LANE_COUNT; a++) {
      if (distances[a] < finishLine) {
        allFinished = false;
        break;
      }
    }
    if (allFinished) break;

    // Move each racer
    for (let a = 0; a < LANE_COUNT; a++) {
      const r = rng.roll(SPEED_RANGE); // 0..9
      const baseSpeed = r + 1; // 1..10

      // Apply handicap with probabilistic rounding
      const raw = baseSpeed * bps[a];
      let q = Math.floor(raw / 10_000);
      const rem = raw % 10_000;
      if (rem > 0) {
        const pick = rng.roll(10_000);
        if (pick < rem) q += 1;
      }

      const speed = q > 0 ? q : 1;
      const prevDist = distances[a];
      distances[a] += speed;

      // Check if this lane just crossed the finish line THIS tick
      if (finishTimes[a] === -1 && prevDist < TRACK_LENGTH && distances[a] >= TRACK_LENGTH) {
        // Calculate precise finish time using linear interpolation:
        // What fraction of this tick did it take to reach exactly TRACK_LENGTH?
        // fraction = (TRACK_LENGTH - prevDist) / speed
        // Lower fraction = crossed earlier within the tick
        const distanceToFinish = TRACK_LENGTH - prevDist;
        const fractional = Math.floor((distanceToFinish * FINISH_TIME_PRECISION) / speed);
        finishTimes[a] = t * FINISH_TIME_PRECISION + fractional;
      }
    }
  }

  // Calculate finish order based on precise finish time
  const finishOrder = calculateFinishOrder(finishTimes, distances);

  return { finishOrder, finalDistances: distances, finishTimes };
}

/**
 * Calculate finish order based on precise finish time (with fractional tick interpolation).
 * - Lower finishTime = crossed finish line earlier = higher position
 * - Dead heats only occur when finishTime is exactly equal (very rare with interpolation)
 *
 * @param {number[]} finishTimes - Precise finish time for each lane (-1 if not crossed)
 * @param {number[]} distances - Final distances (for tiebreaker ordering)
 * @returns {Object}
 */
function calculateFinishOrder(finishTimes, distances) {
  // Sort lanes by finishTime (ascending - earlier = better), then distance descending for ordering
  const sorted = finishTimes
    .map((time, lane) => ({ lane, time, distance: distances[lane] }))
    .sort((a, b) => {
      if (a.time !== b.time) return a.time - b.time; // Earlier time wins
      return b.distance - a.distance; // Same time: higher distance for consistent ordering
    });

  // Group by finishTime for dead heat detection (rare with interpolation)
  const groups = [];
  let currentGroup = { time: sorted[0].time, lanes: [sorted[0].lane] };

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].time === currentGroup.time) {
      currentGroup.lanes.push(sorted[i].lane);
    } else {
      groups.push(currentGroup);
      currentGroup = { time: sorted[i].time, lanes: [sorted[i].lane] };
    }
  }
  groups.push(currentGroup);

  // Assign positions
  const first = { lanes: [], count: 0 };
  const second = { lanes: [], count: 0 };
  const third = { lanes: [], count: 0 };

  let position = 0;
  for (const group of groups) {
    if (position === 0) {
      // First place
      first.lanes = group.lanes;
      first.count = group.lanes.length;
      position += group.lanes.length;
    } else if (position === 1) {
      // Second place (or tied for first overflowing)
      second.lanes = group.lanes;
      second.count = group.lanes.length;
      position += group.lanes.length;
    } else if (position === 2) {
      // Third place
      third.lanes = group.lanes;
      third.count = group.lanes.length;
      position += group.lanes.length;
    } else if (position >= 3) {
      break; // We have all we need
    }
  }

  return { first, second, third };
}

// -----------------------
// Probability accumulators with dead heat rules
// -----------------------

/**
 * Update lane stats based on finish order with STANDARD dead heat rules.
 *
 * Standard Dead Heat Rules (matches real horse racing):
 * - If your animal's position CLEARLY qualifies → full payout
 * - If your animal TIED for the LAST qualifying position → payout ÷ (number tied)
 *
 * WIN (position 1 only):
 * - Single 1st → full credit
 * - Tied for 1st → split credit (1/N each)
 *
 * PLACE (positions 1-2):
 * - Position 1 → always full credit
 * - Position 2 (no tie) → full credit
 * - Tied for 2nd → split one credit among all tied
 * - Note: If 2+ tied for 1st, they occupy ALL place spots (no split needed for them)
 *
 * SHOW (positions 1-3):
 * - Positions 1-2 → always full credit
 * - Position 3 (no tie) → full credit
 * - Tied for 3rd → split one credit among all tied
 *
 * @param {Object[]} stats
 * @param {Object} finishOrder
 */
function accumulateStats(stats, finishOrder) {
  const { first, second, third } = finishOrder;

  // ===== WIN (1 spot) =====
  // Tied for 1st? Split the single win credit
  const winShare = 1 / first.count;
  for (const lane of first.lanes) {
    stats[lane].winCredits += winShare;
  }

  // ===== PLACE (2 spots total) =====
  const placeSpots = 2;
  let placeUsed = 0;

  // First group
  if (first.count <= placeSpots) {
    // All first-placers fit in Place spots → full credit each
    for (const lane of first.lanes) {
      stats[lane].placeCredits += 1;
    }
    placeUsed = first.count;
  } else {
    // More tied for first than Place spots → they're tied for LAST qualifying position
    // Split the available spots among them
    const placeShare = placeSpots / first.count;
    for (const lane of first.lanes) {
      stats[lane].placeCredits += placeShare;
    }
    placeUsed = placeSpots; // All spots filled
  }

  // Second group (only if Place spots remain)
  const placeRemaining = placeSpots - placeUsed;
  if (placeRemaining > 0 && second.count > 0) {
    if (second.count <= placeRemaining) {
      // All fit → full credit each
      for (const lane of second.lanes) {
        stats[lane].placeCredits += 1;
      }
    } else {
      // Tied for last qualifying Place position → split remaining spots
      const placeShare = placeRemaining / second.count;
      for (const lane of second.lanes) {
        stats[lane].placeCredits += placeShare;
      }
    }
  }

  // ===== SHOW (3 spots total) =====
  const showSpots = 3;
  let showUsed = 0;

  // First group
  if (first.count <= showSpots) {
    for (const lane of first.lanes) {
      stats[lane].showCredits += 1;
    }
    showUsed = first.count;
  } else {
    // More tied for first than Show spots
    const showShare = showSpots / first.count;
    for (const lane of first.lanes) {
      stats[lane].showCredits += showShare;
    }
    showUsed = showSpots;
  }

  // Second group
  let showRemaining = showSpots - showUsed;
  if (showRemaining > 0 && second.count > 0) {
    if (second.count <= showRemaining) {
      for (const lane of second.lanes) {
        stats[lane].showCredits += 1;
      }
      showUsed += second.count;
    } else {
      const showShare = showRemaining / second.count;
      for (const lane of second.lanes) {
        stats[lane].showCredits += showShare;
      }
      showUsed = showSpots;
    }
  }

  // Third group
  showRemaining = showSpots - showUsed;
  if (showRemaining > 0 && third.count > 0) {
    if (third.count <= showRemaining) {
      for (const lane of third.lanes) {
        stats[lane].showCredits += 1;
      }
    } else {
      const showShare = showRemaining / third.count;
      for (const lane of third.lanes) {
        stats[lane].showCredits += showShare;
      }
    }
  }
}

// -----------------------
// Formatting helpers
// -----------------------

function fmtPct(p) {
  return `${(p * 100).toFixed(2)}%`;
}

function fmtBps(p) {
  return Math.round(p * 10000);
}

// -----------------------
// Exported functions for bot integration
// -----------------------

/**
 * Calculate Win/Place/Show probabilities for a race using Monte Carlo simulation.
 *
 * @param {number[]} scores - Array of 6 scores (1-10)
 * @param {number} samples - Number of simulations to run
 * @param {number} [salt=0] - Optional salt for seed variety
 * @returns {{
 *   scores: number[],
 *   samples: number,
 *   elapsedMs: number,
 *   winProbBps: number[],
 *   placeProbBps: number[],
 *   showProbBps: number[],
 *   lanes: Array<{lane: number, score: number, winProbBps: number, placeProbBps: number, showProbBps: number, winProb: number, placeProb: number, showProb: number}>
 * }}
 */
export function calculateProbabilities(scores, samples, salt = 0) {
  // Validate inputs
  if (!Array.isArray(scores) || scores.length !== LANE_COUNT) {
    throw new Error(`Expected ${LANE_COUNT} scores, got ${scores?.length}`);
  }
  if (!Number.isFinite(samples) || samples <= 0) {
    throw new Error('samples must be > 0');
  }

  // Clamp scores
  const clampedScores = scores.map(s => clampScore(s));

  // Initialize stats
  const stats = Array.from({ length: LANE_COUNT }, () => ({
    winCredits: 0,
    placeCredits: 0,
    showCredits: 0,
  }));

  // Seed generator state
  const seedState = { x: (salt * 0x9e3779b9) >>> 0 || 0x12345678 };
  // Mix in scores
  for (const s of clampedScores) {
    seedState.x = (seedState.x ^ (s * 0x85ebca6b)) >>> 0;
    splitmix32Next(seedState);
  }

  const started = Date.now();

  // Run simulations
  for (let i = 0; i < samples; i++) {
    const seed = splitmix32Next(seedState);
    const { finishOrder } = simulateFullRace(seed, clampedScores);
    accumulateStats(stats, finishOrder);
  }

  const elapsedMs = Date.now() - started;

  // Calculate probabilities
  const lanes = stats.map((s, lane) => ({
    lane,
    score: clampedScores[lane],
    winProbBps: fmtBps(s.winCredits / samples),
    placeProbBps: fmtBps(s.placeCredits / samples),
    showProbBps: fmtBps(s.showCredits / samples),
    winProb: s.winCredits / samples,
    placeProb: s.placeCredits / samples,
    showProb: s.showCredits / samples,
  }));

  // Extract BPS arrays for contract submission
  const winProbBps = lanes.map(l => l.winProbBps);
  const placeProbBps = lanes.map(l => l.placeProbBps);
  const showProbBps = lanes.map(l => l.showProbBps);

  return {
    scores: clampedScores,
    samples,
    elapsedMs,
    winProbBps,
    placeProbBps,
    showProbBps,
    lanes,
  };
}

/**
 * Format probability results for logging output.
 *
 * @param {Object} result - Result from calculateProbabilities
 * @returns {string} - Formatted string for console output
 */
export function formatProbabilitiesForLog(result) {
  const lines = [];
  lines.push('    ┌────────┬───────┬─────────────────┬─────────────────┬─────────────────┐');
  lines.push('    │  Lane  │ Score │    Win Prob     │   Place Prob    │   Show Prob     │');
  lines.push('    ├────────┼───────┼─────────────────┼─────────────────┼─────────────────┤');

  for (const r of result.lanes) {
    const winStr = `${fmtPct(r.winProb).padStart(7)} (${r.winProbBps.toString().padStart(4)} bps)`;
    const placeStr = `${fmtPct(r.placeProb).padStart(7)} (${r.placeProbBps.toString().padStart(4)} bps)`;
    const showStr = `${fmtPct(r.showProb).padStart(7)} (${r.showProbBps.toString().padStart(4)} bps)`;
    lines.push(`    │   ${r.lane}    │  ${r.score.toString().padStart(2)}   │ ${winStr} │ ${placeStr} │ ${showStr} │`);
  }

  lines.push('    └────────┴───────┴─────────────────┴─────────────────┴─────────────────┘');

  // Verify sums
  const winSum = result.lanes.reduce((a, r) => a + r.winProb, 0);
  const placeSum = result.lanes.reduce((a, r) => a + r.placeProb, 0);
  const showSum = result.lanes.reduce((a, r) => a + r.showProb, 0);
  lines.push(`    Sum checks: Win=${winSum.toFixed(4)} (≈1.00), Place=${placeSum.toFixed(4)} (≈2.00), Show=${showSum.toFixed(4)} (≈3.00)`);

  return lines.join('\n');
}

export default { calculateProbabilities, formatProbabilitiesForLog };

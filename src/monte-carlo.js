/**
 * Monte Carlo probability calculator for 6-lane giraffe races.
 * Outputs raw Win, Place, and Show probabilities in basis points.
 * 
 * NOTE: House edge is NOT applied here. The contract applies edge when converting
 * probabilities to odds: odds = (1 - houseEdge) / probability
 */

const LANE_COUNT = 6;
const SPEED_RANGE = 10;
const TRACK_LENGTH = 1000;
const FINISH_OVERSHOOT = 10;
const MAX_TICKS = 500;

// -----------------------
// Fast PRNG (xorshift128) - ~10-50x faster than keccak256
// -----------------------

class FastRng {
  constructor(seed) {
    this.s0 = seed >>> 0 || 0x12345678;
    this.s1 = Math.imul(seed, 0x85ebca6b) >>> 0 || 0x9abcdef0;
    this.s2 = Math.imul(seed, 0xc2b2ae35) >>> 0 || 0xdeadbeef;
    this.s3 = Math.imul(seed, 0x27d4eb2f) >>> 0 || 0xcafebabe;
    for (let i = 0; i < 20; i++) this.next();
  }

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

  const finishLine = TRACK_LENGTH + FINISH_OVERSHOOT;

  for (let t = 0; t < MAX_TICKS; t++) {
    let allFinished = true;
    for (let a = 0; a < LANE_COUNT; a++) {
      if (distances[a] < finishLine) {
        allFinished = false;
        break;
      }
    }
    if (allFinished) break;

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
      distances[a] += q > 0 ? q : 1;
    }
  }

  return calculateFinishOrder(distances);
}

function calculateFinishOrder(distances) {
  const sorted = distances
    .map((d, i) => ({ lane: i, distance: d }))
    .sort((a, b) => b.distance - a.distance);

  const groups = [];
  let currentGroup = { distance: sorted[0].distance, lanes: [sorted[0].lane] };

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].distance === currentGroup.distance) {
      currentGroup.lanes.push(sorted[i].lane);
    } else {
      groups.push(currentGroup);
      currentGroup = { distance: sorted[i].distance, lanes: [sorted[i].lane] };
    }
  }
  groups.push(currentGroup);

  const first = { lanes: [], count: 0 };
  const second = { lanes: [], count: 0 };
  const third = { lanes: [], count: 0 };

  let position = 0;
  for (const group of groups) {
    if (position === 0) {
      first.lanes = group.lanes;
      first.count = group.lanes.length;
      position += group.lanes.length;
    } else if (position === 1) {
      second.lanes = group.lanes;
      second.count = group.lanes.length;
      position += group.lanes.length;
    } else if (position === 2) {
      third.lanes = group.lanes;
      third.count = group.lanes.length;
      position += group.lanes.length;
    } else if (position >= 3) {
      break;
    }
  }

  return { first, second, third };
}

// -----------------------
// Probability accumulators with dead heat rules
// -----------------------

function accumulateStats(stats, finishOrder) {
  const { first, second, third } = finishOrder;

  // ===== WIN (1 spot) =====
  const winShare = 1 / first.count;
  for (const lane of first.lanes) {
    stats[lane].winCredits += winShare;
  }

  // ===== PLACE (2 spots total) =====
  const placeSpots = 2;
  let placeUsed = 0;

  if (first.count <= placeSpots) {
    for (const lane of first.lanes) {
      stats[lane].placeCredits += 1;
    }
    placeUsed = first.count;
  } else {
    const placeShare = placeSpots / first.count;
    for (const lane of first.lanes) {
      stats[lane].placeCredits += placeShare;
    }
    placeUsed = placeSpots;
  }

  const placeRemaining = placeSpots - placeUsed;
  if (placeRemaining > 0 && second.count > 0) {
    if (second.count <= placeRemaining) {
      for (const lane of second.lanes) {
        stats[lane].placeCredits += 1;
      }
    } else {
      const placeShare = placeRemaining / second.count;
      for (const lane of second.lanes) {
        stats[lane].placeCredits += placeShare;
      }
    }
  }

  // ===== SHOW (3 spots total) =====
  const showSpots = 3;
  let showUsed = 0;

  if (first.count <= showSpots) {
    for (const lane of first.lanes) {
      stats[lane].showCredits += 1;
    }
    showUsed = first.count;
  } else {
    const showShare = showSpots / first.count;
    for (const lane of first.lanes) {
      stats[lane].showCredits += showShare;
    }
    showUsed = showSpots;
  }

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
// Main calculation function
// -----------------------

/**
 * Calculate raw probabilities for a 6-lane race using Monte Carlo simulation.
 * Returns probabilities in basis points (0-10000).
 * 
 * NOTE: House edge is NOT applied here. The contract applies edge when converting
 * probabilities to odds: odds = (1 - houseEdge) / probability
 * 
 * @param {number[]} scores - Array of 6 scores (1-10 for each lane)
 * @param {number} samples - Number of simulations to run (default: 50000)
 * @returns {{ winProbBps: number[], placeProbBps: number[], showProbBps: number[], ... }}
 */
export function calculateProbabilities(scores, samples = 50000) {
  if (scores.length !== 6) {
    throw new Error('Expected exactly 6 scores');
  }

  const clampedScores = scores.map(s => clampScore(s));
  
  const stats = Array.from({ length: LANE_COUNT }, () => ({
    winCredits: 0,
    placeCredits: 0,
    showCredits: 0,
  }));

  // Seed generator with timestamp and scores
  const seedState = { x: (Date.now() * 0x9e3779b9) >>> 0 || 0x12345678 };
  for (const s of clampedScores) {
    seedState.x = (seedState.x ^ (s * 0x85ebca6b)) >>> 0;
    splitmix32Next(seedState);
  }

  const started = Date.now();

  // Run simulations
  for (let i = 0; i < samples; i++) {
    const seed = splitmix32Next(seedState);
    const finishOrder = simulateFullRace(seed, clampedScores);
    accumulateStats(stats, finishOrder);
  }

  const elapsedMs = Date.now() - started;

  // Convert credits to probabilities in basis points
  const winProbBps = [];
  const placeProbBps = [];
  const showProbBps = [];

  for (let i = 0; i < LANE_COUNT; i++) {
    const winProb = stats[i].winCredits / samples;
    const placeProb = stats[i].placeCredits / samples;
    const showProb = stats[i].showCredits / samples;

    // Convert to basis points (0-10000)
    winProbBps.push(Math.round(winProb * 10000));
    placeProbBps.push(Math.round(placeProb * 10000));
    showProbBps.push(Math.round(showProb * 10000));
  }

  return {
    winProbBps,
    placeProbBps,
    showProbBps,
    scores: clampedScores,
    samples,
    elapsedMs,
  };
}

/**
 * Format probabilities for logging
 */
export function formatProbabilitiesForLog(result) {
  const lines = [];
  lines.push('╔═══════════════════════════════════════════════════════════════════════════╗');
  lines.push('║         MONTE CARLO - WIN/PLACE/SHOW PROBABILITIES (6 lanes)             ║');
  lines.push('╠═══════════════════════════════════════════════════════════════════════════╣');
  lines.push(`║  Scores:  ${result.scores.join(', ').padEnd(60)}║`);
  lines.push(`║  Samples: ${result.samples.toLocaleString().padEnd(60)}║`);
  lines.push(`║  Elapsed: ${result.elapsedMs}ms (${Math.round(result.samples / result.elapsedMs * 1000).toLocaleString()} sims/sec)`.padEnd(76) + '║');
  lines.push('╠═══════════════════════════════════════════════════════════════════════════╣');
  lines.push('║  Lane │ Score │    Win Prob    │   Place Prob   │   Show Prob    ║');
  lines.push('╠═══════════════════════════════════════════════════════════════════════════╣');

  for (let i = 0; i < LANE_COUNT; i++) {
    const winPct = (result.winProbBps[i] / 100).toFixed(2) + '%';
    const placePct = (result.placeProbBps[i] / 100).toFixed(2) + '%';
    const showPct = (result.showProbBps[i] / 100).toFixed(2) + '%';
    
    const winStr = `${winPct.padStart(7)} (${result.winProbBps[i].toString().padStart(4)} bps)`;
    const placeStr = `${placePct.padStart(7)} (${result.placeProbBps[i].toString().padStart(4)} bps)`;
    const showStr = `${showPct.padStart(7)} (${result.showProbBps[i].toString().padStart(4)} bps)`;
    
    lines.push(`║   ${i}   │   ${result.scores[i].toString().padStart(2)}  │ ${winStr} │ ${placeStr} │ ${showStr} ║`);
  }

  lines.push('╚═══════════════════════════════════════════════════════════════════════════╝');
  
  // Sum checks
  const winSum = result.winProbBps.reduce((a, b) => a + b, 0);
  const placeSum = result.placeProbBps.reduce((a, b) => a + b, 0);
  const showSum = result.showProbBps.reduce((a, b) => a + b, 0);
  lines.push('');
  lines.push(`Sum checks: Win=${winSum} bps (≈10000), Place=${placeSum} bps (≈20000), Show=${showSum} bps (≈30000)`);
  lines.push('Note: House edge is applied ON-CHAIN, not here.');
  
  return lines.join('\n');
}

export default { calculateProbabilities, formatProbabilitiesForLog };

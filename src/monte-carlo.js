/**
 * Monte Carlo probability calculator for 6-lane giraffe races.
 * Outputs raw Win, Place, and Show probabilities in basis points.
 * 
 * Can be used as a library (import calculateProbabilities) or CLI:
 *   node src/monte-carlo.js --scores 10,10,10,10,10,10 --samples 50000
 *   node src/monte-carlo.js --scores 1,5,7,8,9,10 --samples 100000 --json
 * 
 * WINNER DETERMINATION: First to cross the finish line (1000 units) wins!
 * - Track which tick each racer crosses 1000
 * - Earliest tick = higher position
 * - Same tick = dead heat (tie)
 * 
 * Dead Heat Rules:
 *   - If tied for last qualifying position, probability is split
 *   - Example: 2-way tie for 2nd → each gets 0.5 credit for Place
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

  const finishTicks = [-1, -1, -1, -1, -1, -1];
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
      const r = rng.roll(SPEED_RANGE);
      const baseSpeed = r + 1;

      const raw = baseSpeed * bps[a];
      let q = Math.floor(raw / 10_000);
      const rem = raw % 10_000;
      if (rem > 0) {
        const pick = rng.roll(10_000);
        if (pick < rem) q += 1;
      }

      const prevDist = distances[a];
      distances[a] += q > 0 ? q : 1;

      if (finishTicks[a] === -1 && prevDist < TRACK_LENGTH && distances[a] >= TRACK_LENGTH) {
        finishTicks[a] = t;
      }
    }
  }

  const finishOrder = calculateFinishOrder(finishTicks, distances);
  return { finishOrder, finalDistances: distances, finishTicks };
}

function calculateFinishOrder(finishTicks, distances) {
  const sorted = finishTicks
    .map((tick, lane) => ({ lane, tick, distance: distances[lane] }))
    .sort((a, b) => {
      if (a.tick !== b.tick) return a.tick - b.tick;
      return b.distance - a.distance;
    });

  const groups = [];
  let currentGroup = { tick: sorted[0].tick, lanes: [sorted[0].lane] };

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].tick === currentGroup.tick) {
      currentGroup.lanes.push(sorted[i].lane);
    } else {
      groups.push(currentGroup);
      currentGroup = { tick: sorted[i].tick, lanes: [sorted[i].lane] };
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
// Library exports
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

  const seedState = { x: (Date.now() * 0x9e3779b9) >>> 0 || 0x12345678 };
  for (const s of clampedScores) {
    seedState.x = (seedState.x ^ (s * 0x85ebca6b)) >>> 0;
    splitmix32Next(seedState);
  }

  const started = Date.now();

  for (let i = 0; i < samples; i++) {
    const seed = splitmix32Next(seedState);
    const { finishOrder } = simulateFullRace(seed, clampedScores);
    accumulateStats(stats, finishOrder);
  }

  const elapsedMs = Date.now() - started;

  const winProbBps = [];
  const placeProbBps = [];
  const showProbBps = [];

  for (let i = 0; i < LANE_COUNT; i++) {
    const winProb = stats[i].winCredits / samples;
    const placeProb = stats[i].placeCredits / samples;
    const showProb = stats[i].showCredits / samples;

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
  
  const winSum = result.winProbBps.reduce((a, b) => a + b, 0);
  const placeSum = result.placeProbBps.reduce((a, b) => a + b, 0);
  const showSum = result.showProbBps.reduce((a, b) => a + b, 0);
  lines.push('');
  lines.push(`Sum checks: Win=${winSum} bps (≈10000), Place=${placeSum} bps (≈20000), Show=${showSum} bps (≈30000)`);
  lines.push('Note: House edge is applied ON-CHAIN, not here.');
  
  return lines.join('\n');
}

export default { calculateProbabilities, formatProbabilitiesForLog };

// -----------------------
// CLI support
// -----------------------

function parseArgs(argv) {
  const out = {
    scores: null,
    samples: 10_000,
    salt: 0,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scores') out.scores = String(argv[++i] ?? '');
    else if (a === '--samples') out.samples = Number(argv[++i]);
    else if (a === '--salt') out.salt = Number(argv[++i]) || 0;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function usage() {
  console.log('monte-carlo.js - Win/Place/Show probability calculator');
  console.log('');
  console.log('Usage:');
  console.log('  node src/monte-carlo.js --scores s1,s2,s3,s4,s5,s6 [options]');
  console.log('');
  console.log('Options:');
  console.log('  --scores  s1,s2,s3,s4,s5,s6   (required; each 1..10)');
  console.log('  --samples N                   (default 10000)');
  console.log('  --salt    X                   (optional; numeric salt for seed variety)');
  console.log('  --json                        (output raw JSON for programmatic use)');
  console.log('');
  console.log('WINNER DETERMINATION: First to cross the finish line (1000 units) wins!');
  console.log('');
  console.log('Output:');
  console.log('  Win:   Probability of finishing 1st (in basis points)');
  console.log('  Place: Probability of finishing 1st OR 2nd (in basis points)');
  console.log('  Show:  Probability of finishing 1st, 2nd, OR 3rd (in basis points)');
  console.log('');
  console.log('Note: House edge is applied ON-CHAIN, not here.');
}

function parseScores(s) {
  const parts = String(s)
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
  if (parts.length !== 6) throw new Error('Expected 6 comma-separated scores');
  return parts.map(x => clampScore(Number(x)));
}

// Only run CLI if invoked directly
const isMain = process.argv[1]?.endsWith('monte-carlo.js');
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  
  if (args.help) {
    usage();
    process.exit(0);
  }
  
  if (!args.scores) {
    usage();
    console.error('\nError: --scores is required');
    process.exit(1);
  }
  
  if (!Number.isFinite(args.samples) || args.samples <= 0) {
    console.error('Error: --samples must be > 0');
    process.exit(1);
  }

  const scores = parseScores(args.scores);
  const result = calculateProbabilities(scores, args.samples);

  if (args.json) {
    const output = {
      scores: result.scores,
      samples: result.samples,
      elapsedMs: result.elapsedMs,
      lanes: result.scores.map((score, lane) => ({
        lane,
        score,
        winProbBps: result.winProbBps[lane],
        placeProbBps: result.placeProbBps[lane],
        showProbBps: result.showProbBps[lane],
      })),
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(formatProbabilitiesForLog(result));
  }
}

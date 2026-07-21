const COLS = 6;
const ROWS = 5;
const MIN_WIN = 8;

const SYMBOLS = [
  { id: 'heart',    weight: 7,  pay: { 8: 10, 12: 20, 15: 40, 20: 80, 25: 120, 30: 200 } },
  { id: 'diamond',  weight: 8,  pay: { 8: 15, 12: 35, 15: 70, 20: 140, 25: 260, 30: 500 } },
  { id: 'banana',   weight: 10, pay: { 8: 8,  12: 16, 15: 30, 20: 60,  25: 90,  30: 160 } },
  { id: 'apple',    weight: 12, pay: { 8: 5,  12: 10, 15: 20, 20: 40,  25: 70,  30: 110 } },
  { id: 'orange',   weight: 14, pay: { 8: 5,  12: 10, 15: 20, 20: 40,  25: 70,  30: 110 } },
  { id: 'watermelon', weight: 15, pay: { 8: 4,  12: 8,  15: 15, 20: 30,  25: 55,  30: 90 } },
  { id: 'plum',     weight: 16, pay: { 8: 3,  12: 6,  15: 12, 20: 24,  25: 40,  30: 75 } },
  { id: 'grape',    weight: 18, pay: { 8: 2,  12: 4,  15: 9,  20: 18,  25: 30,  30: 60 } },
  { id: 'scatter',  weight: 2,  scatter: true, pay: {} },
];

const TOTAL_WEIGHT = SYMBOLS.reduce((s, x) => s + x.weight, 0);

function rng(seed) {
  // Simple mulberry32 PRNG from seed
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickSymbol(random) {
  const roll = random() * TOTAL_WEIGHT;
  let acc = 0;
  for (const sym of SYMBOLS) {
    acc += sym.weight;
    if (roll <= acc) return { ...sym };
  }
  return { ...SYMBOLS[SYMBOLS.length - 1] };
}

function generateGrid(random) {
  const grid = [];
  for (let c = 0; c < COLS; c++) {
    grid[c] = [];
    for (let r = 0; r < ROWS; r++) {
      grid[c][r] = pickSymbol(random);
    }
  }
  return grid;
}

function findWins(grid) {
  const counts = {};
  const positions = {};

  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const sym = grid[c][r];
      if (!sym || sym.scatter) continue;
      if (!counts[sym.id]) {
        counts[sym.id] = 0;
        positions[sym.id] = [];
      }
      counts[sym.id]++;
      positions[sym.id].push([c, r]);
    }
  }

  const wins = [];
  for (const id in counts) {
    if (counts[id] >= MIN_WIN) {
      const match = SYMBOLS.find(s => s.id === id);
      const pay = payFor(match, counts[id]);
      if (pay > 0) {
        wins.push({ id, count: counts[id], positions: positions[id], pay });
      }
    }
  }
  return wins;
}

function payFor(sym, count) {
  const keys = Object.keys(sym.pay).map(Number).sort((a, b) => a - b);
  let value = 0;
  for (const k of keys) {
    if (k <= count) value = sym.pay[k];
  }
  return value; // multiplier, actual = value * bet
}

function removeAndDrop(grid, wins, random) {
  // Remove winners
  const toRemove = new Set();
  for (const win of wins) {
    for (const [c, r] of win.positions) {
      toRemove.add(c + ',' + r);
    }
  }
  for (const key of toRemove) {
    const [c, r] = key.split(',').map(Number);
    grid[c][r] = null;
  }

  // Drop symbols
  for (let c = 0; c < COLS; c++) {
    const kept = [];
    for (let r = ROWS - 1; r >= 0; r--) {
      if (grid[c][r]) kept.push(grid[c][r]);
    }
    for (let row = ROWS - 1; row >= 0; row--) {
      grid[c][row] = kept.shift() || pickSymbol(random);
    }
  }
}

function fullSpin(bet, seed) {
  const random = rng(seed);
  const grid = generateGrid(random);
  let totalWin = 0;
  const events = [];

  // Initial spin
  events.push({ type: 'spin', grid: cloneGrid(grid) });

  let maxSteps = 6;
  while (maxSteps-- > 0) {
    const wins = findWins(grid);
    if (wins.length === 0) break;

    const stepWin = wins.reduce((s, w) => s + w.pay, 0) * bet;
    totalWin += stepWin;

    events.push({
      type: 'tumble',
      wins: wins.map(w => ({
        id: w.id,
        count: w.count,
        positions: w.positions,
        pay: w.pay * bet,
      })),
      stepWin,
      gridBefore: cloneGrid(grid),
    });

    removeAndDrop(grid, wins, random);
    events.push({ type: 'drop', grid: cloneGrid(grid) });
  }

  return { finalGrid: cloneGrid(grid), totalWin, events };
}

function cloneGrid(grid) {
  return grid.map(col => col.map(sym => sym ? { ...sym } : null));
}

module.exports = { fullSpin, SYMBOLS, COLS, ROWS, MIN_WIN };

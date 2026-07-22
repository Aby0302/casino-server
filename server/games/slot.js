const rng = require('../rng');
const slotConfig = require('./slot-config');

const COLS = 6;
const ROWS = 5;

const BASE_SYMBOLS = [
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

function buildSymbols() {
  const config = slotConfig.get();
  const payScale = config.payScale;

  return BASE_SYMBOLS.map(sym => {
    const override = config.symbolOverrides[sym.id];
    if (!override) {
      if (payScale === 1.0) return sym;
      const scaled = {};
      for (const [k, v] of Object.entries(sym.pay)) scaled[k] = Math.round(v * payScale);
      return { ...sym, pay: scaled };
    }
    const merged = { ...sym };
    if (override.weight != null) merged.weight = override.weight;
    if (override.pay != null) {
      merged.pay = {};
      for (const [k, v] of Object.entries(override.pay)) merged.pay[k] = Math.round(v * payScale);
    } else if (payScale !== 1.0) {
      merged.pay = {};
      for (const [k, v] of Object.entries(sym.pay)) merged.pay[k] = Math.round(v * payScale);
    }
    if (override.scatter != null) merged.scatter = override.scatter;
    return merged;
  });
}

let SYMBOLS = buildSymbols();
let TOTAL_WEIGHT = SYMBOLS.reduce((s, x) => s + x.weight, 0);

function refreshSymbols() {
  SYMBOLS = buildSymbols();
  TOTAL_WEIGHT = SYMBOLS.reduce((s, x) => s + x.weight, 0);
}

function minWin() {
  return slotConfig.get().minWin;
}

function maxCascade() {
  return slotConfig.get().maxCascade;
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
  const mw = minWin();

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
    if (counts[id] >= mw) {
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
  return value;
}

function removeAndDrop(grid, wins, random) {
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
  refreshSymbols();

  const random = rng.createSeeded(seed, 'server/games/slot.js');
  const grid = generateGrid(random);
  let totalWin = 0;
  const events = [];

  events.push({ type: 'spin', grid: cloneGrid(grid) });

  let steps = maxCascade();
  while (steps-- > 0) {
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

module.exports = { fullSpin, buildSymbols: () => [...buildSymbols()], COLS, ROWS, getConfig: slotConfig.get };

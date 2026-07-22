const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  minWin: 8,
  maxCascade: 6,
  payScale: 1.0,
  symbolOverrides: {},
};

const DATA_DIR = path.join(__dirname, '..', '..', 'slot', 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'slot-config.json');
const FALLBACK_FILE = path.join(__dirname, 'slot-config.json');

let cached = null;

function ensureDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {}
}

function load() {
  ensureDir();

  const candidates = [
    CONFIG_FILE,
    FALLBACK_FILE,
  ];

  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8');
        const parsed = JSON.parse(raw);
        cached = { ...DEFAULT_CONFIG, ...parsed };
        return cached;
      }
    } catch (e) {
      console.warn(`[slot-config] Could not load ${file}: ${e.message}`);
    }
  }

  cached = { ...DEFAULT_CONFIG };
  return cached;
}

function get() {
  if (!cached) load();
  return { ...cached };
}

function update(partial) {
  const current = get();
  Object.assign(current, partial);
  cached = current;

  ensureDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(current, null, 2) + '\n');
}

function reset() {
  cached = { ...DEFAULT_CONFIG };
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cached, null, 2) + '\n');
  return cached;
}

load();

module.exports = { get, update, reset, DEFAULT_CONFIG };

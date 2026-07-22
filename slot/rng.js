const crypto = require('crypto');

const auditLog = [];
const MAX_LOG_SIZE = 10000;

function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cryptoRandom() {
  return crypto.randomBytes(6).readUIntBE(0, 6) / 0x1000000000000;
}

function log(source, type, data = {}) {
  auditLog.push({ timestamp: Date.now(), source, type, ...data });
  if (auditLog.length > MAX_LOG_SIZE) auditLog.shift();
}

const rng = {
  randomFloat(source) {
    const val = cryptoRandom();
    log(source || 'unknown', 'randomFloat', { value: val });
    return val;
  },

  randomInt(min, max, source) {
    const val = min + Math.floor(cryptoRandom() * (max - min + 1));
    log(source || 'unknown', 'randomInt', { min, max, value: val });
    return val;
  },

  randomSeed(source) {
    const seed = crypto.randomBytes(4).readUInt32BE(0);
    log(source || 'unknown', 'randomSeed', { seed });
    return seed;
  },

  createSeeded(seed, source) {
    log(source || 'unknown', 'createSeeded', { seed });
    return mulberry32(seed);
  },

  shuffle(array, source) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = rng.randomInt(0, i, source || 'unknown');
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    log(source || 'unknown', 'shuffle', { length: array.length });
    return arr;
  },

  pickRandom(array, source) {
    const idx = rng.randomInt(0, array.length - 1, source || 'unknown');
    log(source || 'unknown', 'pickRandom', { arrayLength: array.length, index: idx });
    return array[idx];
  },

  weightedPick(array, weightFn, source) {
    const totalWeight = array.reduce((s, item) => s + weightFn(item), 0);
    let roll = cryptoRandom() * totalWeight;
    for (const item of array) {
      roll -= weightFn(item);
      if (roll <= 0) {
        log(source || 'unknown', 'weightedPick', { totalWeight, index: array.indexOf(item) });
        return item;
      }
    }
    return array[array.length - 1];
  },

  getAuditLog(limit) {
    return auditLog.slice(-(limit || 100));
  },

  clearAuditLog() {
    auditLog.length = 0;
  },

  getStats() {
    const byType = {};
    const bySource = {};
    for (const entry of auditLog) {
      byType[entry.type] = (byType[entry.type] || 0) + 1;
      bySource[entry.source] = (bySource[entry.source] || 0) + 1;
    }
    return { totalCalls: auditLog.length, byType, bySource };
  },
};

module.exports = rng;

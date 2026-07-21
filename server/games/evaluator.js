// Texas Hold'em hand evaluator
// Returns ranking: 9=SF, 8=FK, 7=FH, 6=Flush, 5=Straight, 4=TK, 3=TP, 2=OP, 1=HC

const RANK_ORDER = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

function rankValue(r) { return RANK_ORDER.indexOf(r) + 2; }

function byRank(a, b) { return b.val - a.val; }

function evaluate(cards) {
  const vals = cards.map(c => ({ r: c.rank, v: rankValue(c.rank), s: c.suit }));
  vals.sort(byRank);

  const isFlush = vals.every(c => c.s === vals[0].s);

  const rankCounts = {};
  for (const c of vals) rankCounts[c.r] = (rankCounts[c.r] || 0) + 1;
  const groups = Object.entries(rankCounts)
    .map(([r, count]) => ({ rank: r, val: rankValue(r), count }))
    .sort((a, b) => b.count - a.count || b.val - a.val);

  const isStraight = checkStraight(vals);
  if (isFlush && isStraight) {
    // Royal flush = straight to Ace with flush
    const high = isStraight;
    return { rank: 9, name: high === 14 ? 'Royal Flush' : 'Straight Flush', score: 9e6 + high * 1e4, high };
  }
  if (groups[0].count === 4) {
    const kicker = groups.find(g => g.count < 4);
    return { rank: 8, name: 'Four of a Kind', score: 8e6 + groups[0].val * 1e4 + (kicker ? kicker.val : 0), high: groups[0].val };
  }
  if (groups[0].count === 3 && groups[1] && groups[1].count >= 2) {
    return { rank: 7, name: 'Full House', score: 7e6 + groups[0].val * 1e4 + groups[1].val, high: groups[0].val };
  }
  if (isFlush) {
    const kickers = vals.map(c => c.v).sort((a, b) => b - a);
    const score = 6e6 + kickers.reduce((s, v, i) => s + v * Math.pow(15, 4 - i), 0);
    return { rank: 6, name: 'Flush', score, high: kickers[0] };
  }
  if (isStraight) {
    return { rank: 5, name: 'Straight', score: 5e6 + isStraight * 1e4, high: isStraight };
  }
  if (groups[0].count === 3) {
    const kickers = groups.filter(g => g.count < 3).map(g => g.val).sort((a, b) => b - a);
    const score = 4e6 + groups[0].val * 1e4 + (kickers[0] || 0) * 15 + (kickers[1] || 0);
    return { rank: 4, name: 'Three of a Kind', score, high: groups[0].val };
  }
  if (groups[0].count === 2 && groups[1] && groups[1].count === 2) {
    const pairs = groups.filter(g => g.count === 2).map(g => g.val).sort((a, b) => b - a);
    const kicker = groups.find(g => g.count === 1);
    return { rank: 3, name: 'Two Pair', score: 3e6 + pairs[0] * 1e4 + pairs[1] * 15 + (kicker ? kicker.val : 0), high: pairs[0] };
  }
  if (groups[0].count === 2) {
    const kickers = groups.filter(g => g.count === 1).map(g => g.val).sort((a, b) => b - a);
    const score = 2e6 + groups[0].val * 1e4 + (kickers[0] || 0) * 225 + (kickers[1] || 0) * 15 + (kickers[2] || 0);
    return { rank: 2, name: 'One Pair', score: 2e6 + groups[0].val * 1e4 + (kickers[0] || 0), high: groups[0].val };
  }
  const kickers = vals.map(c => c.v).sort((a, b) => b - a);
  const score = 1e6 + kickers.reduce((s, v, i) => s + v * Math.pow(15, 4 - i), 0);
  return { rank: 1, name: 'High Card', score, high: kickers[0] };
}

function checkStraight(vals) {
  const unique = [...new Set(vals.map(c => c.v))].sort((a, b) => b - a);
  if (unique.length < 5) return 0;
  for (let i = 0; i <= unique.length - 5; i++) {
    if (unique[i] - unique[i + 4] === 4) return unique[i];
  }
  // Ace-low straight (A-2-3-4-5)
  if (unique.includes(14) && unique.includes(2) && unique.includes(3) && unique.includes(4) && unique.includes(5))
    return 5;
  return 0;
}

function bestHand(hole, community) {
  const all = [...hole, ...community];
  if (all.length < 5) return null;
  let best = null;
  const combos = combinations(all, 5);
  for (const combo of combos) {
    const result = evaluate(combo);
    if (!best || result.score > best.score) best = result;
  }
  return best;
}

function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, k - 1).map(c => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

function compareHands(a, b) {
  return a.score - b.score;
}

module.exports = { evaluate, bestHand, compareHands };

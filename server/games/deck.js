const rng = require('../rng');

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

function createDeck() {
  const deck = [];
  for (const suit of SUITS)
    for (const rank of RANKS)
      deck.push({ rank, suit, value: RANKS.indexOf(rank) + 2 });
  return deck;
}

function freshDeck() {
  return rng.shuffle(createDeck(), 'server/games/deck.js');
}

module.exports = { freshDeck, SUITS, RANKS };

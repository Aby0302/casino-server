const { freshDeck } = require('./deck');

class BlackjackTable {
  constructor() {
    this.players = new Map(); // clientId -> { hands: [[card,...],...], bet: [n,...] }
    this.dealer = [];
    this.deck = [];
    this.phase = 'waiting'; // waiting | dealing | player-turn | dealer-turn | result
    this.currentPlayer = null;
    this.currentHand = 0;
  }

  join(clientId) {
    if (this.players.has(clientId)) return;
    this.players.set(clientId, { hands: [[]], bets: [0], currentHand: 0 });
  }

  leave(clientId) {
    this.players.delete(clientId);
  }

  cardValue(card) {
    if (card.rank === 'A') return 11;
    if (['K','Q','J'].includes(card.rank)) return 10;
    return parseInt(card.rank);
  }

  handValue(hand) {
    let val = hand.reduce((s, c) => s + this.cardValue(c), 0);
    let aces = hand.filter(c => c.rank === 'A').length;
    while (val > 21 && aces > 0) { val -= 10; aces--; }
    return val;
  }

  startRound() {
    const active = [...this.players.values()].filter(p => p.bets[0] > 0);
    if (active.length === 0) return false;

    this.deck = freshDeck();
    this.dealer = [];
    this.phase = 'dealing';

    // Deal 2 cards to each player and dealer
    for (const [, player] of this.players) {
      if (player.bets[0] > 0) {
        player.hands = [[this.deck.pop(), this.deck.pop()]];
        player.currentHand = 0;
      }
    }
    this.dealer = [this.deck.pop(), this.deck.pop()];

    // Check for naturals
    this.phase = 'player-turn';
    // Find first player with a hand
    for (const [id, player] of this.players) {
      if (player.bets[0] > 0) {
        this.currentPlayer = id;
        break;
      }
    }
    return true;
  }

  placeBet(clientId, amount) {
    const player = this.players.get(clientId);
    if (!player) return false;
    player.bets[0] = amount;
    return true;
  }

  act(clientId, action) {
    const player = this.players.get(clientId);
    if (!player || clientId !== this.currentPlayer) return null;

    const hand = player.hands[player.currentHand];
    if (!hand) return null;

    switch (action) {
      case 'hit': {
        hand.push(this.deck.pop());
        const val = this.handValue(hand);
        if (val > 21) {
          // Bust - move to next hand/player
          this.nextHandOrPlayer(clientId);
        }
        return { hand: hand.map(c => ({ rank: c.rank, suit: c.suit })), value: val, bust: val > 21 };
      }
      case 'stand': {
        this.nextHandOrPlayer(clientId);
        return { stand: true };
      }
      case 'double': {
        player.bets[player.currentHand] *= 2;
        hand.push(this.deck.pop());
        this.nextHandOrPlayer(clientId);
        const val = this.handValue(hand);
        return { hand: hand.map(c => ({ rank: c.rank, suit: c.suit })), value: val, doubled: true };
      }
      case 'split': {
        if (hand.length !== 2 || hand[0].rank !== hand[1].rank) return null;
        player.hands = [
          [hand[0], this.deck.pop()],
          [hand[1], this.deck.pop()]
        ];
        player.bets = [player.bets[0], player.bets[0]];
        player.currentHand = 0;
        return { split: true, hands: player.hands.map(h => h.map(c => ({ rank: c.rank, suit: c.suit }))) };
      }
    }
    return null;
  }

  nextHandOrPlayer(clientId) {
    const player = this.players.get(clientId);
    if (!player) return;

    // Try next hand of same player
    if (player.currentHand < player.hands.length - 1) {
      player.currentHand++;
      return;
    }

    // Move to next player
    const ids = [...this.players.keys()];
    const idx = ids.indexOf(clientId);
    this.currentPlayer = null;

    for (let i = idx + 1; i < ids.length; i++) {
      const p = this.players.get(ids[i]);
      if (p && p.bets[0] > 0) {
        this.currentPlayer = ids[i];
        return;
      }
    }

    // All players done - dealer turn
    this.dealerTurn();
  }

  dealerTurn() {
    this.phase = 'dealer-turn';
    while (this.handValue(this.dealer) < 17)
      this.dealer.push(this.deck.pop());
    this.settle();
  }

  settle() {
    this.phase = 'result';
    const dealerVal = this.handValue(this.dealer);
    const dealerBJ = dealerVal === 21 && this.dealer.length === 2;
    const results = [];

    for (const [id, player] of this.players) {
      if (player.bets[0] === 0) continue;
      let totalWin = 0;

      for (let i = 0; i < player.hands.length; i++) {
        const hand = player.hands[i];
        const bet = player.bets[i] || 0;
        const val = this.handValue(hand);
        const isBJ = val === 21 && hand.length === 2;

        let win = 0;
        if (val > 21) win = 0; // Bust
        else if (isBJ && !dealerBJ) win = bet * 2.5; // Blackjack pays 3:2
        else if (dealerVal > 21 || val > dealerVal) win = bet * 2; // Win
        else if (val === dealerVal) win = bet; // Push
        // else lose

        totalWin += win;
      }

      results.push({ playerId: id, win: Math.floor(totalWin) });
    }

    this.phase = 'waiting';
    // Reset bets
    for (const [, player] of this.players)
      player.bets = [0];

    return { dealer: this.dealer.map(c => ({ rank: c.rank, suit: c.suit })), dealerVal, results };
  }

  getState() {
    const players = {};
    for (const [id, player] of this.players) {
      players[id] = {
        hands: player.hands.map(h => h.map(c => ({ rank: c.rank, suit: c.suit }))),
        bets: player.bets,
        currentHand: player.currentHand,
        value: player.hands[0] ? this.handValue(player.hands[player.currentHand || 0]) : 0,
      };
    }
    return {
      phase: this.phase,
      currentPlayer: this.currentPlayer,
      dealer: this.phase === 'result' || this.phase === 'dealer-turn'
        ? this.dealer.map(c => ({ rank: c.rank, suit: c.suit }))
        : this.dealer.length > 0 ? [{ rank: this.dealer[0].rank, suit: this.dealer[0].suit }, { hidden: true }] : [],
      players,
    };
  }
}

module.exports = { BlackjackTable };

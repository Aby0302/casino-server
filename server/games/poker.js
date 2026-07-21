const { freshDeck } = require('./deck');
const { bestHand } = require('./evaluator');

// Game states
const PHASES = { WAITING: 0, PREFLOP: 1, FLOP: 2, TURN: 3, RIVER: 4, SHOWDOWN: 5 };

class PokerTable {
  constructor(id, maxPlayers = 6, smallBlind = 5, bigBlind = 10) {
    this.id = id;
    this.maxPlayers = maxPlayers;
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;
    this.players = [];
    this.seats = Array(maxPlayers).fill(null);
    this.deck = [];
    this.community = [];
    this.pot = 0;
    this.currentBet = 0;
    this.phase = PHASES.WAITING;
    this.dealerPos = -1;
    this.currentPlayer = -1;
    this.minRaise = bigBlind;
    this.lastRaise = bigBlind;
    this.handId = 0;
  }

  join(clientId, name, buyIn) {
    const seat = this.seats.indexOf(null);
    if (seat === -1) return null;
    const player = { id: clientId, name, seat, chips: buyIn, bet: 0, hole: [], folded: false, allIn: false };
    this.players.push(player);
    this.seats[seat] = player;
    return player;
  }

  leave(clientId) {
    const idx = this.players.findIndex(p => p.id === clientId);
    if (idx === -1) return;
    const p = this.players[idx];
    this.seats[p.seat] = null;
    this.players.splice(idx, 1);
  }

  startHand() {
    if (this.players.length < 2) return false;

    this.handId++;
    this.deck = freshDeck();
    this.community = [];
    this.pot = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.lastRaise = this.bigBlind;

    // Reset players
    for (const p of this.players) {
      p.hole = [];
      p.bet = 0;
      p.folded = false;
      p.allIn = false;
    }

    // Rotate dealer
    this.dealerPos = (this.dealerPos + 1) % this.maxPlayers;
    while (!this.seats[this.dealerPos]) this.dealerPos = (this.dealerPos + 1) % this.maxPlayers;

    // Deal 2 cards each
    for (const p of this.players) {
      p.hole.push(this.deck.pop(), this.deck.pop());
    }

    // Blinds
    const active = this.players.filter(p => !p.folded);
    const sb = this.nextPlayer(this.dealerPos);
    const bb = this.nextPlayer(sb);
    this.postBlind(sb, this.smallBlind);
    this.postBlind(bb, this.bigBlind);
    this.currentBet = this.bigBlind;

    // Set first to act (after BB)
    this.currentPlayer = this.nextPlayer(bb);
    this.phase = PHASES.PREFLOP;
    return true;
  }

  nextPlayer(from) {
    let pos = from;
    for (let i = 0; i < this.maxPlayers; i++) {
      pos = (pos + 1) % this.maxPlayers;
      if (this.seats[pos] && !this.seats[pos].folded && !this.seats[pos].allIn)
        return pos;
    }
    return -1;
  }

  postBlind(seat, amount) {
    const p = this.seats[seat];
    if (!p) return;
    const actual = Math.min(amount, p.chips);
    p.chips -= actual;
    p.bet += actual;
    this.pot += actual;
    if (p.chips === 0) p.allIn = true;
  }

  act(clientId, action, amount = 0) {
    const player = this.players.find(p => p.id === clientId);
    if (!player || player.folded || player.allIn) return null;
    if (this.phase === PHASES.WAITING || this.phase === PHASES.SHOWDOWN) return null;

    const seat = player.seat;
    if (seat !== this.currentPlayer) return null;

    switch (action) {
      case 'fold':
        player.folded = true;
        break;

      case 'check':
        if (player.bet < this.currentBet) return null;
        break;

      case 'call':
        const callAmt = Math.min(this.currentBet - player.bet, player.chips);
        player.chips -= callAmt;
        player.bet += callAmt;
        this.pot += callAmt;
        if (player.chips === 0) player.allIn = true;
        break;

      case 'raise': {
        const total = Math.min(amount, player.chips + player.bet);
        if (total <= this.currentBet) return null;
        const raiseAmt = total - player.bet;
        player.chips -= raiseAmt;
        player.bet = total;
        this.pot += raiseAmt;
        this.lastRaise = total - this.currentBet;
        this.currentBet = total;
        if (player.chips === 0) player.allIn = true;
        break;
      }
      default:
        return null;
    }

    // Check if hand should advance
    this.advancePhase();
    return { phase: this.phase, pot: this.pot };
  }

  advancePhase() {
    const active = this.players.filter(p => !p.folded && !p.allIn);
    if (active.length <= 1) {
      this.phase = PHASES.SHOWDOWN;
      return;
    }

    // Check if all active players have matched the current bet
    const allMatched = active.every(p => p.bet >= this.currentBet || p.allIn);
    if (!allMatched) {
      this.currentPlayer = this.nextPlayer(this.currentPlayer);
      return;
    }

    // Advance to next street
    switch (this.phase) {
      case PHASES.PREFLOP:
        this.community.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
        this.phase = PHASES.FLOP;
        break;
      case PHASES.FLOP:
        this.community.push(this.deck.pop());
        this.phase = PHASES.TURN;
        break;
      case PHASES.TURN:
        this.community.push(this.deck.pop());
        this.phase = PHASES.RIVER;
        break;
      case PHASES.RIVER:
        this.phase = PHASES.SHOWDOWN;
        return;
    }

    // Reset bets for next street
    for (const p of this.players) p.bet = 0;
    this.currentBet = 0;
    this.lastRaise = this.bigBlind;

    // First to act after dealer
    const first = this.nextPlayer(this.dealerPos);
    this.currentPlayer = first !== -1 ? first : this.currentPlayer;
  }

  showdown() {
    const active = this.players.filter(p => !p.folded);
    if (active.length === 0) return [];

    if (active.length === 1) {
      return [{ player: active[0], hand: { name: 'Last Man Standing' }, winAmount: this.pot }];
    }

    // Evaluate hands
    const results = active.map(p => ({
      player: p,
      hand: bestHand(p.hole, this.community),
    }));
    results.sort((a, b) => (b.hand?.score || 0) - (a.hand?.score || 0));

    // Distribute pot to winner(s) - split for ties
    const bestScore = results[0].hand?.score || 0;
    const winners = results.filter(r => r.hand?.score === bestScore);
    const winAmount = Math.floor(this.pot / winners.length);

    for (const w of winners)
      w.player.chips += winAmount;

    return winners.map(w => ({
      player: w.player,
      hand: w.hand,
      winAmount,
    }));
  }

  getState() {
    return {
      id: this.id,
      phase: this.phase,
      pot: this.pot,
      currentBet: this.currentBet,
      community: this.community,
      dealerPos: this.dealerPos,
      currentPlayer: this.currentPlayer,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        seat: p.seat,
        chips: p.chips,
        bet: p.bet,
        folded: p.folded,
        allIn: p.allIn,
        holeCount: p.hole.length,
      })),
    };
  }
}

module.exports = { PokerTable, PHASES };

const express = require('express');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const { PokerTable, PHASES } = require('./games/poker');
const { BlackjackTable } = require('./games/blackjack');
const { fullSpin } = require('./games/slot');

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3001;
const API_TOKEN = process.env.API_TOKEN || ''; // Empty = no auth

// Chip ledger
const balances = new Map();

function auth(req, res, next) {
  if (!API_TOKEN) return next();
  const token = req.headers['x-api-token'];
  if (token !== API_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function getBalance(clientId) {
  return balances.get(clientId) ?? 10000;
}
function setBalance(clientId, amount) {
  balances.set(clientId, Math.max(0, amount));
}

// Game instances
const pokerTables = new Map(); // tableId -> PokerTable
const blackjackTables = new Map(); // tableId -> BlackjackTable

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

// Serve games
app.use('/slot', express.static(path.join(__dirname, '..', 'slot')));
app.use('/sugar-rush', express.static(path.join(__dirname, '..', 'sugar-rush-clone', 'frontend', 'dist')));
app.use('/models', express.static(path.join(__dirname, 'models')));
app.use('/maps', express.static(path.join(__dirname, 'maps')));

app.get('/', (req, res) => {
  res.json({
    games: ['/slot', '/sugar-rush'],
    models: '/models',
    maps: '/maps',
    ws: 'ws://' + req.headers.host,
    poker: '/ws?game=poker',
    blackjack: '/ws?game=blackjack',
  });
});

// REST chip API (protected by API_TOKEN if set)
app.use(express.json());
app.get('/api/balance/:clientId', auth, (req, res) => {
  res.json({ balance: getBalance(req.params.clientId) });
});
app.post('/api/balance/:clientId', auth, (req, res) => {
  const { amount } = req.body;
  if (typeof amount !== 'number') return res.status(400).json({ error: 'amount required' });
  setBalance(req.params.clientId, getBalance(req.params.clientId) + amount);
  res.json({ balance: getBalance(req.params.clientId) });
});

// WebSocket routing
function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const game = url.searchParams.get('game') || 'balance';
  const clientId = req.headers['sec-websocket-protocol'] || `client_${Date.now()}`;
  console.log(`${game} client connected: ${clientId}`);

  // Balance-only mode (used by slot WebView)
  if (game === 'balance') {
    send(ws, { type: 'connected', game: 'balance', balance: getBalance(clientId) });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        switch (msg.type) {
          case 'bet': {
            const bet = Math.min(msg.amount, getBalance(clientId));
            setBalance(clientId, getBalance(clientId) - bet);
            send(ws, { type: 'balance', balance: getBalance(clientId), bet });
            break;
          }
          case 'win': {
            setBalance(clientId, getBalance(clientId) + msg.amount);
            send(ws, { type: 'balance', balance: getBalance(clientId), win: msg.amount });
            break;
          }
          case 'reset':
            setBalance(clientId, 10000);
            send(ws, { type: 'balance', balance: getBalance(clientId) });
            break;
          default:
            send(ws, { type: 'error', message: 'unknown type' });
        }
      } catch (e) {
        send(ws, { type: 'error', message: e.message });
      }
    });
    return;
  }

  // Poker
  if (game === 'poker') {
    send(ws, { type: 'connected', game: 'poker' });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        handlePoker(ws, clientId, msg);
      } catch (e) {
        send(ws, { type: 'error', message: e.message });
      }
    });
    return;
  }

  // Slot (server-side RNG)
  if (game === 'slot') {
    send(ws, { type: 'connected', game: 'slot', balance: getBalance(clientId) });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        switch (msg.type) {
          case 'spin': {
            const bet = Math.min(msg.bet || 100, getBalance(clientId));
            if (bet <= 0) return send(ws, { type: 'error', message: 'insufficient balance' });

            setBalance(clientId, getBalance(clientId) - bet);
            const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
            const result = fullSpin(bet, seed);
            setBalance(clientId, getBalance(clientId) + result.totalWin);

            send(ws, {
              type: 'spinResult',
              bet,
              totalWin: result.totalWin,
              balance: getBalance(clientId),
              events: result.events,
            });
            break;
          }
          default:
            send(ws, { type: 'error', message: 'unknown slot action' });
        }
      } catch (e) {
        send(ws, { type: 'error', message: e.message });
      }
    });
    return;
  }

  // Blackjack
  if (game === 'blackjack') {
    send(ws, { type: 'connected', game: 'blackjack' });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        handleBlackjack(ws, clientId, msg);
      } catch (e) {
        send(ws, { type: 'error', message: e.message });
      }
    });
    return;
  }

  send(ws, { type: 'error', message: 'unknown game' });
});

// ────────── Poker handlers ──────────
function handlePoker(ws, clientId, msg) {
  switch (msg.type) {
    case 'join': {
      const table = getOrCreatePokerTable(msg.tableId || 'main');
      const player = table.join(clientId, msg.name || 'Player', msg.buyIn || 1000);
      if (!player) return send(ws, { type: 'error', message: 'table full' });
      broadcastPoker(table);
      break;
    }
    case 'leave': {
      const table = pokerTables.get(msg.tableId || 'main');
      if (!table) return;
      table.leave(clientId);
      broadcastPoker(table);
      break;
    }
    case 'start': {
      const table = pokerTables.get(msg.tableId || 'main');
      if (!table) return;
      if (table.startHand())
        broadcastPoker(table);
      else
        send(ws, { type: 'error', message: 'need at least 2 players' });
      break;
    }
    case 'act': {
      const table = pokerTables.get(msg.tableId || 'main');
      if (!table) return;
      const result = table.act(clientId, msg.action, msg.amount);
      if (result === null) return send(ws, { type: 'error', message: 'invalid action' });
      broadcastPoker(table);

      if (table.phase === PHASES.SHOWDOWN) {
        const winners = table.showdown();
        broadcastPoker(table, winners);
      }
      break;
    }
    default:
      send(ws, { type: 'error', message: 'unknown poker action' });
  }
}

function getOrCreatePokerTable(id) {
  if (!pokerTables.has(id)) {
    pokerTables.set(id, new PokerTable(id));
  }
  return pokerTables.get(id);
}

function broadcastPoker(table, extra) {
  const state = table.getState();
  const msg = { type: 'pokerState', tableId: table.id, state };
  if (extra) msg.showdown = extra;
  // Broadcast to all connected clients on this table
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(msg));
    }
  });
}

// ────────── Blackjack handlers ──────────
function handleBlackjack(ws, clientId, msg) {
  switch (msg.type) {
    case 'join': {
      const table = getOrCreateBJTable(msg.tableId || 'main');
      table.join(clientId);
      send(ws, { type: 'bjState', state: table.getState() });
      break;
    }
    case 'bet': {
      const table = getOrCreateBJTable(msg.tableId || 'main');
      table.placeBet(clientId, msg.amount);
      send(ws, { type: 'bjState', state: table.getState() });
      break;
    }
    case 'deal': {
      const table = getOrCreateBJTable(msg.tableId || 'main');
      if (table.startRound())
        broadcastBJ(table);
      break;
    }
    case 'act': {
      const table = getOrCreateBJTable(msg.tableId || 'main');
      const result = table.act(clientId, msg.action);
      if (result === null) return send(ws, { type: 'error', message: 'invalid action' });
      broadcastBJ(table);

      // If phase changed to result, settle
      if (table.phase === 'result') {
        const results = table.settle();
        broadcastBJ(table, results);
        // Update chip balances
        for (const r of results) {
          const balance = getBalance(r.playerId);
          setBalance(r.playerId, balance + r.win);
        }
      }
      break;
    }
    default:
      send(ws, { type: 'error', message: 'unknown blackjack action' });
  }
}

function getOrCreateBJTable(id) {
  if (!blackjackTables.has(id)) {
    blackjackTables.set(id, new BlackjackTable());
  }
  return blackjackTables.get(id);
}

function broadcastBJ(table, extra) {
  const state = table.getState();
  const msg = { type: 'bjState', tableId: table.id, state };
  if (extra) msg.results = extra;
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(msg));
    }
  });
}

// ────────── Start server ──────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Casino server running on http://0.0.0.0:${PORT}`);
});

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const rng = (() => { try { return require('../server/rng'); } catch (e) { return require('./rng'); } })();
const { handleCloudStreamRoute, isInternalGameRequest, listCloudSessions } = require('./cloud-stream');
const { handleAdminRoute, persistBalance, getRegisteredPlayer, registerPublicPlayer, registerAccount, authenticatePublicPlayer, playerView, getConfigFilePath, resolveAssetFile } = require('./admin');

const PORT = Number(process.env.PORT) || 3001;
const SLOT_DIR = __dirname;
// Prefer the sibling dev build when it exists; fall back to the vendored copy
// shipped inside this repo (the only one present in the deployed container).
function firstExistingPath(candidates) {
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[candidates.length - 1];
}

const SUGAR_RUSH_DIR = process.env.SUGAR_RUSH_DIR || firstExistingPath([
  path.join(__dirname, '..', 'sugar-rush-clone', 'frontend', 'dist'),
  path.join(__dirname, 'sugar-rush', 'dist'),
]);
const SUGAR_BOOKS_FILE = process.env.SUGAR_BOOKS_FILE || firstExistingPath([
  path.join(__dirname, '..', 'sugar-rush-clone', 'math-engine', 'sugar_blast_1000', 'library', 'books', 'books_base.jsonl'),
  path.join(__dirname, 'sugar-rush', 'books_base.jsonl'),
]);
console.log(`Sugar Rush assets: ${SUGAR_RUSH_DIR}`);
const PRECISION = 1000000;
const DEFAULT_SESSION_ID = 'unity-player';
const INITIAL_BALANCE = 10000;
const CLIENT_GAME_TTL_MS = 30 * 60 * 1000;
const CLIENT_SHELL_TTL_MS = 24 * 60 * 60 * 1000;
const CLIENT_RENDER_SECRET = process.env.CLIENT_RENDER_SECRET || '';
const CLIENT_GAME_COOKIE = 'casinoClientGame';
const CLIENT_SHELL_COOKIE = 'casinoClientShell';
const AUTH_COOKIE = 'casinoAuth';
const AUTH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AUTO_MAINTENANCE_STUCK_ROUND_MS = Math.max(30_000, Number(process.env.AUTO_MAINTENANCE_STUCK_ROUND_MS) || 120_000);
const AUTO_MAINTENANCE_MAX_SUGAR_FS_AWARD = Math.max(40, Number(process.env.AUTO_MAINTENANCE_MAX_SUGAR_FS_AWARD) || 100);
const AUTO_MAINTENANCE_MAX_SUGAR_FS_TRIGGERS = Math.max(5, Number(process.env.AUTO_MAINTENANCE_MAX_SUGAR_FS_TRIGGERS) || 25);
const clientGameSessions = new Map(); // token -> { game, sessionID, expiresAt, lastAccess }
const clientShellSessions = new Map(); // token -> { sessionID, expiresAt, lastAccess }
const authSessions = new Map(); // token -> { playerId, expiresAt, lastAccess }
const maintenanceState = {
  active: false,
  reason: '',
  details: null,
  triggeredAt: null,
};

// ── HTTP server ──

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.glb': 'model/gltf-binary',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

function serveStatic(rootDir, relativeUrl, res, extraHeaders = {}) {
  const safePath = path.normalize('/' + relativeUrl).replace(/^\/+/, '');
  const filePath = path.join(rootDir, safePath || 'index.html');

  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (statErr, stat) => {
    const resolvedPath = !statErr && stat.isDirectory() ? path.join(filePath, 'index.html') : filePath;
    fs.readFile(resolvedPath, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('Not found');
      }

      const ext = path.extname(resolvedPath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', ...extraHeaders });
      res.end(data);
    });
  });
}

function serveAsset(dir, relativeUrl, res) {
  const asset = resolveAssetFile(dir, relativeUrl);
  if (!asset) {
    res.writeHead(404, { 'Cache-Control': 'no-store' });
    return res.end('Not found');
  }

  return serveStatic(asset.root, asset.relativePath, res, { 'Cache-Control': 'no-store' });
}

function redirectToCloud(res, game) {
  res.writeHead(302, {
    Location: `/cloud/start?game=${encodeURIComponent(game)}`,
    'Cache-Control': 'no-store',
  });
  res.end();
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const cookies = {};
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function requestBaseUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || (req.socket.encrypted ? 'https' : 'http');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || `127.0.0.1:${PORT}`).split(',')[0].trim();
  return `${proto}://${host}`;
}

function normalizeSessionID(value) {
  return String(value || DEFAULT_SESSION_ID).replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 128) || DEFAULT_SESSION_ID;
}

function pruneClientGameSessions() {
  const now = Date.now();
  for (const [token, session] of clientGameSessions) {
    if (!session || session.expiresAt <= now) clientGameSessions.delete(token);
  }
}

function pruneClientShellSessions() {
  const now = Date.now();
  for (const [token, session] of clientShellSessions) {
    if (!session || session.expiresAt <= now) clientShellSessions.delete(token);
  }
}

function pruneAuthSessions() {
  const now = Date.now();
  for (const [token, session] of authSessions) {
    if (!session || session.expiresAt <= now) authSessions.delete(token);
  }
}

function setSessionCookie(req, res, name, token, ttlMs) {
  const secure = requestBaseUrl(req).startsWith('https://') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ttlMs / 1000)}${secure}`);
}

function createClientGameSession(game, sessionID) {
  pruneClientGameSessions();
  const token = crypto.randomBytes(32).toString('base64url');
  const session = {
    game,
    sessionID: normalizeSessionID(sessionID),
    expiresAt: Date.now() + CLIENT_GAME_TTL_MS,
    lastAccess: Date.now(),
  };
  clientGameSessions.set(token, session);
  return { token, session };
}

function createClientShellSession(sessionID) {
  pruneClientShellSessions();
  const token = crypto.randomBytes(32).toString('base64url');
  const session = {
    sessionID: normalizeSessionID(sessionID),
    expiresAt: Date.now() + CLIENT_SHELL_TTL_MS,
    lastAccess: Date.now(),
  };
  clientShellSessions.set(token, session);
  return { token, session };
}

function createAuthSession(playerId) {
  pruneAuthSessions();
  const token = crypto.randomBytes(32).toString('base64url');
  const session = {
    playerId: normalizeSessionID(playerId),
    expiresAt: Date.now() + AUTH_TTL_MS,
    lastAccess: Date.now(),
  };
  authSessions.set(token, session);
  return { token, session };
}

function getClientGameSession(req) {
  pruneClientGameSessions();
  const token = parseCookies(req)[CLIENT_GAME_COOKIE];
  if (!token) return null;
  const session = clientGameSessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    clientGameSessions.delete(token);
    return null;
  }
  session.lastAccess = Date.now();
  return session;
}

function getClientShellSession(req) {
  pruneClientShellSessions();
  const token = parseCookies(req)[CLIENT_SHELL_COOKIE];
  if (!token) return null;
  const session = clientShellSessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    clientShellSessions.delete(token);
    return null;
  }
  session.lastAccess = Date.now();
  return session;
}

function getAuthSession(req) {
  pruneAuthSessions();
  const token = parseCookies(req)[AUTH_COOKIE];
  if (!token) return null;
  const session = authSessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    authSessions.delete(token);
    return null;
  }
  session.lastAccess = Date.now();
  return session;
}

function getAuthPlayer(req) {
  const session = getAuthSession(req);
  if (!session) return null;
  return playerView(session.playerId);
}

function setClientGameCookie(req, res, token) {
  setSessionCookie(req, res, CLIENT_GAME_COOKIE, token, CLIENT_GAME_TTL_MS);
}

function setClientShellCookie(req, res, token) {
  setSessionCookie(req, res, CLIENT_SHELL_COOKIE, token, CLIENT_SHELL_TTL_MS);
}

function setAuthCookie(req, res, token) {
  setSessionCookie(req, res, AUTH_COOKIE, token, AUTH_TTL_MS);
}

function clearAuthCookie(req, res) {
  const secure = requestBaseUrl(req).startsWith('https://') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

function maintenanceView() {
  return {
    active: maintenanceState.active,
    reason: maintenanceState.reason || '',
    details: maintenanceState.details || null,
    triggeredAt: maintenanceState.triggeredAt,
    stuckRoundMs: AUTO_MAINTENANCE_STUCK_ROUND_MS,
    freeSpinLimits: {
      maxTotalAward: AUTO_MAINTENANCE_MAX_SUGAR_FS_AWARD,
      maxTriggers: AUTO_MAINTENANCE_MAX_SUGAR_FS_TRIGGERS,
    },
  };
}

function enterMaintenance(reason, details = null) {
  if (maintenanceState.active) return maintenanceView();
  maintenanceState.active = true;
  maintenanceState.reason = String(reason || 'unknown').slice(0, 120);
  maintenanceState.details = details && typeof details === 'object' ? details : null;
  maintenanceState.triggeredAt = new Date().toISOString();
  console.error(`[maintenance] active: ${maintenanceState.reason}`, maintenanceState.details || '');
  broadcastMaintenanceUpdate();
  return maintenanceView();
}

function clearMaintenance() {
  for (const session of walletSessions.values()) {
    if (session && session.round && session.round.active) {
      session.round.active = false;
      session.round = null;
      session.event = null;
    }
  }
  maintenanceState.active = false;
  maintenanceState.reason = '';
  maintenanceState.details = null;
  maintenanceState.triggeredAt = null;
  broadcastMaintenanceUpdate();
  return maintenanceView();
}

function maintenanceJson(res) {
  return json(res, 503, {
    ok: false,
    code: 'ERR_MAINTENANCE',
    error: 'Oyun bakim modunda',
    message: 'Oyun gecici olarak bakim modunda. Lutfen daha sonra tekrar deneyin.',
    maintenance: maintenanceView(),
  });
}

function serveMaintenancePage(res) {
  const state = maintenanceView();
  res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bakim Modu</title><style>html,body{height:100%;margin:0;background:radial-gradient(circle at 50% 0%,#2b174d,#07040f 70%);color:#fff;font:15px/1.5 system-ui,-apple-system,sans-serif}.wrap{min-height:100%;display:grid;place-items:center;padding:24px}.card{width:min(520px,92vw);border:1px solid rgba(255,255,255,.16);border-radius:24px;background:rgba(12,7,28,.84);box-shadow:0 24px 80px rgba(0,0,0,.45);padding:28px;text-align:center}.badge{display:inline-block;border:1px solid rgba(255,209,102,.35);border-radius:999px;color:#ffd166;padding:5px 12px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;font-size:12px}h1{margin:16px 0 8px;font-size:30px}p{margin:8px 0;color:#cfc4ee}.reason{margin-top:16px;color:#ffb3c7;font-size:13px}.time{color:#8f84b8;font-size:12px}</style></head><body><main class="wrap"><section class="card"><span class="badge">Bakim Modu</span><h1>Oyun gecici olarak durduruldu</h1><p>Bir takilma veya teknik sorun algilandi. Oyunculari korumak icin oyun otomatik olarak bakim moduna alindi.</p><p>Lutfen biraz sonra tekrar deneyin.</p><div class="reason">Sebep: ${escapeHtml(state.reason || 'otomatik kontrol')}</div><div class="time">${escapeHtml(state.triggeredAt || '')}</div></section></main></body></html>`);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function providedClientSecret(req, requestUrl) {
  return String(req.headers['x-client-render-secret'] || requestUrl.searchParams.get('clientSecret') || '');
}

function hasValidClientSecret(req, requestUrl) {
  return !CLIENT_RENDER_SECRET || providedClientSecret(req, requestUrl) === CLIENT_RENDER_SECRET;
}

function serveProtectedClientLobby(req, res, relativePath) {
  const shellSession = getClientShellSession(req);
  if (!shellSession) {
    res.writeHead(403, { 'Cache-Control': 'no-store' });
    res.end('Forbidden');
    return true;
  }

  serveStatic(SLOT_DIR, relativePath, res, { 'Cache-Control': 'no-store' });
  return true;
}

function handleClientGameRoute(url, req, res) {
  const requestUrl = new URL(req.url, requestBaseUrl(req));

  if (req.method === 'GET' && url === '/client/lobby') {
    const existingShell = getClientShellSession(req);
    if (!existingShell && !hasValidClientSecret(req, requestUrl)) {
      json(res, 403, { ok: false, error: 'Client render secret required' });
      return true;
    }

    const requestedSessionID = requestUrl.searchParams.get('sessionID') || (existingShell && existingShell.sessionID) || DEFAULT_SESSION_ID;
    const { token } = createClientShellSession(requestedSessionID);
    setClientShellCookie(req, res, token);
    res.writeHead(302, {
      Location: '/client/lobby/',
      'Cache-Control': 'no-store',
    });
    res.end();
    return true;
  }

  if (req.method === 'GET' && url === '/client/lobby/') {
    return serveProtectedClientLobby(req, res, 'client-lobby.html');
  }

  if (req.method === 'GET' && url === '/client/lobby/client-lobby.js') {
    return serveProtectedClientLobby(req, res, 'client-lobby.js');
  }

  if (req.method === 'GET' && url === '/client/session') {
    const shellSession = getClientShellSession(req);
    if (!shellSession) {
      json(res, 403, { ok: false, error: 'Client shell session required' });
      return true;
    }
    json(res, 200, {
      ok: true,
      sessionID: shellSession.sessionID,
      balance: displayBalance(shellSession.sessionID),
      expiresAt: shellSession.expiresAt,
    });
    return true;
  }

  if (req.method === 'GET' && url === '/client/start') {
    checkStaleWalletRounds();
    if (maintenanceState.active) {
      serveMaintenancePage(res);
      return true;
    }

    const requestedSessionID = normalizeSessionID(requestUrl.searchParams.get('sessionID'));
    const shellSession = getClientShellSession(req);
    const shellAuthorized = shellSession && shellSession.sessionID === requestedSessionID;
    const publicLobbyLaunch = requestUrl.searchParams.get('source') === 'web-lobby';
    if (!shellAuthorized && !hasValidClientSecret(req, requestUrl) && !publicLobbyLaunch) {
      json(res, 403, { ok: false, error: 'Client render secret required' });
      return true;
    }

    const game = requestUrl.searchParams.get('game') === 'sugar-rush' ? 'sugar-rush' : '';
    if (!game) {
      json(res, 400, { ok: false, error: 'Unsupported client-render game' });
      return true;
    }

    const { token, session } = createClientGameSession(game, requestedSessionID);
    const base = requestBaseUrl(req);
    const launchPath = `/client-game/sugar-rush/?sessionID=${encodeURIComponent(session.sessionID)}&rgs_url=${encodeURIComponent(base)}&currency=USD&client=1`;
    setClientGameCookie(req, res, token);
    res.writeHead(302, {
      Location: launchPath,
      'Cache-Control': 'no-store',
    });
    res.end();
    return true;
  }

  if (req.method === 'GET' && url === '/client-game/sugar-rush') {
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.writeHead(302, { Location: `/client-game/sugar-rush/${query}`, 'Cache-Control': 'no-store' });
    res.end();
    return true;
  }

  if (req.method === 'GET' && url.startsWith('/client-game/sugar-rush/')) {
    checkStaleWalletRounds();
    if (maintenanceState.active) {
      serveMaintenancePage(res);
      return true;
    }

    const session = getClientGameSession(req);
    if (!session || session.game !== 'sugar-rush') {
      res.writeHead(403, { 'Cache-Control': 'no-store' });
      res.end('Forbidden');
      return true;
    }

    serveStatic(SUGAR_RUSH_DIR, url.slice('/client-game/sugar-rush/'.length), res, { 'Cache-Control': 'no-store' });
    return true;
  }

  return false;
}

function isSlotEntryUrl(url) {
  return url === '/' || url === '/slot' || url === '/slot/' || url === '/index.html';
}

// Read-only lobby assets the Godot client loads directly (3D lobby, machine
// models, ambient audio, hot-update DLLs). Game code stays off the Godot bundle;
// it is served only to internal cloud renderers or token-gated client sessions.
function isLobbyAsset(url) {
  return url === '/casino-config.json'
    || url.startsWith('/models/')
    || url.startsWith('/maps/')
    || url.startsWith('/audio/')
    || url.startsWith('/hotfix/');
}

const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];

  if (handleCloudStreamRoute(req, res, PORT)) {
    return;
  }

  if (handleAdminRoute(req, res, {
    getWalletBalance: (id) => displayBalance(id),
    setWalletBalance: (id, amount) => { adjustDisplayBalance(id, amount - displayBalance(id)); },
    listWallets: () => [...walletSessions.keys()],
    listCloudSessions,
    getMaintenanceState: () => maintenanceView(),
    clearMaintenance,
    onConfigSaved: () => broadcastConfigUpdate(),
    onPlayersChanged: () => broadcastPlayersUpdate(),
  })) {
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  if (handlePublicApiRoute(url, req, res)) {
    return;
  }

  if (handleClientGameRoute(url, req, res)) {
    return;
  }

  if (req.method === 'POST' && handleWalletRoute(url, req, res)) {
    return;
  }

  if (req.method === 'GET' && url.startsWith('/dev-script/')) {
    const relativePath = url.slice('/dev-script/'.length).replace(/\.\./g, '');
    const scriptPath = path.join(__dirname, 'godot-client', 'scripts', relativePath);
    if (!fs.existsSync(scriptPath)) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const content = fs.readFileSync(scriptPath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(content);
  }

  // Serve lobby at root for all clients
  if (url === '/' || url === '/lobby' || url === '/lobby/') {
    return serveStatic(SLOT_DIR, 'lobby.html', res, { 'Cache-Control': 'no-cache' });
  }

  // Game routes: serve directly to all clients (no cloud redirect)
  // Cloud streaming remains available at /cloud/* for legacy clients
  if (url === '/sugar-rush' || url === '/sugar-rush/' || url.startsWith('/sugar-rush/')) {
    checkStaleWalletRounds();
    if (maintenanceState.active) {
      return serveMaintenancePage(res);
    }

    if (url === '/sugar-rush') {
      const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      res.writeHead(302, { Location: `/sugar-rush/${query}` });
      return res.end();
    }
    if (url === '/sugar-rush/') {
      return serveStatic(SUGAR_RUSH_DIR, 'index.html', res);
    }
    return serveStatic(SUGAR_RUSH_DIR, url.slice('/sugar-rush/'.length), res);
  }

  // Block non-lobby, non-game routes for external clients
  if (!isInternalGameRequest(req)) {
    if (isSlotEntryUrl(url)) {
      return redirectToCloud(res, 'slot');
    }
    if (!isLobbyAsset(url)) {
      res.writeHead(403, { 'Cache-Control': 'no-store' });
      return res.end('Forbidden');
    }
  }

  if (url === '/casino-config.json') {
    const configFile = getConfigFilePath();
    return serveStatic(path.dirname(configFile), path.basename(configFile), res, { 'Cache-Control': 'no-store' });
  }

  if (url.startsWith('/models/')) {
    return serveAsset('models', url.slice('/models/'.length), res);
  }

  if (url.startsWith('/maps/')) {
    return serveAsset('maps', url.slice('/maps/'.length), res);
  }

  if (url.startsWith('/audio/')) {
    return serveAsset('audio', url.slice('/audio/'.length), res);
  }

  if (url.startsWith('/hotfix/')) {
    return serveAsset('hotfix', url.slice('/hotfix/'.length), res);
  }

  // Route root or /slot/ -> index.html, /slot/foo -> /foo
  if (url === '/' || url === '/slot/' || url === '/slot') {
    url = '/index.html';
  } else if (url.startsWith('/slot/')) {
    url = url.slice('/slot'.length);
  }

  // Remove trailing slash
  if (url.endsWith('/') && url.length > 1) url = url.slice(0, -1);

  // Security: prevent path traversal
  const safePath = path.normalize(url).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = path.join(SLOT_DIR, safePath);

  if (!filePath.startsWith(SLOT_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // Try models/ or maps/ subdirectory
        const subdirs = ['models', 'maps'];
        tryDir(0);
        function tryDir(idx) {
          if (idx >= subdirs.length) {
            res.writeHead(404);
            return res.end('Not found');
          }
          const altPath = path.join(SLOT_DIR, subdirs[idx], safePath);
          fs.readFile(altPath, (err2, data2) => {
            if (err2) return tryDir(idx + 1);
            const ext = path.extname(altPath).toLowerCase();
            res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
            res.end(data2);
          });
        }
      } else {
        res.writeHead(500);
        res.end('Server error');
      }
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    ...extra,
  };
}

function json(res, status, body) {
  res.writeHead(status, corsHeaders({ 'Content-Type': 'application/json' }));
  res.end(JSON.stringify(body));
}

function readJson(req, cb) {
  let raw = '';
  req.on('data', chunk => {
    raw += chunk;
    if (raw.length > 1024 * 1024) req.destroy();
  });
  req.on('end', () => {
    try {
      cb(null, raw ? JSON.parse(raw) : {});
    } catch (err) {
      cb(err);
    }
  });
}

function handlePublicApiRoute(url, req, res) {
  const routes = new Set(['/api/register', '/api/login', '/api/logout', '/api/session', '/api/maintenance']);
  if (!routes.has(url)) return false;

  if (url === '/api/maintenance' && req.method === 'GET') {
    checkStaleWalletRounds();
    json(res, 200, { ok: true, maintenance: maintenanceView() });
    return true;
  }
  if (url === '/api/maintenance') {
    json(res, 405, { ok: false, error: 'Method not allowed' });
    return true;
  }

  if (url === '/api/session' && req.method === 'GET') {
    const player = getAuthPlayer(req);
    if (!player) json(res, 200, { ok: true, authenticated: false });
    else json(res, 200, { ok: true, authenticated: true, player: { ...player, balance: displayBalance(player.id) } });
    return true;
  }

  if (url === '/api/logout' && req.method === 'POST') {
    const token = parseCookies(req)[AUTH_COOKIE];
    if (token) authSessions.delete(token);
    clearAuthCookie(req, res);
    json(res, 200, { ok: true });
    return true;
  }

  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'Method not allowed' });
    return true;
  }

  readJson(req, (err, body) => {
    if (err) return json(res, 400, { ok: false, error: 'Invalid JSON' });

    try {
      if (url === '/api/login') {
        const player = authenticatePublicPlayer(body.identifier || body.login || body.email || body.username, body.password);
        if (!player) return json(res, 401, { ok: false, error: 'Email/kullanici adi veya sifre hatali' });
        const { token } = createAuthSession(player.id);
        setAuthCookie(req, res, token);
        adjustDisplayBalance(player.id, player.balance - displayBalance(player.id));
        return json(res, 200, { ok: true, player: { ...player, balance: displayBalance(player.id) } });
      }

      const accountRegister = body.password != null || body.email != null || body.username != null;
      const player = accountRegister ? registerAccount(body) : registerPublicPlayer(body);
      adjustDisplayBalance(player.id, player.balance - displayBalance(player.id));
      if (accountRegister) {
        const { token } = createAuthSession(player.id);
        setAuthCookie(req, res, token);
        return json(res, 200, { ok: true, player: { ...player, balance: displayBalance(player.id) } });
      }
      return json(res, 200, { ok: true, ...player });
    } catch (e) {
      return json(res, e.statusCode || 500, { ok: false, error: e.message });
    }
  });

  return true;
}

// ── Sugar Rush RGS-style wallet API ──

const walletSessions = new Map(); // sessionID -> { balance, round, event }
let sugarBooks = null;
const MAX_SINGLE_SUGAR_FS_AWARD = 34;

function checkStaleWalletRounds() {
  if (maintenanceState.active) return true;
  const now = Date.now();
  for (const [sessionID, session] of walletSessions.entries()) {
    const round = session && session.round;
    if (!round || !round.active) continue;
    const lastProgressAt = Number(round.lastProgressAt || round.startedAt || round.betID || 0);
    if (!Number.isFinite(lastProgressAt) || now - lastProgressAt <= AUTO_MAINTENANCE_STUCK_ROUND_MS) continue;
    enterMaintenance('stuck-round', {
      sessionID,
      betID: round.betID,
      lastEvent: round.event || session.event || null,
      eventCount: Array.isArray(round.state) ? round.state.length : 0,
      idleMs: now - lastProgressAt,
    });
    return true;
  }
  return false;
}

function isUsableSugarBook(book) {
  // Older book exports wrote cumulative free-spin totals into retrigger events.
  // A single Sugar Rush trigger cannot award more than the super-mode 7-scatter cap.
  if (!Array.isArray(book && book.events)) return false;
  return !book.events.some(event => {
    if (!event || event.type !== 'fsTrigger') return false;
    const totalSpins = Number(event.totalSpins);
    return !Number.isFinite(totalSpins) || totalSpins <= 0 || totalSpins > MAX_SINGLE_SUGAR_FS_AWARD;
  });
}

function sugarFreeSpinStats(events) {
  const stats = {
    triggerCount: 0,
    totalAwarded: 0,
    maxSingleAward: 0,
    maxUpdateTotal: 0,
    freeGameReveals: 0,
  };

  for (const event of Array.isArray(events) ? events : []) {
    if (!event) continue;
    if (event.type === 'fsTrigger') {
      const spins = Number(event.totalSpins);
      stats.triggerCount++;
      if (Number.isFinite(spins)) {
        stats.totalAwarded += spins;
        stats.maxSingleAward = Math.max(stats.maxSingleAward, spins);
      }
    }
    if (event.type === 'updateFreespin') {
      const total = Number(event.totalSpins);
      if (Number.isFinite(total)) stats.maxUpdateTotal = Math.max(stats.maxUpdateTotal, total);
    }
    if (event.type === 'reveal' && event.gameType === 'freegame') {
      stats.freeGameReveals++;
    }
  }

  return stats;
}

function excessiveSugarFreeSpins(book) {
  const stats = sugarFreeSpinStats(book && book.events);
  const maxObservedTotal = Math.max(stats.totalAwarded, stats.maxUpdateTotal, stats.freeGameReveals);
  const excessive = stats.triggerCount > AUTO_MAINTENANCE_MAX_SUGAR_FS_TRIGGERS
    || maxObservedTotal > AUTO_MAINTENANCE_MAX_SUGAR_FS_AWARD;

  return {
    excessive,
    stats,
    limits: {
      maxTotalAward: AUTO_MAINTENANCE_MAX_SUGAR_FS_AWARD,
      maxTriggers: AUTO_MAINTENANCE_MAX_SUGAR_FS_TRIGGERS,
    },
  };
}

function getWalletSession(sessionID = DEFAULT_SESSION_ID) {
  if (!walletSessions.has(sessionID)) {
    const registered = getRegisteredPlayer(sessionID);
    const registeredBalance = registered && Number.isFinite(Number(registered.balance))
      ? Math.max(0, Math.round(Number(registered.balance)))
      : INITIAL_BALANCE;
    walletSessions.set(sessionID, {
      balance: registeredBalance * PRECISION,
      round: null,
      event: null,
    });
  }
  return walletSessions.get(sessionID);
}

function displayBalance(sessionID) {
  return Math.floor(getWalletSession(sessionID).balance / PRECISION);
}

function adjustDisplayBalance(sessionID, amount) {
  const session = getWalletSession(sessionID);
  session.balance = Math.max(0, session.balance + Math.round(amount * PRECISION));
  return notifyWalletChanged(sessionID);
}

function notifyWalletChanged(sessionID) {
  const bal = displayBalance(sessionID);
  persistBalance(sessionID, bal);
  broadcastBalance(sessionID);
  broadcastPlayersUpdate();
  return bal;
}

function loadSugarBooks() {
  if (sugarBooks) return sugarBooks;

  try {
    const lines = fs.readFileSync(SUGAR_BOOKS_FILE, 'utf8').split('\n').filter(Boolean);
    const loadedBooks = lines.map(line => JSON.parse(line));
    sugarBooks = loadedBooks.filter(isUsableSugarBook);
    const rejected = loadedBooks.length - sugarBooks.length;
    console.log(`Loaded ${sugarBooks.length} Sugar Rush server-side books${rejected ? ` (${rejected} malformed free-spin books skipped)` : ''}`);
    if (loadedBooks.length > 0 && sugarBooks.length === 0) {
      enterMaintenance('sugar-books-invalid', { loadedBooks: loadedBooks.length, rejected });
    }
  } catch (err) {
    console.warn(`Could not load Sugar Rush books (${err.message}); using fallback generator`);
    sugarBooks = [];
  }

  return sugarBooks;
}

function pickSugarBook(mode) {
  const books = loadSugarBooks();
  if (books.length > 0) {
    return rng.pickRandom(books, 'slot/server.js:pickSugarBook');
  }

  return {
    id: Date.now(),
    events: generateFallbackSugarEvents(),
    payoutMultiplier: 0,
  };
}

function scaleSugarEvent(event, betDisplayAmount) {
  const scaled = JSON.parse(JSON.stringify(event));
  if (typeof scaled.totalWin === 'number') scaled.totalWin *= betDisplayAmount;
  if (typeof scaled.amount === 'number') scaled.amount *= betDisplayAmount;
  if (Array.isArray(scaled.wins)) {
    scaled.wins = scaled.wins.map(win => ({
      ...win,
      win: typeof win.win === 'number' ? win.win * betDisplayAmount : win.win,
    }));
  }
  return scaled;
}

function getFinalWin(events) {
  const finalWin = [...events].reverse().find(event => event.type === 'finalWin');
  return finalWin && typeof finalWin.amount === 'number' ? finalWin.amount : 0;
}

function handleWalletRoute(url, req, res) {
  const routes = new Set(['/wallet/authenticate', '/wallet/balance', '/wallet/play', '/wallet/end-round', '/bet/event']);
  if (!routes.has(url)) return false;

  checkStaleWalletRounds();
  if (maintenanceState.active && url !== '/wallet/end-round') {
    maintenanceJson(res);
    return true;
  }

  const clientGameSession = getClientGameSession(req);
  if (!isInternalGameRequest(req) && !clientGameSession) {
    json(res, 403, { code: 'ERR_FORBIDDEN', message: 'Authorized game session required' });
    return true;
  }

  readJson(req, (err, body) => {
    if (err) return json(res, 400, { code: 'ERR_JSON', message: 'Invalid JSON' });

    const requestedSessionID = body.sessionID || body.session_id || '';
    if (clientGameSession && requestedSessionID && normalizeSessionID(requestedSessionID) !== clientGameSession.sessionID) {
      return json(res, 403, { code: 'ERR_FORBIDDEN', message: 'Client game session mismatch' });
    }

    const sessionID = clientGameSession ? clientGameSession.sessionID : normalizeSessionID(requestedSessionID);
    const session = getWalletSession(sessionID);

    try {
      switch (url) {
      case '/wallet/authenticate':
        return json(res, 200, {
          balance: { amount: session.balance, currency: 'USD' },
          config: sugarConfig(),
          round: session.round || undefined,
        });

      case '/wallet/balance':
        return json(res, 200, { balance: { amount: session.balance, currency: 'USD' } });

      case '/wallet/play': {
        const amount = Number(body.amount || PRECISION);
        const mode = body.mode || 'base';
        if (!Number.isFinite(amount) || amount <= 0) {
          return json(res, 400, { code: 'ERR_AMOUNT', message: 'Invalid bet amount' });
        }
        if (session.balance < amount) {
          return json(res, 402, { code: 'ERR_IPB', message: 'Insufficient balance' });
        }

        const betDisplayAmount = amount / PRECISION;
        const book = pickSugarBook(mode);
        const fsGuard = excessiveSugarFreeSpins(book);
        if (fsGuard.excessive) {
          enterMaintenance('excessive-free-spins', {
            sessionID,
            mode,
            bookId: book.id,
            ...fsGuard,
          });
          return maintenanceJson(res);
        }

        const events = book.events.map(event => scaleSugarEvent(event, betDisplayAmount));
        const finalWinDisplay = getFinalWin(events);
        const winAmount = Math.round(finalWinDisplay * PRECISION);

        session.balance = Math.max(0, session.balance - amount) + winAmount;
        session.round = {
          betID: Date.now(),
          amount,
          active: true,
          state: events,
          startedAt: Date.now(),
          lastProgressAt: Date.now(),
        };
        session.event = null;

        notifyWalletChanged(sessionID);
        return json(res, 200, {
          balance: { amount: session.balance, currency: 'USD' },
          round: session.round,
        });
      }

      case '/wallet/end-round':
        if (session.round) session.round.active = false;
        session.round = null;
        session.event = null;
        broadcastBalance(sessionID);
        return json(res, 200, { balance: { amount: session.balance, currency: 'USD' } });

      case '/bet/event':
        session.event = String(body.event ?? '');
        if (session.round) {
          session.round.event = session.event;
          session.round.lastProgressAt = Date.now();
        }
        return json(res, 200, { event: session.event });
      }
    } catch (err) {
      enterMaintenance('wallet-route-error', {
        route: url,
        sessionID,
        message: err.message,
      });
      return maintenanceJson(res);
    }
  });

  return true;
}

function sugarConfig() {
  const betLevels = [0.2, 0.4, 0.6, 0.8, 1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 125, 150, 175, 200, 240]
    .map(value => Math.round(value * PRECISION));

  return {
    minBet: Math.round(0.2 * PRECISION),
    maxBet: Math.round(240 * PRECISION),
    stepBet: Math.round(0.2 * PRECISION),
    defaultBetLevel: PRECISION,
    betLevels,
    jurisdiction: {
      socialCasino: true,
      disabledFullscreen: false,
      disabledTurbo: false,
    },
  };
}

function generateFallbackSugarEvents() {
  const names = ['L3', 'L2', 'L1', 'H4', 'H3', 'H2', 'H1', 'S'];
  const board = Array.from({ length: 7 }, (_, row) => Array.from({ length: 7 }, (_, reel) => {
    const id = rng.randomInt(0, names.length - 1, 'slot/server.js:fallbackSugar');
    return { symbol: names[id], id, reel, row };
  }));

  return [
    { index: 0, type: 'reveal', board, paddingPositions: [], gameType: 'basegame', anticipation: [0, 0, 0, 0, 0, 0, 0] },
    { index: 1, type: 'finalWin', amount: 0 },
  ];
}

// ── Slot game state ──

const SYMBOLS = ['heart', 'diamond', 'banana', 'apple', 'orange', 'watermelon', 'plum', 'grape', 'scatter'];

function randomSymbol() {
  return { id: rng.pickRandom(SYMBOLS, 'slot/server.js:randomSymbol') };
}

function generateGrid() {
  const cols = 6;
  const rows = 5;
  const grid = [];
  for (let c = 0; c < cols; c++) {
    const col = [];
    for (let r = 0; r < rows; r++) {
      col.push(randomSymbol());
    }
    grid.push(col);
  }
  return grid;
}

function pickWinningPositions(grid) {
  // Simple win detection: find groups of 3+ matching symbols
  const positions = [];
  const cols = 6, rows = 5;

  // Check horizontal runs
  for (let r = 0; r < rows; r++) {
    let run = [];
    for (let c = 0; c < cols; c++) {
      if (grid[c] && grid[c][r]) {
        if (run.length === 0 || run[0].id === grid[c][r].id) {
          run.push({ id: grid[c][r].id, pos: [c, r] });
        } else {
          if (run.length >= 3) {
            positions.push(...run.map(x => x.pos));
          }
          run = [{ id: grid[c][r].id, pos: [c, r] }];
        }
      }
    }
    if (run.length >= 3) {
      positions.push(...run.map(x => x.pos));
    }
  }

  return positions;
}

// ── WebSocket server ──

const wss = new WebSocketServer({ server });

const wsSessions = new Map(); // ws -> { sessionID, channel }

function socketChannelFromRequest(req) {
  try {
    const url = new URL(req.url, 'http://localhost');
    return url.searchParams.get('game') === 'admin' ? 'admin' : 'balance';
  } catch (err) {
    return 'balance';
  }
}

function sessionIDFromRequest(req) {
  try {
    const url = new URL(req.url, 'http://localhost');
    return url.searchParams.get('sessionID')
      || url.searchParams.get('session_id')
      || url.searchParams.get('player')
      || DEFAULT_SESSION_ID;
  } catch (err) {
    return DEFAULT_SESSION_ID;
  }
}

function sendBalance(ws, sessionID, type = 'balance') {
  ws.send(JSON.stringify({ type, balance: displayBalance(sessionID) }));
}

function broadcastBalance(sessionID) {
  for (const [client, meta] of wsSessions.entries()) {
    if (meta.sessionID === sessionID && client.readyState === 1) {
      sendBalance(client, sessionID);
    }
  }
}

function broadcastPlayersUpdate() {
  const msg = JSON.stringify({ type: 'players:updated', ts: Date.now() });
  for (const [client] of wsSessions.entries()) {
    if (client.readyState === 1) client.send(msg);
  }
}

function broadcastConfigUpdate() {
  const msg = JSON.stringify({ type: 'config:updated', ts: Date.now() });
  for (const [client] of wsSessions.entries()) {
    if (client.readyState === 1) client.send(msg);
  }
}

function broadcastMaintenanceUpdate() {
  const msg = JSON.stringify({ type: 'maintenance:updated', maintenance: maintenanceView(), ts: Date.now() });
  for (const [client] of wsSessions.entries()) {
    if (client.readyState === 1) client.send(msg);
  }
}

wss.on('connection', (ws, req) => {
  // External clients (e.g. the Unity lobby) get a read-only balance feed;
  // only the internal cloud-stream browser may mutate wallet state.
  const internal = isInternalGameRequest(req);
  const channel = socketChannelFromRequest(req);
  const sessionID = channel === 'admin' ? null : sessionIDFromRequest(req);
  wsSessions.set(ws, { sessionID, channel });

  if (channel === 'admin') {
    ws.send(JSON.stringify({ type: 'connected', channel: 'admin' }));
    ws.send(JSON.stringify({ type: 'maintenance:updated', maintenance: maintenanceView(), ts: Date.now() }));
  } else {
    getWalletSession(sessionID);
    sendBalance(ws, sessionID, 'connected');
    sendBalance(ws, sessionID);
    ws.send(JSON.stringify({ type: 'maintenance:updated', maintenance: maintenanceView(), ts: Date.now() }));
  }

  ws.on('message', (raw) => {
    if (channel === 'admin') {
      ws.send(JSON.stringify({ type: 'error', message: 'Read-only admin live feed' }));
      return;
    }

    if (!internal) {
      ws.send(JSON.stringify({ type: 'error', message: 'Read-only session: play through the cloud stream' }));
      return;
    }

    try {
      const msg = JSON.parse(raw.toString());
      const bal = displayBalance(sessionID);

      switch (msg.type) {
        case 'spin': {
          const bet = msg.bet || 100;
          if (bal < bet) {
            ws.send(JSON.stringify({ type: 'error', message: 'Yetersiz bakiye' }));
            return;
          }

          // Generate grid
          const grid = generateGrid();

          // Check for wins
          const winPositions = pickWinningPositions(grid);
          const totalWin = winPositions.length > 0 ? bet * Math.floor(winPositions.length / 3) * 2 : 0;

          const events = [];

          // Spin event with initial grid
          events.push({ type: 'spin', grid });

          if (totalWin > 0 && winPositions.length > 0) {
            // Tumble event (show winning positions)
            events.push({
              type: 'tumble',
              wins: [{ positions: winPositions }]
            });

            const dropGrid = grid.map(col => col.map(() => randomSymbol()));
            events.push({ type: 'drop', grid: dropGrid });
          }

          const finalBal = adjustDisplayBalance(sessionID, totalWin - bet);

          ws.send(JSON.stringify({
            type: 'spinResult',
            balance: finalBal,
            totalWin,
            bet,
            events
          }));
          break;
        }

        case 'bet': {
          const amount = msg.amount || 0;
          adjustDisplayBalance(sessionID, -amount);
          break;
        }

        case 'win': {
          const amount = msg.amount || 0;
          adjustDisplayBalance(sessionID, amount);
          break;
        }

        default:
          ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${msg.type}` }));
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
    }
  });

  ws.on('close', () => {
    wsSessions.delete(ws);
  });
});

setInterval(checkStaleWalletRounds, Math.min(30_000, AUTO_MAINTENANCE_STUCK_ROUND_MS)).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

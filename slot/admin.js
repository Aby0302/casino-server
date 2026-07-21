const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const DATA_DIR = path.join(__dirname, 'data');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const ADMIN_UI_FILE = path.join(__dirname, 'admin-ui.html');
const DEFAULT_CONFIG_FILE = path.join(__dirname, 'casino-config.json');
const CONFIG_FILE = path.join(DATA_DIR, 'casino-config.json');
const GODOT_EDITOR_DIR = path.join(__dirname, 'godot-web-editor', 'latest');
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const DEFAULT_PLAYER_BALANCE = 10000;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (() => {
  const generated = crypto.randomBytes(9).toString('base64url');
  console.warn(`[admin] ADMIN_PASSWORD ortam degiskeni yok; gecici parola: ${generated}`);
  return generated;
})();

// dir parametresi -> gercek klasor eslemesi (dosya yoneticisinin izin verilen kokleri)
const DEFAULT_FILE_ROOTS = {
  'models': path.join(__dirname, 'models'),
  'maps': path.join(__dirname, 'maps'),
  'audio': path.join(__dirname, 'audio'),
  'hotfix': path.join(__dirname, 'hotfix'),
  'hotfix/aot': path.join(__dirname, 'hotfix', 'aot'),
};
const FILE_ROOTS = {
  'models': path.join(DATA_DIR, 'models'),
  'maps': path.join(DATA_DIR, 'maps'),
  'audio': path.join(DATA_DIR, 'audio'),
  'hotfix': path.join(DATA_DIR, 'hotfix'),
  'hotfix/aot': path.join(DATA_DIR, 'hotfix', 'aot'),
};

const adminSessions = new Map(); // token -> expiresAt
let players = loadPlayers();
let persistTimer = null;
let failedLogins = 0;

// ── Oyuncu kayit deposu ──

function loadPlayers() {
  try {
    const raw = fs.readFileSync(PLAYERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.players === 'object' && parsed.players ? parsed.players : {};
  } catch (err) {
    return {};
  }
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(PLAYERS_FILE, JSON.stringify({ players }, null, 2));
    } catch (err) {
      console.error(`[admin] players.json yazilamadi: ${err.message}`);
    }
  }, 250);
}

function ensureConfigFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.copyFileSync(DEFAULT_CONFIG_FILE, CONFIG_FILE);
  }
  return CONFIG_FILE;
}

function copyMissingEntries(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return;
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyMissingEntries(source, target);
    } else if (entry.isFile() && !fs.existsSync(target)) {
      fs.copyFileSync(source, target);
    }
  }
}

function ensureFileRoot(dirParam) {
  const key = String(dirParam || '');
  const root = FILE_ROOTS[key];
  if (!root) return null;
  copyMissingEntries(DEFAULT_FILE_ROOTS[key], root);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function resolveAssetFile(dirParam, relativePath) {
  const root = ensureFileRoot(dirParam);
  if (!root) return null;
  const safePath = path.normalize('/' + String(relativePath || '')).replace(/^\/+/g, '');
  const filePath = path.join(root, safePath);
  if (!filePath.startsWith(root)) return null;
  return fs.existsSync(filePath) ? { root, relativePath: safePath } : null;
}

function normalizePlayerID(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 128);
}

function getRegisteredPlayer(sessionID) {
  return players[sessionID] || null;
}

function registerPublicPlayer(body = {}) {
  const requestedID = normalizePlayerID(body.id);
  const id = requestedID || `player-${crypto.randomBytes(4).toString('hex')}`;
  const name = String(body.name || id).trim().slice(0, 64) || id;
  const now = new Date().toISOString();
  let created = false;

  if (!players[id]) {
    players[id] = {
      name,
      balance: DEFAULT_PLAYER_BALANCE,
      createdAt: now,
      updatedAt: now,
    };
    created = true;
    schedulePersist();
  }

  return {
    id,
    name: players[id].name || id,
    balance: Number(players[id].balance) || DEFAULT_PLAYER_BALANCE,
    created,
  };
}

// Oyun sunucusu bakiye degistikce cagirir; kayitli oyuncularin bakiyesi kalici olur.
function persistBalance(sessionID, displayBalance) {
  const player = players[sessionID];
  if (!player) return;
  player.balance = displayBalance;
  player.updatedAt = new Date().toISOString();
  schedulePersist();
}

// ── Yardimcilar ──

function json(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(raw),
    'Cache-Control': 'no-store',
  });
  res.end(raw);
}

function serveGodotEditor(req, res, pathname) {
  if (req.method !== 'GET') {
    res.writeHead(405, godotHeaders('.txt'));
    res.end('Method Not Allowed');
    return;
  }

  if (pathname === '/admin/godot-editor') {
    res.writeHead(302, {
      ...godotHeaders('.html'),
      Location: '/admin/godot-editor/',
    });
    res.end();
    return;
  }

  const relative = pathname.slice('/admin/godot-editor/'.length) || 'index.html';
  const safePath = path.normalize('/' + relative).replace(/^\/+/, '');
  const filePath = path.join(GODOT_EDITOR_DIR, safePath);
  if (!filePath.startsWith(GODOT_EDITOR_DIR)) {
    res.writeHead(403, godotHeaders('.txt'));
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, godotHeaders('.txt'));
      res.end('Not found');
      return;
    }
    res.writeHead(200, godotHeaders(path.extname(filePath).toLowerCase(), filePath));
    res.end(data);
  });
}

function godotHeaders(ext, filePath = '') {
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.wasm': 'application/wasm',
    '.json': filePath.endsWith('manifest.json') ? 'application/manifest+json' : 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.zip': 'application/zip',
    '.txt': 'text/plain; charset=utf-8',
  };
  return {
    'Content-Type': mime[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Service-Worker-Allowed': '/admin/godot-editor/',
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Istek govdesi cok buyuk'));
      }
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

function isAuthorized(req) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const token = parseCookies(req).adminToken || bearer;
  if (!token) return false;
  const expires = adminSessions.get(token);
  if (!expires || expires < Date.now()) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

function sanitizeFileName(value) {
  const name = path.basename(String(value || ''));
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) return null;
  return name;
}

function resolveRoot(dirParam) {
  return ensureFileRoot(dirParam);
}

// ── Rota isleyici ──
// ctx: { getWalletBalance(id), setWalletBalance(id, amount), listWallets(), listCloudSessions() }
function handleAdminRoute(req, res, ctx) {
  let requestUrl;
  try {
    requestUrl = new URL(req.url, 'http://localhost');
  } catch (err) {
    return false;
  }
  const pathname = requestUrl.pathname;
  if (pathname !== '/admin' && !pathname.startsWith('/admin/')) return false;

  (async () => {
    // Panel arayuzu (giris kontrolu istemci tarafinda; API'ler korumali)
    if (req.method === 'GET' && (pathname === '/admin' || pathname === '/admin/')) {
      const html = fs.readFileSync(ADMIN_UI_FILE);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }

    if (req.method === 'POST' && pathname === '/admin/api/login') {
      const body = await readJsonBody(req);
      const given = String(body.password || '');
      const expected = ADMIN_PASSWORD;
      const match = given.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
      if (!match) {
        failedLogins++;
        await new Promise(r => setTimeout(r, Math.min(3000, 300 * failedLogins)));
        return json(res, 401, { ok: false, error: 'Parola hatali' });
      }
      failedLogins = 0;
      const token = crypto.randomBytes(32).toString('base64url');
      adminSessions.set(token, Date.now() + SESSION_TTL_MS);
      res.setHeader('Set-Cookie', `adminToken=${token}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`);
      return json(res, 200, { ok: true, token });
    }

    if (!isAuthorized(req)) {
      return json(res, 401, { ok: false, error: 'Giris gerekli' });
    }

    if (pathname === '/admin/godot-editor' || pathname.startsWith('/admin/godot-editor/')) {
      return serveGodotEditor(req, res, pathname);
    }

    if (req.method === 'POST' && pathname === '/admin/api/logout') {
      const token = parseCookies(req).adminToken;
      if (token) adminSessions.delete(token);
      return json(res, 200, { ok: true });
    }

    // ── Oyuncular ──

    if (req.method === 'GET' && pathname === '/admin/api/players') {
      const list = Object.entries(players).map(([id, p]) => ({
        id,
        name: p.name || id,
        balance: ctx.getWalletBalance(id) ?? p.balance ?? 0,
        online: ctx.listWallets().includes(id),
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }));
      return json(res, 200, { ok: true, players: list });
    }

    if (req.method === 'POST' && pathname === '/admin/api/players') {
      const body = await readJsonBody(req);
      const id = normalizePlayerID(body.id);
      if (!id) return json(res, 400, { ok: false, error: 'Gecerli bir oyuncu ID girin' });
      if (players[id]) return json(res, 409, { ok: false, error: 'Bu ID zaten kayitli' });
      const balance = Number.isFinite(Number(body.balance)) ? Math.max(0, Math.round(Number(body.balance))) : 10000;
      players[id] = {
        name: String(body.name || id).slice(0, 64),
        balance,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      schedulePersist();
      ctx.setWalletBalance(id, balance);
      return json(res, 200, { ok: true, id });
    }

    const playerMatch = pathname.match(/^\/admin\/api\/players\/([^/]+)$/);
    if (playerMatch) {
      const id = normalizePlayerID(decodeURIComponent(playerMatch[1]));
      if (!players[id]) return json(res, 404, { ok: false, error: 'Oyuncu bulunamadi' });

      if (req.method === 'PUT') {
        const body = await readJsonBody(req);
        if (body.name != null) players[id].name = String(body.name).slice(0, 64);
        if (body.balance != null) {
          const balance = Math.max(0, Math.round(Number(body.balance) || 0));
          players[id].balance = balance;
          ctx.setWalletBalance(id, balance);
        }
        players[id].updatedAt = new Date().toISOString();
        schedulePersist();
        return json(res, 200, { ok: true });
      }

      if (req.method === 'DELETE') {
        delete players[id];
        schedulePersist();
        return json(res, 200, { ok: true });
      }
    }

    // ── Dosya yoneticisi ──

    if (req.method === 'GET' && pathname === '/admin/api/files') {
      const root = resolveRoot(requestUrl.searchParams.get('dir'));
      if (!root) return json(res, 400, { ok: false, error: 'Gecersiz klasor' });
      fs.mkdirSync(root, { recursive: true });
      const files = fs.readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => {
          const stat = fs.statSync(path.join(root, entry.name));
          return { name: entry.name, size: stat.size, mtime: stat.mtime.toISOString() };
        });
      return json(res, 200, { ok: true, files });
    }

    if (req.method === 'POST' && pathname === '/admin/api/files/upload') {
      const root = resolveRoot(requestUrl.searchParams.get('dir'));
      const name = sanitizeFileName(requestUrl.searchParams.get('name'));
      if (!root || !name) return json(res, 400, { ok: false, error: 'Gecersiz klasor veya dosya adi' });
      fs.mkdirSync(root, { recursive: true });

      const target = path.join(root, name);
      const tmp = `${target}.uploading-${crypto.randomBytes(4).toString('hex')}`;
      const stream = fs.createWriteStream(tmp);
      let received = 0;
      let aborted = false;

      await new Promise((resolve, reject) => {
        req.on('data', chunk => {
          received += chunk.length;
          if (received > MAX_UPLOAD_BYTES && !aborted) {
            aborted = true;
            stream.destroy();
            fs.unlink(tmp, () => {});
            req.destroy();
            reject(new Error('Dosya cok buyuk'));
            return;
          }
          stream.write(chunk);
        });
        req.on('end', () => stream.end(resolve));
        req.on('error', reject);
        stream.on('error', reject);
      });

      fs.renameSync(tmp, target);
      return json(res, 200, { ok: true, name, size: received });
    }

    if (req.method === 'DELETE' && pathname === '/admin/api/files') {
      const root = resolveRoot(requestUrl.searchParams.get('dir'));
      const name = sanitizeFileName(requestUrl.searchParams.get('name'));
      if (!root || !name) return json(res, 400, { ok: false, error: 'Gecersiz klasor veya dosya adi' });
      const target = path.join(root, name);
      if (!fs.existsSync(target)) return json(res, 404, { ok: false, error: 'Dosya bulunamadi' });
      fs.unlinkSync(target);
      return json(res, 200, { ok: true });
    }

    // ── Map editoru (casino-config.json) ──

    if (req.method === 'GET' && pathname === '/admin/api/config') {
      const raw = fs.readFileSync(ensureConfigFile(), 'utf8');
      return json(res, 200, { ok: true, config: JSON.parse(raw) });
    }

    if (req.method === 'PUT' && pathname === '/admin/api/config') {
      const body = await readJsonBody(req);
      const config = body.config;
      if (!config || typeof config !== 'object') return json(res, 400, { ok: false, error: 'config alani gerekli' });
      if (typeof config.map !== 'string' || !config.map) return json(res, 400, { ok: false, error: 'map alani gerekli' });
      if (!Array.isArray(config.machines)) return json(res, 400, { ok: false, error: 'machines bir dizi olmali' });
      for (const machine of config.machines) {
        if (!machine || typeof machine.id !== 'string' || !machine.id) {
          return json(res, 400, { ok: false, error: 'Her makinenin id alani olmali' });
        }
      }
      const configFile = ensureConfigFile();
      try { fs.copyFileSync(configFile, `${configFile}.bak`); } catch (err) {}
      fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
      return json(res, 200, { ok: true });
    }

    // ── Durum ──

    if (req.method === 'GET' && pathname === '/admin/api/status') {
      return json(res, 200, {
        ok: true,
        uptimeSeconds: Math.floor(process.uptime()),
        wallets: ctx.listWallets().map(id => ({ id, balance: ctx.getWalletBalance(id), registered: !!players[id] })),
        cloudSessions: ctx.listCloudSessions(),
      });
    }

    json(res, 404, { ok: false, error: 'Bilinmeyen admin rotasi' });
  })().catch(err => {
    console.error(`[admin] ${err.stack || err.message}`);
    if (!res.headersSent) json(res, 500, { ok: false, error: err.message });
    else res.destroy();
  });

  return true;
}

module.exports = { handleAdminRoute, getRegisteredPlayer, persistBalance, registerPublicPlayer, getConfigFilePath: ensureConfigFile, resolveAssetFile };

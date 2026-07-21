const { URL } = require('url');
const crypto = require('crypto');

const DEFAULT_GAME = 'sugar-rush';
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const FRAME_INTERVAL_MS = 200;
const SESSION_IDLE_MS = 15 * 60 * 1000;
const PAGE_NAVIGATION_TIMEOUT_MS = 30000;
const INTERNAL_GAME_TOKEN = crypto.randomBytes(32).toString('hex');

let chromium;
let browser;
const sessions = new Map();

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    ...extra,
  };
}

function sendJson(response, status, body) {
  const raw = JSON.stringify(body);
  response.writeHead(status, corsHeaders({
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(raw),
    'Cache-Control': 'no-store',
  }));
  response.end(raw);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        request.destroy();
        reject(new Error('Request body too large'));
      }
    });
    request.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function normalizeID(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 128);
}

function normalizeGame(value) {
  return value === 'slot' || value === 'sugar-rush' ? value : DEFAULT_GAME;
}

function normalizeSize(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function targetUrlForGame(game, sessionID, port) {
  const base = `http://127.0.0.1:${port}`;
  const encodedSession = encodeURIComponent(sessionID);
  const internal = `cloud_internal=${encodeURIComponent(INTERNAL_GAME_TOKEN)}`;

  if (game === 'slot') {
    return `${base}/slot/?sessionID=${encodedSession}&cloud=1&${internal}`;
  }

  return `${base}/sugar-rush/?sessionID=${encodedSession}&rgs_url=${encodeURIComponent(base)}&currency=USD&cloud=1&${internal}`;
}

function isLoopbackRequest(request) {
  const address = request.socket && request.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function isInternalGameRequest(request) {
  if (request.headers && request.headers['x-cloud-internal'] === INTERNAL_GAME_TOKEN) return true;

  try {
    const requestUrl = new URL(request.url, 'http://localhost');
    return requestUrl.searchParams.get('cloud_internal') === INTERNAL_GAME_TOKEN;
  } catch (error) {
    return false;
  }
}

function createCloudSession({ game, width, height, sessionID: requestedSessionID }) {
  const cloudID = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('base64url');
  const sessionID = normalizeID(requestedSessionID) || `cloud-${cloudID.slice(0, 8)}-${crypto.randomBytes(4).toString('hex')}`;
  const session = {
    key: cloudID,
    cloudID,
    token,
    sessionID,
    game,
    width,
    height,
    targetUrl: null,
    page: null,
    readyPromise: null,
    createdAt: Date.now(),
    lastAccess: Date.now(),
    capturePromise: null,
  };
  sessions.set(cloudID, session);
  return session;
}

function getAuthorizedSession(cloudID, token) {
  const session = sessions.get(normalizeID(cloudID));
  if (!session || !token || session.token !== String(token)) {
    const error = new Error('Invalid or expired cloud stream token');
    error.statusCode = 403;
    throw error;
  }
  return session;
}

async function ensureBrowser() {
  if (browser && browser.isConnected()) return browser;

  if (!chromium) {
    ({ chromium } = require('playwright'));
  }

  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
      '--use-gl=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
    ],
  });
  return browser;
}

async function prepareCloudGame(session) {
  if (session.game !== 'sugar-rush' || !session.page || session.page.isClosed()) return;

  const page = session.page;
  try {
    const gameSceneReady = await page.evaluate(() => Boolean(window.__sugarBlastGameScene));
    if (!gameSceneReady) {
      await page.keyboard.press('Space');
    }

    let ready = await page.waitForFunction(() => Boolean(window.__sugarBlastGameScene), null, { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!ready) {
      const viewport = page.viewportSize() || { width: session.width, height: session.height };
      await page.mouse.click(viewport.width / 2, viewport.height * 0.72);
      ready = await page.waitForFunction(() => Boolean(window.__sugarBlastGameScene), null, { timeout: 5000 })
        .then(() => true)
        .catch(() => false);
    }
    if (!ready) return;
    await page.evaluate(() => {
      const scene = window.__sugarBlastGameScene;
      if (scene && scene.introSplash && scene.introSplash.isVisible) scene.introSplash.hide();
    });
    await new Promise(r => setTimeout(r, 350));
  } catch (error) {
    console.warn(`[cloud:${session.cloudID}:${session.game}] auto-start failed: ${error.message}`);
  }
}

async function triggerCloudSpin(session, bet) {
  const page = session.page;
  return page.evaluate(value => {
    const scene = window.__sugarBlastGameScene;
    const spinHit = scene && scene.spinControls && scene.spinControls.spinHit;
    if (!spinHit || typeof spinHit.emit !== 'function') {
      window.dispatchEvent(new CustomEvent('unitySpin', { detail: { bet: value } }));
      return true;
    }

    if (scene.introSplash && typeof scene.introSplash.hide === 'function') scene.introSplash.hide();
    if (scene._spinLock) return false;

    spinHit.emit('pointerdown');
    return true;
  }, bet);
}

async function loadCloudGamePage(session, page, targetUrl) {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_NAVIGATION_TIMEOUT_MS });
  try {
    await page.waitForSelector('canvas', { timeout: 10000 });
  } catch (_) {
    // Canvas might use other methods; proceed anyway.
  }
  await new Promise(r => setTimeout(r, 1000));
  await prepareCloudGame(session);
}

async function ensureSession(session, { width, height, port }) {
  const targetUrl = targetUrlForGame(session.game, session.sessionID, port);

  if (session.readyPromise) await session.readyPromise;

  if (!session.page || session.page.isClosed()) {
    const activeBrowser = await ensureBrowser();
    const page = await activeBrowser.newPage({
      viewport: { width, height },
      extraHTTPHeaders: { 'X-Cloud-Internal': INTERNAL_GAME_TOKEN },
    });
    page.on('console', message => {
      const location = message.location();
      const source = location && location.url ? ` (${location.url})` : '';
      console.log(`[cloud:${session.cloudID}:${session.game}:${message.type()}] ${message.text()}${source}`);
    });
    page.on('response', pageResponse => {
      if (pageResponse.status() >= 400) {
        console.warn(`[cloud:${session.cloudID}:${session.game}:http${pageResponse.status()}] ${pageResponse.request().method()} ${pageResponse.url()}`);
      }
    });
    page.on('pageerror', error => console.warn(`[cloud:${session.cloudID}:${session.game}:error] ${error.message}`));
    page.on('requestfailed', request => {
      const failure = request.failure();
      if (failure) console.warn(`[cloud:${session.cloudID}:${session.game}:requestfailed] ${request.method()} ${request.url()} → ${failure.errorText}`);
    });
    session.width = width;
    session.height = height;
    session.targetUrl = targetUrl;
    session.page = page;
    session.lastAccess = Date.now();
    session.readyPromise = loadCloudGamePage(session, page, targetUrl);
    try {
      await session.readyPromise;
    } catch (error) {
      if (!page.isClosed()) await page.close().catch(() => {});
      session.page = null;
      session.targetUrl = null;
      throw error;
    } finally {
      session.readyPromise = null;
    }
    return session;
  }

  session.lastAccess = Date.now();
  if (session.width !== width || session.height !== height) {
    session.width = width;
    session.height = height;
    await session.page.setViewportSize({ width, height });
  }

  if (session.targetUrl !== targetUrl) {
    session.targetUrl = targetUrl;
    try {
      session.readyPromise = loadCloudGamePage(session, session.page, targetUrl);
      await session.readyPromise;
    } finally {
      session.readyPromise = null;
    }
  }

  return session;
}

async function captureFrame(session) {
  if (session.capturePromise) return session.capturePromise;

  const page = session.page;
  session.capturePromise = (async () => {
    try {
      const canvas = page.locator('canvas');
      if (await canvas.count() > 0) {
        return await canvas.screenshot({
          type: 'jpeg',
          quality: 60,
          omitBackground: true,
          timeout: 5000,
        });
      }
    } catch (_) {
      // fallback to full page screenshot
    }
    return await page.screenshot({
      type: 'jpeg',
      quality: 60,
      fullPage: false,
      animations: 'disabled',
    });
  })().finally(() => {
    session.capturePromise = null;
  });

  return session.capturePromise;
}

async function closeIdleSessions() {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.lastAccess < SESSION_IDLE_MS) continue;
    sessions.delete(key);
    try {
      if (session.page && !session.page.isClosed()) await session.page.close();
    } catch (error) {
      console.warn(`[cloud:${key}] close failed: ${error.message}`);
    }
  }
}

setInterval(() => {
  closeIdleSessions().catch(error => console.warn(`[cloud] idle cleanup failed: ${error.message}`));
}, 60 * 1000).unref?.();

function streamViewerHtml({ cloudID, token, game, width, height }) {
  const title = game === 'slot' ? 'Cloud Slot' : 'Cloud Sugar Rush';
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>${title}</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #02030a; touch-action: none; }
    #stream { width: 100vw; height: 100vh; object-fit: contain; display: block; user-select: none; -webkit-user-drag: none; }
    #status { position: fixed; left: 12px; top: 10px; padding: 5px 8px; border-radius: 8px; background: rgba(0,0,0,.45); color: #fff; font: 12px system-ui, sans-serif; pointer-events: none; }
  </style>
</head>
<body>
  <img id="stream" alt="${title}" draggable="false" src="/cloud/stream?id=${encodeURIComponent(cloudID)}&token=${encodeURIComponent(token)}&width=${width}&height=${height}">
  <div id="status">cloud stream</div>
  <script>
    const cloudID = ${JSON.stringify(cloudID)};
    const token = ${JSON.stringify(token)};
    const game = ${JSON.stringify(game)};
    const stream = document.getElementById('stream');
    const status = document.getElementById('status');

    function post(payload) {
      payload.id = cloudID;
      payload.token = token;
      payload.width = ${width};
      payload.height = ${height};
      return fetch('/cloud/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    }

    function streamPoint(event) {
      const rect = stream.getBoundingClientRect();
      const naturalW = stream.naturalWidth || ${width};
      const naturalH = stream.naturalHeight || ${height};
      const scale = Math.min(rect.width / naturalW, rect.height / naturalH);
      const drawW = naturalW * scale;
      const drawH = naturalH * scale;
      const offsetX = rect.left + (rect.width - drawW) / 2;
      const offsetY = rect.top + (rect.height - drawH) / 2;
      return {
        x: Math.max(0, Math.min(naturalW, (event.clientX - offsetX) / scale)),
        y: Math.max(0, Math.min(naturalH, (event.clientY - offsetY) / scale)),
      };
    }

    stream.addEventListener('pointerdown', event => {
      event.preventDefault();
      stream.setPointerCapture?.(event.pointerId);
      const point = streamPoint(event);
      post({ type: 'click', x: point.x, y: point.y });
    });

    stream.addEventListener('wheel', event => {
      event.preventDefault();
      post({ type: 'scroll', deltaX: event.deltaX, deltaY: event.deltaY });
    }, { passive: false });

    window.addEventListener('keydown', event => {
      if (event.repeat) return;
      post({ type: 'key', key: event.key === ' ' ? 'Space' : event.key });
    });

    window.addEventListener('unitySpin', event => {
      post({ type: 'unitySpin', bet: event.detail && event.detail.bet || 100 });
    });

    window.__chipBalance = balance => post({ type: 'chipBalance', balance });
    stream.addEventListener('load', () => { status.textContent = 'cloud stream'; });
    stream.addEventListener('error', () => { status.textContent = 'reconnecting...'; setTimeout(() => { stream.src = stream.src.split('&r=')[0] + '&r=' + Date.now(); }, 500); });
  </script>
</body>
</html>`;
}

async function handleStream(request, response, requestUrl, port) {
  const session = getAuthorizedSession(requestUrl.searchParams.get('id'), requestUrl.searchParams.get('token'));
  const width = normalizeSize(requestUrl.searchParams.get('width'), DEFAULT_WIDTH, 320, 1920);
  const height = normalizeSize(requestUrl.searchParams.get('height'), DEFAULT_HEIGHT, 240, 1080);
  await ensureSession(session, { width, height, port });

  response.writeHead(200, corsHeaders({
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Connection': 'close',
    'X-Accel-Buffering': 'no',
  }));

  let closed = false;
  request.on('close', () => { closed = true; });

  async function writeFrame() {
    if (closed || response.destroyed) return;
    try {
      session.lastAccess = Date.now();
      const frame = await captureFrame(session);
      response.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
      response.write(frame);
      response.write('\r\n');
    } catch (error) {
      console.warn(`[cloud:${session.cloudID}:${session.game}] frame failed: ${error.message}`);
    }
  }

  async function frameLoop() {
    if (closed || response.destroyed) return;
    await writeFrame();
    if (!closed && !response.destroyed) {
      setTimeout(frameLoop, FRAME_INTERVAL_MS);
    }
  }
  frameLoop();
}

async function handleFrame(request, response, requestUrl, port) {
  const session = getAuthorizedSession(requestUrl.searchParams.get('id'), requestUrl.searchParams.get('token'));
  const width = normalizeSize(requestUrl.searchParams.get('width'), DEFAULT_WIDTH, 320, 1920);
  const height = normalizeSize(requestUrl.searchParams.get('height'), DEFAULT_HEIGHT, 240, 1080);
  await ensureSession(session, { width, height, port });

  session.lastAccess = Date.now();
  const frame = await captureFrame(session);
  response.writeHead(200, corsHeaders({
    'Content-Type': 'image/jpeg',
    'Content-Length': frame.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  }));
  response.end(frame);
}

async function handleInput(request, response, body, port) {
  const session = getAuthorizedSession(body.id, body.token);
  const width = normalizeSize(body.width, DEFAULT_WIDTH, 320, 1920);
  const height = normalizeSize(body.height, DEFAULT_HEIGHT, 240, 1080);
  await ensureSession(session, { width, height, port });
  const page = session.page;
  const type = String(body.type || '');

  session.lastAccess = Date.now();

  if (type === 'click') {
    await page.mouse.click(Number(body.x) || 0, Number(body.y) || 0);
  } else if (type === 'scroll') {
    await page.mouse.wheel(Number(body.deltaX) || 0, Number(body.deltaY) || 0);
  } else if (type === 'key') {
    const key = String(body.key || '');
    if (key) await page.keyboard.press(key.length === 1 ? key : key);
  } else if (type === 'text') {
    const text = String(body.text || '');
    if (text) await page.keyboard.insertText(text);
  } else if (type === 'unitySpin') {
    const bet = Number(body.bet) || 100;
    await prepareCloudGame(session);
    await triggerCloudSpin(session, bet);
  } else if (type === 'chipBalance') {
    const balance = Number(body.balance);
    if (Number.isFinite(balance)) {
      await page.evaluate(value => {
        if (typeof window.__chipBalance === 'function') window.__chipBalance(value);
      }, balance);
    }
  }

  sendJson(response, 200, { ok: true });
}

async function closeSession(body) {
  const session = getAuthorizedSession(body.id, body.token);
  sessions.delete(session.cloudID);
  if (session && session.page && !session.page.isClosed()) await session.page.close();
}

function handleCloudStreamRoute(request, response, port) {
  const requestUrl = new URL(request.url, `http://127.0.0.1:${port}`);
  const pathname = requestUrl.pathname;

  if (!pathname.startsWith('/cloud')) return false;

  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders());
    response.end();
    return true;
  }

  (async () => {
    if (request.method === 'GET' && pathname === '/cloud/start') {
      const game = normalizeGame(requestUrl.searchParams.get('game'));
      const width = normalizeSize(requestUrl.searchParams.get('width'), DEFAULT_WIDTH, 320, 1920);
      const height = normalizeSize(requestUrl.searchParams.get('height'), DEFAULT_HEIGHT, 240, 1080);
      const session = createCloudSession({ game, width, height, sessionID: requestUrl.searchParams.get('sessionID') });
      response.writeHead(302, {
        Location: `/cloud/?id=${encodeURIComponent(session.cloudID)}&token=${encodeURIComponent(session.token)}&width=${width}&height=${height}`,
        'Cache-Control': 'no-store',
      });
      response.end();
      return;
    }

    if (request.method === 'GET' && (pathname === '/cloud' || pathname === '/cloud/')) {
      const cloudID = requestUrl.searchParams.get('id');
      const token = requestUrl.searchParams.get('token');
      if (!cloudID || !token) {
        const game = normalizeGame(requestUrl.searchParams.get('game'));
        response.writeHead(302, {
          Location: `/cloud/start?game=${encodeURIComponent(game)}`,
          'Cache-Control': 'no-store',
        });
        response.end();
        return;
      }

      const session = getAuthorizedSession(cloudID, token);
      const width = normalizeSize(requestUrl.searchParams.get('width'), DEFAULT_WIDTH, 320, 1920);
      const height = normalizeSize(requestUrl.searchParams.get('height'), DEFAULT_HEIGHT, 240, 1080);
      const html = streamViewerHtml({ cloudID: session.cloudID, token: session.token, game: session.game, width, height });
      response.writeHead(200, corsHeaders({
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(html),
        'Cache-Control': 'no-store',
      }));
      response.end(html);
      return;
    }

    if (request.method === 'GET' && pathname === '/cloud/stream') {
      await handleStream(request, response, requestUrl, port);
      return;
    }

    if (request.method === 'GET' && pathname === '/cloud/frame') {
      await handleFrame(request, response, requestUrl, port);
      return;
    }

    if (request.method === 'GET' && pathname === '/cloud/state') {
      if (!isLoopbackRequest(request)) {
        sendJson(response, 403, { ok: false, error: 'Forbidden' });
        return;
      }

      sendJson(response, 200, {
        ok: true,
        sessions: [...sessions.values()].map(session => ({
          id: session.cloudID,
          sessionID: session.sessionID,
          game: session.game,
          width: session.width,
          height: session.height,
          lastAccess: session.lastAccess,
        })),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/cloud/input') {
      await handleInput(request, response, await readJson(request), port);
      return;
    }

    if (request.method === 'POST' && pathname === '/cloud/close') {
      await closeSession(await readJson(request));
      sendJson(response, 200, { ok: true });
      return;
    }

    sendJson(response, 404, { ok: false, error: 'Cloud stream route not found' });
  })().catch(error => {
    if (!error.statusCode || error.statusCode >= 500) {
      console.error(`[cloud] ${error.stack || error.message}`);
    }
    if (!response.headersSent) sendJson(response, error.statusCode || 500, { ok: false, error: error.message });
    else response.destroy(error);
  });

  return true;
}

function listCloudSessions() {
  return [...sessions.values()].map(session => ({
    id: session.cloudID,
    sessionID: session.sessionID,
    game: session.game,
    width: session.width,
    height: session.height,
    lastAccess: session.lastAccess,
  }));
}

module.exports = { handleCloudStreamRoute, isInternalGameRequest, listCloudSessions };

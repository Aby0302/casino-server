const http = require('http');
const { URL } = require('url');
const { chromium } = require('playwright');

const port = Number(process.argv[2] || process.env.EDITOR_WEBVIEW_PORT || 3999);
const host = '127.0.0.1';

let browser;
let page;
let viewport = { width: 1024, height: 768 };

async function ensurePage(width, height) {
  viewport = {
    width: Math.max(320, Number(width) || viewport.width),
    height: Math.max(240, Number(height) || viewport.height),
  };

  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  }

  if (!page || page.isClosed()) {
    page = await browser.newPage({ viewport });
    page.on('console', (message) => console.log(`[browser:${message.type()}] ${message.text()}`));
    page.on('pageerror', (error) => console.error(`[browser:error] ${error.message}`));
  } else {
    await page.setViewportSize(viewport);
  }

  return page;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        request.destroy();
        reject(new Error('Request body too large'));
      }
    });
    request.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

function sendError(response, error) {
  console.error(error);
  sendJson(response, 500, { ok: false, error: error.message || String(error) });
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url, `http://${host}:${port}`);

  if (request.method === 'GET' && requestUrl.pathname === '/health') {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/open') {
    const url = requestUrl.searchParams.get('url');
    if (!url) {
      sendJson(response, 400, { ok: false, error: 'Missing url' });
      return;
    }

    const activePage = await ensurePage(requestUrl.searchParams.get('width'), requestUrl.searchParams.get('height'));
    await activePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    sendJson(response, 200, { ok: true, url, viewport });
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/screenshot') {
    if (!page || page.isClosed()) {
      sendJson(response, 404, { ok: false, error: 'No page loaded' });
      return;
    }

    const image = await page.screenshot({ type: 'png', fullPage: false });
    response.writeHead(200, {
      'content-type': 'image/png',
      'content-length': image.length,
      'cache-control': 'no-store',
    });
    response.end(image);
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/click') {
    if (!page || page.isClosed()) {
      sendJson(response, 404, { ok: false, error: 'No page loaded' });
      return;
    }
    const body = await readBody(request);
    await page.mouse.click(Number(body.x) || 0, Number(body.y) || 0);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/scroll') {
    if (!page || page.isClosed()) {
      sendJson(response, 404, { ok: false, error: 'No page loaded' });
      return;
    }
    const body = await readBody(request);
    await page.mouse.wheel(Number(body.deltaX) || 0, Number(body.deltaY) || 0);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/keydown') {
    if (!page || page.isClosed()) {
      sendJson(response, 404, { ok: false, error: 'No page loaded' });
      return;
    }
    const body = await readBody(request);
    if (body.text) {
      await page.keyboard.insertText(String(body.text));
    } else if (body.key) {
      await page.keyboard.press(String(body.key));
    }
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/eval') {
    if (!page || page.isClosed()) {
      sendJson(response, 404, { ok: false, error: 'No page loaded' });
      return;
    }
    const body = await readBody(request);
    await page.evaluate(String(body.js || 'undefined'));
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/close') {
    if (page && !page.isClosed()) {
      await page.close();
      page = null;
    }
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 404, { ok: false, error: 'Not found' });
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => sendError(response, error));
});

server.listen(port, host, () => {
  console.log(`Editor WebView server listening on http://${host}:${port}`);
});

async function shutdown() {
  server.close();
  if (browser) {
    await browser.close();
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

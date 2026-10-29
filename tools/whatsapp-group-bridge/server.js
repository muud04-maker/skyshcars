require('dotenv').config();
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

/*
  Sky Cars WhatsApp Group Reader. READ-ONLY: this program never sends anything to WhatsApp.
  It reads only groups authorized in the website admin and posts their messages to the
  authenticated ingestion bridge. The session, recovered batches and retry outbox live on
  persistent storage outside the Git checkout.
*/
const base = (process.env.SKY_CARS_URL || 'https://skyshcars.com').replace(/\/$/, '');
const secret = process.env.WHATSAPP_SERVICE_SECRET || '';
const bridgeId = process.env.BRIDGE_ID || 'primary';
const VERSION = '34';
const POST_WINDOW_MS = Number(process.env.POST_WINDOW_MS || 20000);
const stateDir = path.resolve(process.env.STATE_DIR || path.join(__dirname, '.state'));
const sessionDir = path.join(stateDir, 'session');
const outboxDir = path.join(stateDir, 'outbox');
const pendingFile = path.join(stateDir, 'pending.json');

const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (...args) => console.log(ts(), '[INFO]', ...args);
const warn = (...args) => console.warn(ts(), '[WARN]', ...args);
const fail = (...args) => console.error(ts(), '[ERROR]', ...args);

process.on('unhandledRejection', (e) => fail('Unhandled promise rejection:', e?.message || e));
process.on('uncaughtException', (e) => {
  fail('Crash:', e?.stack || e);
  process.exit(1);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    log(`Received ${signal}, shutting down.`);
    try { await client?.destroy(); } catch {}
    process.exit(0);
  });
}

if (!secret) {
  const message = 'WHATSAPP_SERVICE_SECRET is empty. Add the same value used by the website, then restart the reader.';
  fail(message);
  setInterval(() => fail(message), 5 * 60 * 1000);
  return;
}

let allowed = [];
let account = '';
let visible = 0;
let state = 'starting';
let lastError = '';
let sentPosts = 0;
const pending = new Map();

async function api(route, options = {}) {
  return fetch(base + route, {
    ...options,
    headers: {
      'x-sky-secret': secret,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

async function atomicJson(file, value) {
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
  await fsp.rename(temp, file);
}

function payloadId() {
  return `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
}

class DurableOutbox {
  constructor(dir) {
    this.dir = dir;
    this.flushing = false;
  }

  async init() {
    await fsp.mkdir(this.dir, { recursive: true, mode: 0o700 });
  }

  async enqueue(kind, payload) {
    const id = payloadId();
    const record = {
      id,
      kind,
      payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
    };
    await atomicJson(path.join(this.dir, `${id}.json`), record);
    return id;
  }

  async flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const files = (await fsp.readdir(this.dir)).filter((name) => name.endsWith('.json')).sort();
      for (const name of files) {
        const file = path.join(this.dir, name);
        let record;
        try {
          record = JSON.parse(await fsp.readFile(file, 'utf8'));
        } catch {
          warn('Unreadable outbox item:', name);
          continue;
        }
        if (Number(record.nextAttemptAt || 0) > Date.now()) continue;
        const route = record.kind === 'log' ? '/api/bridge/whatsapp-group/log' : '/api/bridge/whatsapp-group';
        try {
          const response = await api(route, { method: 'POST', body: JSON.stringify(record.payload) });
          const detail = await response.text();
          if (!response.ok) throw new Error(`HTTP ${response.status} ${detail.slice(0, 240)}`);
          await fsp.unlink(file);
          if (record.kind === 'log') {
            log('Queued group message delivered.');
          } else {
            sentPosts++;
            log('Post sent to website:', record.payload.groupName, (record.payload.messageIds || []).length, 'message(s),', record.payload.photoCount || 0, 'photo(s)');
          }
        } catch (error) {
          record.attempts = Number(record.attempts || 0) + 1;
          record.lastError = String(error?.message || error).slice(0, 500);
          const delay = Math.min(15 * 60 * 1000, 15000 * (2 ** Math.min(record.attempts - 1, 6)));
          record.nextAttemptAt = Date.now() + delay;
          await atomicJson(file, record);
          lastError = `${record.kind}: ${record.lastError}`;
          warn(`Website delivery failed (attempt ${record.attempts}); item remains on disk:`, record.lastError);
          break; // preserve order so logs and their original photos reach the site before the import
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}

const outbox = new DurableOutbox(outboxDir);

async function refreshConfig() {
  try {
    const response = await api('/api/bridge/whatsapp-group/config');
    if (!response.ok) throw new Error(`HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
    const json = await response.json();
    allowed = (json.groups || []).map((group) => ({
      name: String(group.group_name || '').trim().toLowerCase(),
      id: String(group.group_external_id || ''),
    }));
    log('Authorized groups:', allowed.map((group) => group.name).join(', ') || '(none)');
  } catch (error) {
    lastError = 'config: ' + error.message;
    fail('Could not load authorized groups from the website:', error.message);
  }
}

function groupAllowed(chat) {
  const name = String(chat.name || '').trim().toLowerCase();
  const id = String(chat.id?._serialized || '');
  // A pinned ID is mandatory. Display-name matching is used only before the first discovery.
  return allowed.some((group) => group.id ? group.id === id : group.name === name);
}

async function heartbeat(status = state) {
  state = status;
  try {
    await api('/api/bridge/whatsapp-group/heartbeat', {
      method: 'POST',
      body: JSON.stringify({
        bridgeId,
        status,
        whatsappAccount: account,
        visibleGroups: visible,
        version: VERSION,
        details: {
          authorized: allowed.length,
          authorizedIds: allowed.filter((group) => group.id).length,
          pendingPosts: pending.size,
          sentPosts,
          lastError: lastError || null,
        },
      }),
    });
  } catch (error) {
    warn('Heartbeat failed:', error.message);
  }
}

async function persistPending() {
  const saved = {};
  for (const [key, item] of pending) {
    saved[key] = {
      ids: item.ids,
      groupName: item.groupName,
      groupId: item.groupId,
      sender: item.sender,
      senderPhone: item.senderPhone,
      senderName: item.senderName,
      texts: item.texts,
      photoCount: item.photoCount || 0,
      receivedAt: item.receivedAt,
      notBefore: item.notBefore,
    };
  }
  await atomicJson(pendingFile, saved);
}

async function restorePending() {
  try {
    const saved = JSON.parse(await fsp.readFile(pendingFile, 'utf8'));
    for (const [key, savedItem] of Object.entries(saved || {})) {
      const item = { ...savedItem, inflight: 0, timer: null };
      pending.set(key, item);
      const wait = Math.max(0, Number(savedItem.notBefore || 0) - Date.now());
      item.timer = setTimeout(() => flush(key, item).catch((error) => fail('Recovered post flush failed:', error.message)), wait);
    }
    if (pending.size) log(`Recovered ${pending.size} unfinished group batch(es) from disk.`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function queueLog(entry) {
  await outbox.enqueue('log', entry);
  outbox.flush();
}

async function flush(key, item) {
  if (pending.get(key) !== item) return;
  if (item.inflight > 0) {
    item.timer = setTimeout(() => flush(key, item).catch((error) => fail('Delayed post flush failed:', error.message)), 2000);
    return;
  }
  pending.delete(key);
  await persistPending();
  const payload = {
    messageId: [...item.ids].sort().join('+'),
    messageIds: item.ids,
    groupName: item.groupName,
    groupId: item.groupId,
    sender: item.sender,
    senderPhone: item.senderPhone,
    senderName: item.senderName,
    text: item.texts.filter(Boolean).join('\n'),
    receivedAt: item.receivedAt,
    photoCount: item.photoCount || 0,
    media: [],
  };
  await outbox.enqueue('import', payload);
  outbox.flush();
}

async function discoverGroups() {
  try {
    const chats = await client.getChats();
    const candidates = chats
      .filter((chat) => chat.isGroup)
      .map((chat) => ({ id: String(chat.id?._serialized || ''), name: String(chat.name || '') }))
      .filter((group) => group.id && group.name);
    const response = await api('/api/bridge/whatsapp-group/discover', {
      method: 'POST',
      body: JSON.stringify({ bridgeId, groups: candidates }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`HTTP ${response.status} ${result.error || ''}`);
    const locked = (result.groups || []).filter((group) => group.status === 'locked');
    log(`Exact group discovery complete: ${locked.length} ID(s) newly locked.`);
    for (const group of result.groups || []) log(`Group ${group.group_name}: ${group.status}`);
    await refreshConfig();
  } catch (error) {
    lastError = 'discovery: ' + error.message;
    warn('Could not lock the authorized group ID yet:', error.message);
  }
}

async function integrationDiagnostics() {
  try {
    const response = await api('/api/bridge/whatsapp-group/diagnostics');
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`HTTP ${response.status} ${result.error || ''}`);
    log('Integration diagnostics', JSON.stringify({
      facebookConnected: !!result.facebook?.connected,
      facebookPageId: result.facebook?.pageId || null,
      facebookMissingScopes: result.facebook?.missingScopes || [],
      whatsappCloudLive: !!result.whatsappCloud?.live?.ok,
      whatsappName: result.whatsappCloud?.live?.name || null,
      deepseek: result.deepseek?.detail || null,
      messengerConnected: false,
    }));
  } catch (error) {
    warn('Integration diagnostics unavailable:', error.message);
  }
}

let currentQr = null;

function qrAuthorized(request) {
  const expected = String(process.env.QR_ADMIN_TOKEN || '');
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  const given = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '') || String(url.searchParams.get('token') || '');
  if (!expected || given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

function startQrPanel() {
  const token = String(process.env.QR_ADMIN_TOKEN || '').trim();
  if (!token) {
    warn('QR_ADMIN_TOKEN is empty; the local QR status page is disabled.');
    return;
  }
  const host = String(process.env.QR_BIND_HOST || '127.0.0.1');
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
    fail('Refusing to start the QR page on a non-local address.');
    return;
  }
  const port = Number(process.env.QR_PORT || 3199);
  const server = http.createServer((request, response) => {
    if (!qrAuthorized(request)) {
      response.writeHead(401, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      response.end('Unauthorized');
      return;
    }
    const safeState = String(state).replace(/[^a-z_]/gi, '');
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'",
    });
    response.end(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="15"><title>Sky Cars WhatsApp Link</title>
      <style>body{font:16px system-ui;margin:32px;max-width:560px}img{width:320px;height:320px;image-rendering:pixelated}.muted{color:#555}</style>
      <h1>Sky Cars WhatsApp linking</h1><p>State: <b>${safeState}</b></p>
      ${currentQr ? `<img alt="WhatsApp QR" src="${currentQr}">` : state === 'online' ? '<p>The linked device is already online.</p>' : '<p>Waiting for the next QR code. Refresh in 15 seconds.</p>'}
      <p class="muted">This page binds to localhost. Use an SSH tunnel and close it after scanning.</p>`);
  });
  server.listen(port, host, () => log(`QR status page listening locally on http://${host}:${port}`));
}

const puppeteerArgs = ['--disable-dev-shm-usage', '--disable-gpu'];
if (String(process.env.DISABLE_CHROMIUM_SANDBOX || '').toLowerCase() === 'true') {
  puppeteerArgs.push('--no-sandbox', '--disable-setuid-sandbox');
}
const puppeteer = { headless: true, args: puppeteerArgs };
if (process.env.PUPPETEER_EXECUTABLE_PATH) puppeteer.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'sky-cars-group-reader-v27', dataPath: sessionDir }),
  puppeteer,
});

client.on('qr', async (qr) => {
  try {
    currentQr = await QRCode.toDataURL(qr, { margin: 1, width: 320, errorCorrectionLevel: 'M' });
  } catch (error) {
    warn('QR image rendering failed:', error.message);
  }
  log('==================== WHATSAPP LOGIN NEEDED ====================');
  log('On the Sky Cars phone: WhatsApp > Settings > Linked devices > Link a device.');
  qrcode.generate(qr, { small: true });
  log('The QR page is available through the private localhost tunnel when QR_ADMIN_TOKEN is configured.');
  heartbeat('qr_required');
});

client.on('authenticated', () => log('WhatsApp login accepted; the local session is saved.'));
client.on('ready', async () => {
  log(`Sky Cars Group Reader v${VERSION} READY (read-only, never sends WhatsApp messages)`);
  currentQr = null;
  const info = client.info || {};
  account = String(info.wid?._serialized || '');
  try {
    const chats = await client.getChats();
    visible = chats.filter((chat) => chat.isGroup).length;
  } catch {}
  await refreshConfig();
  await discoverGroups();
  await outbox.flush();
  await integrationDiagnostics();
  lastError = '';
  await heartbeat('online');
});
client.on('auth_failure', async (message) => {
  fail('WhatsApp login failed:', message, '- remove the saved session and scan again.');
  lastError = 'auth_failure';
  await heartbeat('auth_failed');
  setTimeout(() => process.exit(1), 60000);
});
client.on('disconnected', async (reason) => {
  fail('WhatsApp disconnected:', reason, '- restarting in 30 seconds.');
  lastError = 'disconnected: ' + reason;
  await heartbeat('disconnected');
  setTimeout(() => process.exit(1), 30000);
});

client.on('message_create', async (message) => {
  try {
    const chat = await message.getChat();
    if (!chat.isGroup || !groupAllowed(chat)) return;
    const body = String(message.body || '').trim();
    if (!body && !message.hasMedia) return;
    const groupId = String(chat.id?._serialized || '');
    const sender = String(message.author || message.from || '');
    const key = groupId + '|' + sender;
    const messageId = message.id?._serialized || `${groupId}-${sender}-${message.timestamp || Date.now()}`;
    let senderName = null;
    let senderPhone = null;
    try {
      const contact = await message.getContact();
      senderName = contact?.pushname || contact?.name || null;
      senderPhone = contact?.number || null;
    } catch {}

    let item = pending.get(key);
    if (!item) {
      item = {
        ids: [],
        groupName: chat.name,
        groupId,
        sender,
        senderPhone,
        senderName,
        texts: [],
        photoCount: 0,
        receivedAt: new Date().toISOString(),
        timer: null,
        inflight: 0,
        notBefore: 0,
      };
      pending.set(key, item);
    }
    clearTimeout(item.timer);
    item.ids.push(messageId);
    if (body) item.texts.push(body);

    const photos = [];
    if (message.hasMedia) {
      item.inflight++;
      try {
        const media = await message.downloadMedia();
        if (media?.data && /^image\//i.test(media.mimetype || '')) {
          photos.push({
            data: media.data,
            mimeType: media.mimetype || 'image/jpeg',
            filename: media.filename || null,
          });
          item.photoCount = (item.photoCount || 0) + 1;
        }
      } catch (error) {
        warn('Photo download failed:', error.message);
      } finally {
        item.inflight--;
      }
    }

    // Persist the message and original photo bytes before any network request.
    await queueLog({
      messageId,
      groupName: chat.name,
      groupId,
      sender,
      senderPhone,
      senderName,
      fromMe: !!message.fromMe,
      type: message.type || 'chat',
      text: body,
      timestamp: message.timestamp || null,
      receivedAt: new Date().toISOString(),
      media: photos,
    });
    log(`Group message: ${chat.name} - ${senderName || sender} - ${body ? body.slice(0, 60).replace(/\s+/g, ' ') : ''}${photos.length ? ` [${photos.length} photo]` : ''}`);
    item.notBefore = Date.now() + POST_WINDOW_MS;
    await persistPending();
    item.timer = setTimeout(() => flush(key, item).catch((error) => fail('Post flush failed:', error.message)), POST_WINDOW_MS);
  } catch (error) {
    fail('Group message error:', error?.stack || error);
  }
});

async function boot() {
  await fsp.mkdir(stateDir, { recursive: true, mode: 0o700 });
  await fsp.mkdir(sessionDir, { recursive: true, mode: 0o700 });
  await outbox.init();
  await restorePending();
  startQrPanel();
  log(`Starting Sky Cars Group Reader v${VERSION}; website: ${base}; bridge: ${bridgeId}; state: ${stateDir}`);
  heartbeat('starting');
  setInterval(() => heartbeat(), 60000);
  setInterval(() => refreshConfig(), 60000);
  setInterval(() => outbox.flush(), 30000);
  client.initialize().catch((error) => {
    fail('Could not start WhatsApp (browser):', error?.message || error);
    setTimeout(() => process.exit(1), 30000);
  });
}

boot().catch((error) => {
  fail('Startup failed:', error?.stack || error);
  process.exit(1);
});

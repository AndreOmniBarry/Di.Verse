const paths = require('./services/paths');
require('dotenv').config({ path: paths.ENV_FILE, quiet: true }); // the only place .env is loaded for the app
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const os = require('os');
const fs = require('fs');

// A crash must never leave the screen dark for long: log it and exit, and
// the supervisor (npm start → scripts/supervisor.js) restarts the server in a
// second, restoring what was on screen (see screen state below)
process.on('uncaughtException', err => { console.error('[Fatal]', err); process.exit(1); });
process.on('unhandledRejection', err => console.error('[Unhandled promise]', err));

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json({ limit: '5mb' })); // a 12 s audio chunk is ~0.5 MB

// ── Only the operator laptop controls Di.Verse ──
// Projection and preacher pages are read-only for any device on the Wi-Fi;
// pushing, clearing, editing songs and listening need the laptop itself
// (or OPERATOR_TOKEN, for running the operator page from another computer).
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
function isOperator(req) {
  if (LOOPBACK.has(req.socket.remoteAddress)) return true;
  const token = process.env.OPERATOR_TOKEN;
  return Boolean(token) && (req.get('x-diverse-token') === token || req.query.token === token);
}
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || isOperator(req)) return next();
  res.status(403).json({ error: 'Only the operator laptop can control Di.Verse' });
});
for (const page of ['/operator', '/admin', '/setup']) {
  app.use(page, (req, res, next) => isOperator(req) ? next()
    : res.status(403).send('<p style="font-family:sans-serif">The operator and admin pages only open on the Di.Verse laptop. Use <a href="/projection">/projection</a> or <a href="/preacher">/preacher</a> on this device.</p>'));
}

// Pages and scripts are always re-checked, so a browser (or vMix's browser
// input) never keeps running an old copy after an update
app.use(express.static(path.join(__dirname, 'public'), {
  // Never kept in a browser cache (vMix's built-in browser held on to old
  // copies): every load gets the version that is installed
  setHeaders: (res, file) => { if (/\.(html|js|css)$/.test(file)) res.setHeader('Cache-Control', 'no-store'); },
}));

// ── Settings: keys and the vMix link, kept in .env (operator laptop only) ──
// Values are never sent back to the browser, only whether each is set.
const SETTINGS = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'APIBIBLE_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'VMIX_URL'];
const mask = v => !v ? null : v.split(',').map(k => k.trim()).filter(Boolean).map(k => k.length > 12 ? '…' + k.slice(-4) : 'set').join(', ');
app.get('/api/setup', (req, res) => {
  if (!isOperator(req)) return res.status(403).json({ error: 'Operator laptop only' });
  res.json({ settings: Object.fromEntries(SETTINGS.map(k => [k, k === 'VMIX_URL' ? (process.env[k] || null) : mask(process.env[k])])),
    dataFolder: paths.DATA, packaged: paths.packaged, supervised: Boolean(process.env.DIVERSE_SUPERVISED) });
});
app.post('/api/setup', (req, res) => {
  const changes = {};
  for (const k of SETTINGS) {
    if (!(k in (req.body || {}))) continue;
    const v = String(req.body[k] == null ? '' : req.body[k]).trim();
    if (/[\r\n]/.test(v) || v.length > 2000) return res.status(400).json({ error: k + ': one line, please' });
    changes[k] = v;
  }
  if (!Object.keys(changes).length) return res.status(400).json({ error: 'Nothing to save' });
  let text = '';
  try { text = fs.readFileSync(paths.ENV_FILE, 'utf8'); } catch (e) {}
  const lines = text.split(/\r?\n/);
  for (const [k, v] of Object.entries(changes)) {
    const i = lines.findIndex(l => new RegExp('^\\s*' + k + '\\s*=').test(l));
    if (i >= 0) lines[i] = k + '=' + v; else lines.push(k + '=' + v);
    process.env[k] = v;
  }
  fs.writeFileSync(paths.ENV_FILE, lines.join('\n').replace(/\n*$/, '\n'));
  console.log('[Setup] Saved ' + Object.keys(changes).join(', '));
  const restart = Boolean(process.env.DIVERSE_SUPERVISED);
  res.json({ saved: Object.keys(changes), restarting: restart });
  // a fresh start picks every setting up everywhere; the pages reconnect
  if (restart) setTimeout(() => process.exit(65), 300);
});
// "Stop Di.Verse" (the packaged app has no Terminal window to close)
app.post('/api/shutdown', (req, res) => {
  console.log('[Di.Verse] Stopped from the Settings page');
  res.json({ stopping: true });
  setTimeout(() => process.exit(process.env.DIVERSE_SUPERVISED ? 64 : 0), 300);
});

// Which version is running — shown on the Operator page
const VERSION = require('./package.json').version;
app.get('/api/version', (req, res) => res.json({ version: VERSION }));

// ── Routes ──
app.use('/api', require('./routes/bible'));
app.use('/api', require('./routes/library'));
app.use('/api', require('./routes/songs'));
app.use('/api', require('./routes/transcribe'));
app.use('/api', require('./routes/detect'));
app.use('/api', require('./routes/push'));

// vMix link check (SETUP.md): is it reachable, and what inputs does it have?
app.get('/api/vmix', async (req, res) => {
  const v = vmixService();
  const screens = connectedScreens();
  if (!v.configured()) return res.json({ configured: false, help: 'Set VMIX_URL=http://<vmix-pc-ip>:8088 in .env', screens });
  try {
    const st = await v.state();
    const want = process.env.VMIX_SQUEEZE_INPUT;
    const live = st.inputs.find(i => i.number === st.active);
    res.json({ configured: true, reachable: true, mode: v.sceneMode() ? 'scene' : 'automatic',
      live: live ? live.number + ' ' + live.title : st.active, inputs: st.inputs,
      ...(want ? { squeezeInputFound: st.inputs.some(i => i.title === want || i.number === want) } : {}), screens });
  } catch (err) {
    res.json({ configured: true, reachable: false, error: err.message, screens });
  }
});
function vmixService() { return require('./services/vmix'); }

// Any route error answers in JSON instead of hanging the request
app.use('/api', (err, req, res, next) => {
  console.error('[API Error]', req.method, req.path, err.message);
  res.status(err.status || 500).json({ error: err.message });
});

// ── Views ──
app.get('/', (req, res) => res.redirect('/operator'));
function page(res, name) {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', name, 'index.html'));
}
app.get('/operator', (req, res) => page(res, 'operator'));
app.get('/projection', (req, res) => page(res, 'projection'));
app.get('/preacher', (req, res) => page(res, 'preacher'));
app.get('/admin', (req, res) => page(res, 'admin'));
app.get('/about', (req, res) => page(res, 'about'));

// ── Screen state ──
// What is on screen right now (verse/lyrics, theme, background, font size).
// Sent to every screen that (re)connects, so a projector, phone or OBS source
// that drops out — or a server restart — comes straight back to the same
// picture. Saved to disk; a saved verse older than 30 minutes isn't restored
// at startup (so next week doesn't open on last week's verse).
const STATE_FILE = paths.STATE_FILE;
let screenState = {};
try {
  screenState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (!screenState.savedAt || Date.now() - screenState.savedAt > 30 * 60000) delete screenState.screen;
} catch (e) { screenState = {}; }

function rememberScreen(payload) {
  switch (payload.action) {
    case 'SHOW_VERSE': case 'SHOW_LYRICS': screenState.screen = payload; break;
    case 'CLEAR': delete screenState.screen; break;
    case 'APPLY_THEME': screenState.theme = payload; break;
    case 'APPLY_BACKGROUND': screenState.background = payload; break;
    case 'FONT_SIZE': screenState.font = payload; break;
    default: return;
  }
  screenState.savedAt = Date.now();
  // Written straight away (it's tiny) so even a crash right after a push
  // comes back showing that push
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(screenState)); }
  catch (err) { console.error('[State] save failed:', err.message); }
}

function replayScreen(ws) {
  for (const key of ['background', 'theme', 'font', 'screen']) {
    if (screenState[key]) ws.send(JSON.stringify(screenState[key]));
  }
}

// ── WebSocket ──
const clients = new Set();

wss.on('connection', (ws, req) => {
  const type = new URL(req.url, 'http://localhost').searchParams.get('type') || 'unknown';
  ws.clientType = type;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  clients.add(ws);
  console.log(`[WS] Client connected: ${type} (total: ${clients.size})`);
  if (type === 'operator') {
    ws.send(JSON.stringify({ action: 'STATE', state: screenState }));
    for (const c of clients) if (c.stale) ws.send(JSON.stringify({ action: 'NOTICE', message: staleMessage(c) }));
  } else replayScreen(ws);
  // Every current projection page introduces itself straight away. One that
  // doesn't is an old copy still open (e.g. in vMix): say so, and if vMix is
  // linked, have vMix reload it
  if (type === 'projection') {
    ws.ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    setTimeout(() => {
      if (ws.info || ws.readyState !== 1) return;
      ws.stale = true;
      console.warn(`[Screen] ${ws.ip} is showing an OLD Di.Verse page — refresh it (in vMix: change the input's URL to http://${IP}:${PORT}/projection?overlay=1&v=${VERSION})`);
      alertOperator({ action: 'NOTICE', message: staleMessage(ws) });
      reloadVmixScreens('an old page was found');
    }, parseInt(process.env.DIVERSE_STALE_MS) || 6000).unref();
  }

  // Projection pages (the projector, vMix's Web Browser input) say which
  // browser they run in and report their own errors, so a problem inside
  // vMix shows up in this Terminal and on the Operator page
  ws.on('message', (data) => {
    if (type !== 'projection' || data.length > 4000) return;
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    if (msg.action === 'CLIENT_INFO') {
      ws.info = describeScreen(msg, req);
      console.log(`[Screen] ${ws.info.where}: ${ws.info.browser}, ${ws.info.size}${ws.info.overlay ? ', overlay' : ''}${ws.info.webgl ? '' : ', no WebGL'}`);
    } else if (msg.action === 'CLIENT_ERROR' && typeof msg.message === 'string') {
      const where = ws.info ? `${ws.info.where} (${ws.info.browser})` : 'projection page';
      console.error(`[Screen] Error on ${where}: ${msg.message}`);
      ws.errors = (ws.errors || 0) + 1;
      if (ws.errors <= 3) alertOperator({ action: 'NOTICE', message: `Screen problem on ${where}: ${msg.message.slice(0, 160)}` });
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected: ${type} (total: ${clients.size})`);
  });

  ws.on('error', (err) => {
    console.error(`[WS] Error on ${type}:`, err.message);
  });
});

// Connections that vanished without closing (Wi-Fi drop, sleeping phone)
// are found and removed every 30 s instead of piling up over a long service
setInterval(() => {
  clients.forEach(ws => {
    if (!ws.isAlive) { clients.delete(ws); return ws.terminate(); }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  });
}, 30000).unref();

function describeScreen(msg, req) {
  const ua = String(msg.ua || '');
  const chrome = (ua.match(/Chrome\/(\d+)/) || [])[1];
  const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const local = ip === '127.0.0.1' || ip === '::1';
  return {
    where: (/vMix/i.test(ua) ? 'vMix' : msg.overlay ? 'overlay' : 'projector') + (local ? ' on this Mac' : ` at ${ip}`),
    browser: chrome ? `Chrome ${chrome}` : (ua.slice(0, 60) || 'unknown browser'),
    size: `${parseInt(msg.width) || 0}×${parseInt(msg.height) || 0}`,
    overlay: Boolean(msg.overlay),
    webgl: Boolean(msg.webgl),
    chrome: chrome ? parseInt(chrome) : null,
  };
}

function staleMessage(ws) {
  const local = ws.ip === '127.0.0.1' || ws.ip === '::1';
  return `A screen ${local ? 'on this Mac' : 'at ' + ws.ip} is still showing an OLD Di.Verse page (old layouts, "1/6" pages). ` +
    (local ? 'Press Cmd + R in that tab.' : `In vMix, open the Di.Verse input's settings and set its URL to http://${IP}:${PORT}/projection?overlay=1&v=${VERSION}`);
}

// Tell vMix to reload its Di.Verse Web Browser inputs (needs VMIX_URL).
// At most once a minute.
let lastVmixReload = 0;
function reloadVmixScreens(why) {
  const v = require('./services/vmix');
  if (!v.configured() || Date.now() - lastVmixReload < 60000) return;
  lastVmixReload = Date.now();
  v.reloadBrowsers([IP, `:${PORT}`, '/projection']).then(done => {
    if (done.length) console.log(`[vMix] Reloaded ${done.join(', ')} (${why})`);
  }).catch(err => console.error('[vMix] reload failed:', err.message));
}

function connectedScreens() {
  return [...clients].filter(c => c.clientType === 'projection' && c.info).map(c => ({ ...c.info, errors: c.errors || 0 }));
}

const vmix = require('./services/vmix');

function broadcast(payload) {
  rememberScreen(payload);
  vmix.onScreen(payload, message => alertOperator({ action: 'NOTICE', message }), () => screenState);
  const message = JSON.stringify(payload);
  clients.forEach(client => {
    if (client.readyState === 1 && client.clientType !== 'operator') {
      client.send(message);
    }
  });
}

function alertOperator(payload) {
  const message = JSON.stringify(payload);
  clients.forEach(client => {
    if (client.readyState === 1 && client.clientType === 'operator') {
      client.send(message);
    }
  });
}

// AI translation wording confirmed after the live answer: offer it in the queue
require('./services/bibleDb').events.on('lateVerse', verse => alertOperator({ action: 'LATE_VERSE', verse }));

app.locals.broadcast = broadcast;
app.locals.alertOperator = alertOperator;
app.locals.clients = clients;

// ── Get local IP ──
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

// ── Start ──
const PORT = process.env.PORT || 3000;
const IP = getLocalIP();

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n========================================');
  console.log('  Di.Verse — The Word, on cue.   v' + VERSION);
  console.log('========================================\n');
  console.log(`  Operator:   http://localhost:${PORT}/operator`);
  console.log(`  Projection: http://${IP}:${PORT}/projection`);
  console.log(`  Preacher:   http://${IP}:${PORT}/preacher`);
  console.log(`  Admin:      http://localhost:${PORT}/admin`);
  console.log('\n  Share Projection + Preacher URLs with other devices.');
  console.log('========================================\n');

  // Tests and headless runs set DIVERSE_NO_BROWSER so no Chrome tabs pop up
  if (process.env.DIVERSE_NO_BROWSER) return;
  // An Operator tab still open from before reconnects (and reloads itself
  // to this version) within a few seconds; open a new one only if none does
  setTimeout(() => {
    if ([...clients].some(c => c.clientType === 'operator' && c.readyState === 1)) {
      console.log('  Operator page already open in Chrome — it has reconnected.\n');
      return;
    }
    const { exec } = require('child_process');
    const cmd = process.platform === 'darwin'
      ? `open -a "Google Chrome" http://localhost:${PORT}/operator`
      : `start chrome http://localhost:${PORT}/operator`;
    exec(cmd);
  }, 4000);
});
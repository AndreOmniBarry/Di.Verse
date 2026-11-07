require('dotenv').config({ quiet: true }); // the only place .env is loaded for the app
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ──
app.use('/api', require('./routes/bible'));
app.use('/api', require('./routes/songs'));
app.use('/api', require('./routes/transcribe'));
app.use('/api', require('./routes/detect'));
app.use('/api', require('./routes/push'));

// ── Views ──
app.get('/', (req, res) => res.redirect('/operator'));
app.get('/operator', (req, res) => res.sendFile(path.join(__dirname, 'public/operator/index.html')));
app.get('/projection', (req, res) => res.sendFile(path.join(__dirname, 'public/projection/index.html')));
app.get('/preacher', (req, res) => res.sendFile(path.join(__dirname, 'public/preacher/index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin/index.html')));
app.get('/about', (req, res) => res.sendFile(path.join(__dirname, 'public/about/index.html')));

// ── WebSocket ──
const clients = new Set();

wss.on('connection', (ws, req) => {
  const type = new URL(req.url, 'http://localhost').searchParams.get('type') || 'unknown';
  ws.clientType = type;
  clients.add(ws);
  console.log(`[WS] Client connected: ${type} (total: ${clients.size})`);

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected: ${type} (total: ${clients.size})`);
  });

  ws.on('error', (err) => {
    console.error(`[WS] Error on ${type}:`, err.message);
  });
});

function broadcast(payload) {
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
  console.log('  Di.Verse — The Word, on cue.');
  console.log('========================================\n');
  console.log(`  Operator:   http://localhost:${PORT}/operator`);
  console.log(`  Projection: http://${IP}:${PORT}/projection`);
  console.log(`  Preacher:   http://${IP}:${PORT}/preacher`);
  console.log(`  Admin:      http://localhost:${PORT}/admin`);
  console.log('\n  Share Projection + Preacher URLs with other devices.');
  console.log('========================================\n');

  // Tests and headless runs set DIVERSE_NO_BROWSER so no Chrome tabs pop up
  if (process.env.DIVERSE_NO_BROWSER) return;
  const { exec } = require('child_process');
  const cmd = process.platform === 'darwin'
    ? `open -a "Google Chrome" http://localhost:${PORT}/operator`
    : `start chrome http://localhost:${PORT}/operator`;
  exec(cmd);
});
// Keeps Di.Verse running for a whole service: restarts the server within a
// second if it ever stops unexpectedly, and on a Mac keeps the computer from
// sleeping while it runs. `npm start` uses this; Ctrl + C stops everything.
const { spawn } = require('child_process');
const path = require('path');

const SERVER = path.join(__dirname, '..', 'server.js');
let child = null;
let stopping = false;
let restarts = [];

// macOS: no display/system sleep while Di.Verse runs (ends with this process)
if (process.platform === 'darwin') {
  const c = spawn('caffeinate', ['-dims', '-w', String(process.pid)], { stdio: 'ignore' });
  c.on('error', () => {});
  c.unref();
}

function start(first) {
  // Only the first start opens Chrome; restarts reconnect the open pages
  const env = first ? process.env : { ...process.env, DIVERSE_NO_BROWSER: '1' };
  child = spawn(process.execPath, [SERVER], { stdio: 'inherit', env });
  child.on('exit', (code, signal) => {
    if (stopping || signal === 'SIGINT' || signal === 'SIGTERM') return process.exit(0);
    const now = Date.now();
    restarts = restarts.filter(t => now - t < 60000).concat(now);
    // A port clash or broken install would loop forever; give up and say why
    if (restarts.length > 5) {
      console.error('\n[Di.Verse] The server stopped 6 times in a minute — not restarting. Check the error above (port 3000 in use? run npm ci?).');
      return process.exit(1);
    }
    console.error(`\n[Di.Verse] Server stopped (code ${code}) — restarting in 1 second. Screens will reconnect by themselves.\n`);
    setTimeout(() => start(false), 1000);
  });
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { stopping = true; if (child) child.kill(sig); setTimeout(() => process.exit(0), 3000).unref(); });
}

start(true);

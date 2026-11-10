// Keeps Di.Verse running for a whole service: restarts the server within a
// second if it ever stops unexpectedly, and keeps the computer (and its
// screen) from sleeping while it runs, on Mac and Windows. `npm start` and
// the Di.Verse apps use this; Ctrl + C (or Settings → Stop) stops everything.
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

// Windows: the same, through SetThreadExecutionState (system + display
// required) held by a hidden PowerShell that ends when this process ends
if (process.platform === 'win32') {
  const script = [
    "$t = Add-Type -Name Power -Namespace DiVerse -PassThru -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f);'",
    '[void]$t::SetThreadExecutionState(0x80000003)', // ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
    `Wait-Process -Id ${process.pid} -ErrorAction SilentlyContinue`,
  ].join('; ');
  const w = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { stdio: 'ignore', windowsHide: true });
  w.on('error', () => {});
  w.unref();
}

function start(first) {
  // Only the first start opens Chrome; restarts reconnect the open pages
  const env = { ...process.env, DIVERSE_SUPERVISED: '1', ...(first ? {} : { DIVERSE_NO_BROWSER: '1' }) };
  child = spawn(process.execPath, [SERVER], { stdio: 'inherit', env });
  child.on('exit', (code, signal) => {
    if (stopping || signal === 'SIGINT' || signal === 'SIGTERM' || code === 64) return process.exit(0); // 64: "Stop Di.Verse" from the app
    if (code === 65) return setTimeout(() => start(false), 300); // 65: restart to apply new settings
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

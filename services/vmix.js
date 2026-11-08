// Optional link to vMix for Squeeze mode (vMix: Settings → Web Controller,
// port 8088). Set VMIX_URL=http://<vmix-pc>:8088 in .env.
//
// Automatic (default): when a verse or slide goes up in Squeeze mode, the
// camera that is live in Program is zoomed and moved by vMix itself so it
// sits exactly in Di.Verse's window; Clear (or another mode) puts it back to
// full screen. Nothing to build in vMix. Uses SetZoom / SetPanX / SetPanY
// (vMix 24+): zoom 1 = 100%; pan 0 = centred, ±2 = moved by a full frame
// (PanX: + is right; PanY: + is up).
//
// Scene (alternative): if VMIX_SQUEEZE_INPUT names an input (e.g. a scene
// with the camera already shrunk in a layer), vMix fades to it instead and
// back to the previous input afterwards.
//
// Window geometry must match public/projection/index.html (.sq-window):
// left 3% and top 5% of the frame, size = the Camera setting (% of frame).
const WINDOW_LEFT = 0.03;
const WINDOW_TOP = 0.05;

let squeezed = false;
let squeezedInput = null;   // input number we shrank (automatic) or left (scene)
let chain = Promise.resolve();
let warnedUnset = false;

function base() { return String(process.env.VMIX_URL || '').replace(/\/+$/, ''); }
function configured() { return Boolean(base()); }
function sceneMode() { return Boolean(process.env.VMIX_SQUEEZE_INPUT); }

async function api(query) {
  const res = await fetch(`${base()}/api/?${query}`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`vMix answered HTTP ${res.status}`);
  return res.text();
}

// vMix state: which input is live, and the list of inputs
async function state() {
  const xml = await api('');
  const active = (xml.match(/<active>(\d+)<\/active>/) || [])[1] || null;
  const inputs = [...xml.matchAll(/<input\b[^>]*\bnumber="(\d+)"[^>]*\btitle="([^"]*)"/g)].map(m => ({ number: m[1], title: m[2] }));
  return { active, inputs };
}

function call(fn, input, value) {
  return api(`Function=${encodeURIComponent(fn)}&Input=${encodeURIComponent(input)}` + (value !== undefined ? `&Value=${encodeURIComponent(value)}` : ''));
}

function transition(input) {
  const fn = process.env.VMIX_TRANSITION || 'Fade';
  const ms = parseInt(process.env.VMIX_DURATION) || 500;
  return api(`Function=${encodeURIComponent(fn)}&Input=${encodeURIComponent(input)}&Duration=${ms}`);
}

// Zoom and pan that put the full camera picture exactly into the window
function windowPosition(cameraPercent) {
  const z = Math.min(0.5, Math.max(0.15, (parseFloat(cameraPercent) || 20) / 100));
  const shiftRight = WINDOW_LEFT + z / 2 - 0.5; // as a share of the frame width
  const shiftDown = WINDOW_TOP + z / 2 - 0.5;   // as a share of the frame height
  const r = n => Math.round(n * 10000) / 10000;
  return { zoom: r(z), panX: r(shiftRight * 2), panY: r(-shiftDown * 2) };
}

async function shrink(input, cameraPercent) {
  const p = windowPosition(cameraPercent);
  await call('SetZoom', input, p.zoom);
  await call('SetPanX', input, p.panX);
  await call('SetPanY', input, p.panY);
}

async function restore(input) {
  await call('SetZoom', input, 1);
  await call('SetPanX', input, 0);
  await call('SetPanY', input, 0);
}

function modeOf(payload) {
  const item = payload.verse || payload.lyrics;
  return item && item.displayMode;
}

// Called for every screen change. notify(message) tells the operator;
// screen() returns the current screen state (for the Camera size setting).
function onScreen(payload, notify, screen) {
  const showing = payload.action === 'SHOW_VERSE' || payload.action === 'SHOW_LYRICS';
  if (!configured()) {
    if (showing && modeOf(payload) === 'squeeze' && !warnedUnset) {
      warnedUnset = true;
      notify('Squeeze is drawn, but vMix won\'t shrink the camera until VMIX_URL is set in .env (see SETUP.md, "Automatic squeeze")');
    }
    return;
  }
  const cameraPercent = () => ((screen && screen().background) || {}).camera || 20;
  const wantSqueeze = showing && modeOf(payload) === 'squeeze';
  const resize = payload.action === 'APPLY_BACKGROUND' && squeezed && !sceneMode();
  if (!showing && payload.action !== 'CLEAR' && !resize) return;

  chain = chain.then(async () => {
    try {
      if (resize) {
        await shrink(squeezedInput, payload.camera || cameraPercent()); // Camera size changed while squeezed
      } else if (wantSqueeze && !squeezed) {
        const { active } = await state();
        squeezedInput = active;
        if (sceneMode()) await transition(process.env.VMIX_SQUEEZE_INPUT);
        else await shrink(active, cameraPercent());
        squeezed = true;
      } else if (!wantSqueeze && squeezed) {
        if (sceneMode()) await transition(squeezedInput || process.env.VMIX_CAMERA_INPUT || '1');
        else await restore(squeezedInput);
        squeezed = false;
      }
    } catch (err) {
      console.error('[vMix]', err.message);
      notify(`vMix didn't respond (${err.name === 'TimeoutError' ? 'timed out' : err.message}) — check VMIX_URL and that vMix's Web Controller is on`);
    }
  });
}

module.exports = { onScreen, state, configured, sceneMode, windowPosition, _reset: () => { warnedUnset = false; squeezed = false; squeezedInput = null; chain = Promise.resolve(); } };

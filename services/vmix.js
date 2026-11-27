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
let squeezedMode = null;    // squeeze, split-left or split-right
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
  return placement(WINDOW_LEFT, WINDOW_TOP, z);
}
function placement(left, top, z) {
  const shiftRight = left + z / 2 - 0.5; // as a share of the frame width
  const shiftDown = top + z / 2 - 0.5;   // as a share of the frame height
  const r = n => Math.round(n * 10000) / 10000 || 0; // never -0
  return { zoom: r(z), panX: r(shiftRight * 2), panY: r(-shiftDown * 2) };
}

// Split screen (virtual set): a large camera window, vertically centred, on the
// side opposite the scripture. Must match public/projection/index.html
// (html[data-split] .sq-window): margin 2.5%, size = split ratio - 4%, min 30%.
const SPLIT_MARGIN = 0.025;
function splitSize(splitRatio) { return Math.max(0.3, (Number(splitRatio) || 50) / 100 - 0.04); }
function splitGeometry(mode, splitRatio) {
  const z = splitSize(splitRatio);
  const left = mode === 'split-left' ? 1 - SPLIT_MARGIN - z : SPLIT_MARGIN; // split-left: scripture left, camera right
  return placement(left, (1 - z) / 2, z);
}

const WINDOWED = ['squeeze', 'split-left', 'split-right'];

async function shrink(input, cameraPercent, p = windowPosition(cameraPercent)) {
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
  // a reference note is a lower third: the camera goes back to full size for it
  const showing = payload.action === 'SHOW_VERSE' || payload.action === 'SHOW_LYRICS' || payload.action === 'SHOW_REFERENCE';
  if (!configured()) {
    if (showing && WINDOWED.includes(modeOf(payload)) && !warnedUnset) {
      warnedUnset = true;
      notify('Squeeze is drawn, but vMix won\'t shrink the camera until VMIX_URL is set in .env (see SETUP.md, "Automatic squeeze")');
    }
    return;
  }
  const cameraPercent = () => ((screen && screen().background) || {}).camera || 20;
  const mode = modeOf(payload);
  const wantSqueeze = showing && WINDOWED.includes(mode);
  // the camera window for this mode: squeeze follows the Camera size setting,
  // split modes follow the live virtual-set profile's split ratio
  const geometry = m => {
    if (m === 'split-left' || m === 'split-right') {
      const live = (screen && screen().profile) || {};
      return splitGeometry(m, ((live.profile || {}).settings || {}).splitRatio);
    }
    return windowPosition(cameraPercent());
  };
  const resize = payload.action === 'APPLY_BACKGROUND' && squeezed && squeezedMode === 'squeeze' && !sceneMode();
  const reshape = payload.action === 'APPLY_PROFILE' && squeezed && squeezedMode !== 'squeeze' && !sceneMode();
  if (!showing && payload.action !== 'CLEAR' && !resize && !reshape) return;

  chain = chain.then(async () => {
    try {
      if (resize) {
        await shrink(squeezedInput, payload.camera || cameraPercent()); // Camera size changed while squeezed
      } else if (reshape) {
        // split ratio changed while split: screen() already holds the new profile
        const s = ((payload.profile || {}).settings || {}).splitRatio;
        await shrink(squeezedInput, null, splitGeometry(squeezedMode, s));
      } else if (wantSqueeze && !squeezed) {
        const { active } = await state();
        squeezedInput = active;
        if (sceneMode()) await transition(process.env.VMIX_SQUEEZE_INPUT);
        else await shrink(active, null, geometry(mode));
        squeezed = true;
        squeezedMode = mode;
      } else if (wantSqueeze && squeezed && mode !== squeezedMode) {
        // squeeze <-> split: move the window without restoring first
        if (!sceneMode()) await shrink(squeezedInput, null, geometry(mode));
        squeezedMode = mode;
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

// Reload vMix's Web Browser inputs that show Di.Verse (matched by their
// title or address containing any of `marks`). vMix: BrowserReload.
async function reloadBrowsers(marks) {
  const xml = await api('');
  const done = [];
  const re = /<input\b([^>]*)>([^<]*)<\/input>|<input\b([^>]*)\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[1] || m[3] || '', body = m[2] || '';
    if (!/\btype="Browser"/i.test(attrs)) continue;
    const number = (attrs.match(/\bnumber="(\d+)"/) || [])[1];
    const title = (attrs.match(/\btitle="([^"]*)"/) || [])[1] || '';
    if (!number || !marks.some(k => k && (title.includes(k) || body.includes(k)))) continue;
    await call('BrowserReload', number);
    done.push(`input ${number} "${title}"`);
  }
  return done;
}

module.exports = { onScreen, state, reloadBrowsers, configured, sceneMode, windowPosition, splitGeometry, _reset: () => { warnedUnset = false; squeezed = false; squeezedInput = null; squeezedMode = null; chain = Promise.resolve(); } };

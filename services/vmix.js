// Optional link to vMix for the squeeze-back. When a verse or slide is shown
// in Squeeze mode, vMix is switched to the squeeze scene (the camera shrunk
// into Di.Verse's window); when it's cleared or shown another way, vMix goes
// back to whatever input was live before. Uses vMix's built-in web API
// (vMix: Settings → Web Controller, port 8088).
//
//   VMIX_URL=http://192.168.0.120:8088
//   VMIX_SQUEEZE_INPUT=Di.Verse Squeeze      (input name or number)
//   VMIX_TRANSITION=Fade  VMIX_DURATION=500  (optional)

let squeezed = false;
let squeezedFrom = null; // input number that was live before the squeeze
let chain = Promise.resolve();

function base() { return String(process.env.VMIX_URL || '').replace(/\/+$/, ''); }
function configured() { return Boolean(base() && process.env.VMIX_SQUEEZE_INPUT); }

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

function transition(input) {
  const fn = process.env.VMIX_TRANSITION || 'Fade';
  const ms = parseInt(process.env.VMIX_DURATION) || 500;
  return api(`Function=${encodeURIComponent(fn)}&Input=${encodeURIComponent(input)}&Duration=${ms}`);
}

function modeOf(payload) {
  const item = payload.verse || payload.lyrics;
  return item && item.displayMode;
}

// Called for every screen change. notify(message) tells the operator.
function onScreen(payload, notify) {
  if (!configured()) return;
  const showing = payload.action === 'SHOW_VERSE' || payload.action === 'SHOW_LYRICS';
  if (!showing && payload.action !== 'CLEAR') return;
  const wantSqueeze = showing && modeOf(payload) === 'squeeze';
  // One vMix change at a time, in order
  chain = chain.then(async () => {
    try {
      if (wantSqueeze && !squeezed) {
        const { active } = await state();
        squeezedFrom = active;
        await transition(process.env.VMIX_SQUEEZE_INPUT);
        squeezed = true;
      } else if (!wantSqueeze && squeezed) {
        await transition(squeezedFrom || process.env.VMIX_CAMERA_INPUT || '1');
        squeezed = false;
      }
    } catch (err) {
      console.error('[vMix]', err.message);
      notify(`vMix didn't respond (${err.name === 'TimeoutError' ? 'timed out' : err.message}) — check VMIX_URL and that vMix's Web Controller is on`);
    }
  });
}

module.exports = { onScreen, state, configured, _reset: () => { squeezed = false; squeezedFrom = null; chain = Promise.resolve(); } };

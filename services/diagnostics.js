// Self-diagnosis: how well listening worked this service, and what to fix next.
//
// Recorded on the computer running Di.Verse (not the browser that listens),
// so it survives a restart of the other PC. Each day's events go to
// logs/sessions/YYYY-MM-DD.jsonl in the data folder; the report is built from
// today's file. Nothing leaves the computer unless the operator exports it.
//
// Events:
//   heard   — a finished sentence from listening { text, via }
//   found   — a verse found in what was heard { ref, source }
//   missed  — a sentence that clearly names a book + number, but no verse came of it { text }
//   cue     — "next verse", "take it back"… acted on { cue, ref }
//   nearest — a reference that doesn't exist (misheard number) { said }
//   pushed  — a verse put on screen { ref, why: auto | cue | queue | step | manual, listening }
//   cleared — the screen cleared { afterAutoMs } (soon after an automatic push = a false alarm)
//   audio   — once a minute from the listening page { okSec, whisperSec, speechSec, rebuilds, level }
const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const DIR = path.join(paths.LOG_DIR, 'sessions');
const MAX_LINES = 50000; // a very long day still stays a small file
let lines = 0, day = null, lastAuto = null;

function file(d) { return path.join(DIR, d + '.jsonl'); }
function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

const lastFound = new Map(); // the same verse heard mid-sentence and again finished counts once
function record(kind, data = {}) {
  try {
    if (kind === 'found') {
      const before = lastFound.get(data.ref);
      lastFound.set(data.ref, Date.now());
      if (before && Date.now() - before < 30000) return;
      if (lastFound.size > 200) lastFound.clear();
    }
    const d = today();
    if (d !== day) { day = d; fs.mkdirSync(DIR, { recursive: true }); lines = fs.existsSync(file(d)) ? fs.readFileSync(file(d), 'utf8').split('\n').length : 0; }
    if (lines++ > MAX_LINES) return;
    if (kind === 'pushed' && data.why === 'auto') lastAuto = Date.now();
    if (kind === 'cleared' && lastAuto) data.afterAutoMs = Date.now() - lastAuto;
    fs.appendFileSync(file(d), JSON.stringify({ t: Date.now(), kind, ...data }) + '\n');
  } catch (e) { /* diagnostics must never get in the way of the service */ }
}

function load(d = today()) {
  try {
    return fs.readFileSync(file(d), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) { return []; }
}

function days() {
  try { return fs.readdirSync(DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).map(f => f.slice(0, 10)).sort().reverse(); } catch (e) { return []; }
}

const pct = (a, b) => b ? Math.round(a / b * 100) : null;

// The report for one day: numbers, examples and plain-words advice
function report(d = today()) {
  const ev = load(d);
  const of = k => ev.filter(e => e.kind === k);
  const pushes = of('pushed');
  const fromSpeech = pushes.filter(p => ['auto', 'cue'].includes(p.why) || (p.why === 'queue' && p.detected));
  const rescues = pushes.filter(p => p.why === 'manual' && p.listening);
  const falseAlarms = of('cleared').filter(c => c.afterAutoMs != null && c.afterAutoMs < 5000);
  const missed = of('missed');
  const nearest = of('nearest');
  const heard = of('heard');
  const audio = of('audio');
  const sum = k => audio.reduce((a, x) => a + (x[k] || 0), 0);
  const okSec = sum('okSec'), whisperSec = sum('whisperSec'), speechSec = sum('speechSec'), rebuilds = sum('rebuilds');
  const levels = audio.filter(a => a.level != null).map(a => a.level);
  const level = levels.length ? levels.reduce((a, b) => a + b, 0) / levels.length : null;
  const minutes = audio.length;
  const shortSentences = heard.filter(h => (h.words || 0) <= 3).length;

  const success = pct(fromSpeech.length, fromSpeech.length + rescues.length);
  const advice = [];
  if (!heard.length && !pushes.length) advice.push('Nothing recorded yet today — the report fills in while Di.Verse listens.');
  if (level != null && level < 0.02) advice.push(`The mic level was low (average ${Math.round(level * 1000) / 10} %). Raise the gain on the Focusrite, or the send from the sound desk, so the level bar sits around half while the preacher speaks.`);
  if (minutes >= 3 && pct(whisperSec, okSec + whisperSec) > 30) advice.push(`Chrome's live captions were struggling ${pct(whisperSec, okSec + whisperSec)} % of the time, so Whisper had to cover (slower). Usually the sound: a preacher-only feed without music, with Windows "audio enhancements" off.`);
  if (minutes >= 10 && rebuilds / (minutes / 60) > 6) advice.push(`Live captions had to be restarted ${rebuilds} times. They depend on Google's servers: check the internet connection at the listening computer.`);
  if (heard.length >= 20 && pct(shortSentences, heard.length) > 40) advice.push(`${pct(shortSentences, heard.length)} % of the sentences heard were only 1–3 words — sound reaching the computer in bits. Check the level and that nothing in between (noise gate, Windows enhancements) cuts the voice.`);
  if (missed.length) advice.push(`${missed.length} sentence(s) named a book and a number but no verse came up. They're listed below word for word — send them with the export so the next version understands them.`);
  if (rescues.length && success != null && success < 90) advice.push(`${rescues.length} verse(s) had to be typed while listening. Compare them with the "missed" list and the heard sentences around the same time to see whether the words were heard wrong (sound) or heard right but not recognised (Di.Verse).`);
  if (nearest.length >= 3) advice.push(`${nearest.length} references named verses that don't exist (e.g. "${nearest[0].said}") — numbers misheard. A clearer feed helps; the closest real verses were offered each time.`);
  if (falseAlarms.length) advice.push(`${falseAlarms.length} verse(s) were cleared within 5 seconds of going up on their own — possible false alarms. The report lists them; if it keeps happening, turn Auto-push off and push from the queue.`);
  if (!advice.length) advice.push('Everything looked healthy. 🙌');

  return {
    day: d, days: days(),
    numbers: {
      successRate: success,                      // % of verses on screen that came from speech, not typing
      fromSpeech: fromSpeech.length, typedWhileListening: rescues.length,
      found: of('found').length, cues: of('cue').length, missed: missed.length, nearest: nearest.length, falseAlarms: falseAlarms.length,
      sentencesHeard: heard.length, listeningMinutes: minutes,
      captionsWorking: pct(okSec, okSec + whisperSec), whisperCovering: pct(whisperSec, okSec + whisperSec),
      captionRebuilds: rebuilds, micLevel: level == null ? null : Math.round(level * 1000) / 10, speechMinutes: Math.round(speechSec / 60),
    },
    advice,
    examples: {
      missed: missed.slice(-15).map(m => ({ t: m.t, text: m.text })),
      typed: rescues.slice(-15).map(r => ({ t: r.t, ref: r.ref })),
      falseAlarms: falseAlarms.slice(-10).map(c => {
        const p = pushes.filter(x => x.t <= c.t && x.why === 'auto').pop();
        return { t: c.t, ref: p && p.ref };
      }),
      nearest: nearest.slice(-10).map(n => ({ t: n.t, said: n.said })),
    },
  };
}

// Plain text to send to whoever improves Di.Verse: the report plus the day's
// sentences and what came of them
function exportText(d = today()) {
  const r = report(d);
  const time = t => new Date(t).toTimeString().slice(0, 8);
  const out = [`Di.Verse session report — ${d}`, ''];
  for (const [k, v] of Object.entries(r.numbers)) out.push(`${k}: ${v == null ? '—' : v}`);
  out.push('', 'What to look at:', ...r.advice.map(a => '• ' + a), '', 'Timeline:');
  for (const e of load(d)) {
    if (e.kind === 'audio') continue;
    const what = e.kind === 'heard' ? `heard (${e.via || '?'}): "${e.text}"` : e.kind === 'found' ? `found ${e.ref} [${e.source}]`
      : e.kind === 'missed' ? `MISSED: "${e.text}"` : e.kind === 'cue' ? `cue "${e.cue}" → ${e.ref}` : e.kind === 'nearest' ? `doesn't exist: ${e.said}`
      : e.kind === 'pushed' ? `on screen: ${e.ref} (${e.why})` : e.kind === 'cleared' ? 'cleared' : e.kind;
    out.push(`${time(e.t)}  ${what}`);
  }
  return out.join('\n');
}

module.exports = { record, report, exportText, days };

// Virtual set: presentation profiles (ministry branding, layout, background,
// palette, type, positioning, transitions) stored in presentation.db.
// A profile is edited and previewed on the Operator page, then taken live
// (APPLY_PROFILE to every screen). Settings are validated here so a bad value
// can never break the projection page or vMix output.
const store = require('./presentationDb');

const LAYOUTS = ['lower-third', 'squeeze', 'split-left', 'split-right', 'cinematic', 'full-screen'];
const BACKGROUNDS = ['theme', 'transparent', 'navy-gradient', 'graphite', 'parchment', 'cinematic-dark'];
const TRANSITIONS = ['fade', 'slide', 'none'];
const TYPEFACES = ['serif', 'sans'];

const DEFAULT_PALETTE = { base: '#0B1424', panel: '#121B2C', accent: '#C9A961', text: '#F4EFE4', muted: '#A3ABB9' };

const clamp = (n, lo, hi, d) => { n = Number(n); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const pick = (v, list, d) => (list.includes(v) ? v : d);
const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toUpperCase() : d);
const text = (v, max) => String(v == null ? '' : v).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

function sanitize(input = {}) {
  const p = input.palette || {}, pos = input.position || {}, m = input.ministry || {}, tr = input.transition || {};
  return {
    layout: pick(input.layout, LAYOUTS, 'lower-third'),
    background: pick(input.background, BACKGROUNDS, 'theme'),
    palette: { base: hex(p.base, DEFAULT_PALETTE.base), panel: hex(p.panel, DEFAULT_PALETTE.panel), accent: hex(p.accent, DEFAULT_PALETTE.accent),
      text: hex(p.text, DEFAULT_PALETTE.text), muted: hex(p.muted, DEFAULT_PALETTE.muted) },
    typeface: pick(input.typeface, TYPEFACES, 'serif'),
    textScale: clamp(input.textScale, 0.7, 1.6, 1),
    position: { x: clamp(pos.x, -20, 20, 0), y: clamp(pos.y, -20, 20, 0), width: clamp(pos.width, 40, 100, 90) },
    splitRatio: clamp(input.splitRatio, 35, 65, 50),
    ministry: { name: text(m.name, 60), tagline: text(m.tagline, 80), showBrand: Boolean(m.showBrand) },
    transition: { type: pick(tr.type, TRANSITIONS, 'fade'), ms: clamp(tr.ms, 0, 2000, 450) },
    safeArea: clamp(input.safeArea, 0, 10, 5),
  };
}

const SEEDS = [
  { name: 'Di.Verse Classic', settings: { layout: 'lower-third', background: 'theme', typeface: 'sans', transition: { type: 'fade', ms: 350 } } },
  { name: 'Teaching: Navy and Gold', settings: { layout: 'cinematic', background: 'navy-gradient', typeface: 'serif', textScale: 1.05,
    ministry: { name: '', tagline: '', showBrand: false }, transition: { type: 'fade', ms: 600 } } },
  { name: 'Livestream Overlay', settings: { layout: 'lower-third', background: 'transparent', typeface: 'serif', position: { x: 0, y: 0, width: 82 }, transition: { type: 'slide', ms: 450 } } },
  { name: 'Split: Preacher Left', settings: { layout: 'split-right', background: 'graphite', typeface: 'serif', splitRatio: 50 } },
];

function seed() {
  const d = store.getDb();
  if (d.prepare('SELECT COUNT(*) AS c FROM vset_profiles').get().c) return;
  const ins = d.prepare('INSERT INTO vset_profiles (name, settings, updated_at) VALUES (?, ?, ?)');
  d.transaction(() => { for (const s of SEEDS) ins.run(s.name, JSON.stringify(sanitize(s.settings)), store.now()); })();
}

const row = r => r && { id: r.id, name: r.name, settings: sanitize(store.safeJson(r.settings, {})), updatedAt: r.updated_at };

function list() { seed(); return store.getDb().prepare('SELECT * FROM vset_profiles ORDER BY id').all().map(row); }
function get(id) { seed(); return row(store.getDb().prepare('SELECT * FROM vset_profiles WHERE id = ?').get(id)); }
function liveId() { const v = store.getSetting('vset.live'); return v ? Number(v) : null; }
function live() { const id = liveId(); return id ? get(id) : null; }

function create(name, settings) {
  const n = text(name, 60);
  if (!n) throw new Error('A profile needs a name');
  const id = store.getDb().prepare('INSERT INTO vset_profiles (name, settings, updated_at) VALUES (?, ?, ?)').run(n, JSON.stringify(sanitize(settings)), store.now()).lastInsertRowid;
  return get(id);
}
function update(id, { name, settings }) {
  const p = get(id);
  if (!p) return null;
  const n = name != null ? text(name, 60) : p.name;
  if (!n) throw new Error('A profile needs a name');
  store.getDb().prepare('UPDATE vset_profiles SET name = ?, settings = ?, updated_at = ? WHERE id = ?').run(n, JSON.stringify(sanitize(settings || p.settings)), store.now(), id);
  return get(id);
}
function remove(id) {
  if (liveId() === Number(id)) throw new Error('This profile is live. Take another profile live first.');
  return store.getDb().prepare('DELETE FROM vset_profiles WHERE id = ?').run(id).changes > 0;
}
function setLive(id) {
  const p = get(id);
  if (!p) return null;
  store.setSetting('vset.live', p.id);
  return p;
}

module.exports = { sanitize, list, get, live, liveId, create, update, remove, setLive, LAYOUTS, BACKGROUNDS, TRANSITIONS };

// Sermon intelligence (services/sermonIntel.js), virtual-set profiles and the
// presentation store, on a disposable data folder.
const temp = require('./helpers/tempCopy');
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const sermon = require('../services/sermonIntel');
const store = require('../services/presentationDb');
const vset = require('../services/virtualSet');
const sqlite = require('../services/sqlite');

test.after(() => { store.closeDb(); temp.cleanup(); });

const one = text => sermon.detect(text, { lastPoint: 0, pendingHighlight: 0 }, 0);

test('titles are recognised from natural announcements', () => {
  for (const t of ["Today's sermon is titled walking in divine purpose", 'I want to talk to you this morning about the power of prayer',
    'We have titled this message: faith that moves mountains', 'The title of my message is grace for the journey']) {
    const f = one(t);
    assert.ok(f.length && f[0].kind === 'title', t + ' -> ' + JSON.stringify(f));
  }
});

test('numbered points, including spoken ordinals and "finally"', () => {
  const st = { lastPoint: 0, pendingHighlight: 0 };
  const seq = ['Point number one, God has a plan for your life', 'The second point is that prayer changes things',
    'Number three: obedience opens doors', 'Finally, love never fails'];
  const nums = seq.map(t => { const f = sermon.detect(t, st, 0); assert.ok(f.length && f[0].kind === 'point', t); return f[0].number; });
  assert.deepStrictEqual(nums, [1, 2, 3, 4]);
});

test('highlights: a cue with content, and a bare cue taking the next sentence', () => {
  const f = one('Write this down: delay is not denial');
  assert.strictEqual(f[0].kind, 'highlight');
  assert.match(f[0].phrase, /delay is not denial/i);
  const st = { lastPoint: 0, pendingHighlight: 0 };
  assert.strictEqual(sermon.detect('Write this down.', st, 1000).length, 0);
  const next = sermon.detect('Your season of waiting is a season of preparation', st, 5000);
  assert.strictEqual(next[0] && next[0].kind, 'highlight');
  const later = { lastPoint: 0, pendingHighlight: 0 };
  sermon.detect('Write this down.', later, 1000);
  assert.strictEqual(sermon.detect('Your season of waiting is a season of preparation', later, 60000).length, 0, 'the cue expires');
});

test('ordinary sermon talk is not a note', () => {
  for (const t of ['Jesus is number one in my life', 'God is good all the time', 'we will focus on the first point later', 'Turn with me to John chapter three'])
    assert.deepStrictEqual(one(t), [], t);
});

test('display wording only removes words, never adds or invents', () => {
  const heard = 'So church, listen, the point I am making is that basically God is really faithful to his promises';
  const out = sermon.conciseWording(heard);
  const words = new Set(heard.toLowerCase().match(/[a-z']+/g));
  for (const w of out.toLowerCase().match(/[a-z']+/g)) assert.ok(words.has(w), `"${w}" was not said`);
  assert.ok(out.length < heard.length);
});

test('references: spoken ones only, validated; numbering is never read as a book', () => {
  assert.deepStrictEqual(sermon.spokenRefs('Number three, obedience opens doors'), []);
  assert.deepStrictEqual(sermon.spokenRefs('as Hezekiah 4 12 says'), []);
  assert.deepStrictEqual(sermon.spokenRefs('as Romans 8 28 says').map(r => r.reference), ['Romans 8:28']);
  assert.deepStrictEqual(sermon.parseRefText('Romans 99:1'), [], 'a chapter that does not exist');
  assert.deepStrictEqual(sermon.parseRefText('romans 8:28-30').map(r => r.kind), ['manual']);
});

test('observe: suggestions keep the heard wording, attach context, and de-duplicate', () => {
  sermon.newSession();
  const screen = { action: 'SHOW_VERSE', verse: { reference: 'John 3:16', book: 'John', chapter: 3, verse: 16 } };
  const [title] = sermon.observe("Today's sermon is titled walking in divine purpose", { screen });
  assert.strictEqual(title.status, 'suggested');
  assert.strictEqual(title.original, "Today's sermon is titled walking in divine purpose");
  assert.deepStrictEqual(title.refs, [], 'a title does not take the verse on screen');
  const [point] = sermon.observe('Point number one, as Romans 8 28 says, all things work together', { screen });
  assert.deepStrictEqual(point.refs.map(r => [r.reference, r.kind]), [['Romans 8:28', 'spoken'], ['John 3:16', 'on-screen']]);
  assert.deepStrictEqual(sermon.observe('Point number one, as Romans 8 28 says, all things work together', { screen }), [], 'heard twice (captions and Whisper) is kept once');
  const [n3] = sermon.observe('Number three, obedience opens doors');
  assert.deepStrictEqual(n3.refs, [], 'never "Numbers 3"');
});

test('notes persist (a refresh or restart reads them back) in presentation.db only', () => {
  const session = sermon.newSession();
  const a = sermon.addNote({ kind: 'point', number: 1, original: 'Faith comes by hearing', source: 'manual', refs: sermon.parseRefText('Romans 10:17') });
  assert.strictEqual(a.status, 'approved', 'a note the operator adds is approved');
  sermon.updateNote(a.id, { display: 'Faith comes by hearing the word' });
  store.closeDb();                                            // as if the server restarted
  const back = sermon.notes(sermon.currentSession().id);
  assert.strictEqual(sermon.currentSession().id, session.id);
  assert.strictEqual(back[0].display, 'Faith comes by hearing the word');
  assert.strictEqual(back[0].original, 'Faith comes by hearing', 'the original is kept');
  assert.strictEqual(back[0].refs[0].reference, 'Romans 10:17');
  assert.strictEqual(store.schemaVersion(), 1);
  // the Bible database gained nothing
  const bible = sqlite.open(path.join(temp.dir, 'db', 'bible.db'));
  const tables = bible.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
  bible.close();
  for (const t of ['sermon_notes', 'sermon_sessions', 'vset_profiles', 'presentation_history']) assert.ok(!tables.includes(t), t + ' must not be in bible.db');
});

test('dismissed notes leave the list; deleting removes only the note', () => {
  sermon.newSession();
  const n = sermon.addNote({ kind: 'highlight', original: 'Delay is not denial', source: 'manual' });
  sermon.updateNote(n.id, { status: 'dismissed' });
  assert.ok(!sermon.notes(sermon.currentSession().id).some(x => x.id === n.id));
  assert.ok(sermon.deleteNote(n.id));
});

test('virtual-set profiles: seeded, validated, and the live one cannot be deleted', () => {
  const list = vset.list();
  assert.deepStrictEqual(list.map(p => p.name).slice(0, 4), ['Di.Verse Classic', 'Teaching: Navy and Gold', 'Livestream Overlay', 'Split: Preacher Left']);
  const s = vset.sanitize({ layout: 'nonsense', background: 'url(evil)', textScale: 9, position: { x: -99, y: 'a', width: 5 }, splitRatio: 90,
    palette: { accent: 'red', text: '#abcdef' }, ministry: { name: '<script>Grace</script> Church', showBrand: 1 }, transition: { type: 'spin', ms: 99999 }, safeArea: -3 });
  assert.strictEqual(s.layout, 'lower-third'); assert.strictEqual(s.background, 'theme');
  assert.strictEqual(s.textScale, 1.6); assert.deepStrictEqual(s.position, { x: -20, y: 0, width: 40 });
  assert.strictEqual(s.splitRatio, 65); assert.strictEqual(s.palette.accent, '#C9A961'); assert.strictEqual(s.palette.text, '#ABCDEF');
  assert.ok(!/[<>]/.test(s.ministry.name)); assert.strictEqual(s.ministry.showBrand, true);
  assert.deepStrictEqual(s.transition, { type: 'fade', ms: 2000 }); assert.strictEqual(s.safeArea, 0);
  const p = vset.create('Test profile', { layout: 'split-left' });
  vset.setLive(p.id);
  assert.strictEqual(vset.live().id, p.id);
  assert.throws(() => vset.remove(p.id), /live/);
  vset.setLive(list[0].id);
  assert.ok(vset.remove(p.id));
});

test('history keeps what went on screen, newest first', () => {
  store.recordHistory('scripture', 'John 3:16 KJV', { translation: 'KJV' });
  store.recordHistory('note', 'Point 1: Faith comes by hearing', {});
  const h = store.history(5);
  assert.strictEqual(h[0].label, 'Point 1: Faith comes by hearing');
  assert.strictEqual(h[1].detail.translation, 'KJV');
});

test('vMix: squeeze geometry unchanged; split windows match the projection page', () => {
  const vmix = require('../services/vmix');
  assert.deepStrictEqual(vmix.windowPosition(20), { zoom: 0.2, panX: -0.74, panY: 0.7 });
  assert.deepStrictEqual(vmix.splitGeometry('split-right', 50), { zoom: 0.46, panX: -0.49, panY: 0 });  // camera left
  assert.deepStrictEqual(vmix.splitGeometry('split-left', 50), { zoom: 0.46, panX: 0.49, panY: 0 });    // camera right
  assert.strictEqual(vmix.splitGeometry('split-left', 35).zoom, 0.31);
});

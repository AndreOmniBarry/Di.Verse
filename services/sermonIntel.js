// Sermon intelligence: titles, numbered points and highlights from what the
// preacher says, kept as sermon notes for the operator to edit, approve and
// show. Separate from scripture detection and navigation (routes/detect.js,
// services/navigation.js): it only reads finished sentences and never moves
// or replaces the scripture on screen.
//
// Rules:
//  - the original transcription is always kept; the display wording is an
//    optional shorter version made only by removing words (fillers, lead-ins),
//    never by adding or rephrasing, and the operator can edit it;
//  - scripture is attached only when it was said explicitly (and exists) or
//    was on screen at that moment; nothing is ever inferred or invented;
//  - speech only ever creates suggestions; the operator approves.
const store = require('./presentationDb');
const { parseAll } = require('./parser');
const { validateReference } = require('./validation');

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  firstly: 1, secondly: 2, thirdly: 3, fourthly: 4, fifthly: 5, sixthly: 6, seventhly: 7 };

const clean = t => String(t || '').replace(/\s+/g, ' ').trim();
const lead = '^(?:(?:so|now|and|okay|ok|alright|all right|well|listen|church|saints|brethren|beloved|friends)[,.!]?\\s+)*';

// ── display wording: shorter, same meaning, nothing added ──
const FILLERS = [
  /\b(?:um+|uh+|er+|ah+)\b[,.]?\s*/gi,
  /\byou know\b,?\s*/gi, /\bi mean\b,?\s*/gi, /\blike i said\b,?\s*/gi, /\bif you will\b,?\s*/gi,
  /\b(?:amen|hallelujah|praise god|glory to god)\b[?!.,]*\s*$/i,
  /^(?:(?:so|and|now|okay|ok|well|listen|look)[,.]?\s+)+/i,
  /^(?:i want (?:you )?to (?:tell|show|let) you (?:that|this)?|i want you to know that|let me tell you(?: this)?|i tell you(?: this)?|here is the thing|the thing is)[,:]?\s*/i,
  /^(?:is that|is this)\s+/i,
];
function conciseWording(text, maxWords = 16) {
  const original = clean(text);
  let t = original;
  for (const re of FILLERS) t = t.replace(re, '');
  t = t.replace(/\b(\w+)(?:\s+\1\b)+/gi, '$1').replace(/\s+([,.;:!?])/g, '$1').replace(/^[,.;:\s]+/, '').trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > maxWords) {
    // cut at a clause boundary inside the limit, never mid-thought where avoidable
    const head = words.slice(0, maxWords).join(' ');
    const cut = head.search(/[,;:][^,;:]*$/);
    t = cut > 20 ? head.slice(0, cut) : head;
  }
  t = t.replace(/[,;:\s]+$/, '');
  if (t.split(/\s+/).filter(Boolean).length < 2) return original;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with']);
function titleCase(t) {
  return clean(t).split(' ').map((w, i) => (i > 0 && SMALL.has(w.toLowerCase())) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ── detection ──
const TITLE_PATTERNS = [
  // "the title of my message today is ...", "today's sermon is titled ..."
  new RegExp(lead + "(?:the\\s+)?(?:title|topic|theme|subject)\\s+(?:of\\s+)?(?:my|our|this|the|today's|todays|this morning's|tonight's)?\\s*(?:message|sermon|teaching|word)?\\s*(?:today|this morning|tonight|this evening)?\\s*(?:is|will be)\\s*(?:titled|entitled|called)?\\s*[:,]?\\s*(.+)$", 'i'),
  new RegExp(lead + "(?:my|our|today's|todays|this morning's|tonight's|this evening's)\\s+(?:message|sermon|teaching|topic|theme)\\s+(?:today\\s+|this morning\\s+|tonight\\s+)?(?:is\\s+)?(?:titled|entitled|called|is)\\s*[:,]?\\s*(.+)$", 'i'),
  new RegExp(lead + "(?:i've|i have|we've|we have)\\s+(?:titled|entitled|called)\\s+(?:this|the|my|today's|todays)?\\s*(?:message|sermon|teaching)?\\s*[:,]?\\s*(.+)$", 'i'),
  new RegExp(lead + "i\\s+want\\s+to\\s+(?:speak|talk|preach|teach|minister)\\s+(?:to\\s+you\\s+|with\\s+you\\s+)?(?:today\\s+|this morning\\s+|tonight\\s+)?(?:on|about)\\s+(?:the\\s+(?:topic|subject|theme)\\s+)?[:,]?\\s*(.+)$", 'i'),
];
const POINT_PATTERNS = [
  // "point number two: ...", "the second point is ...", "my first point ..."
  new RegExp(lead + "(?:my\\s+|the\\s+|our\\s+)?point\\s+number\\s+(one|two|three|four|five|six|seven|eight|nine|ten|\\d{1,2})\\s*(?:is)?\\s*[:,.-]?\\s*(.+)$", 'i'),
  new RegExp(lead + "(?:my\\s+|the\\s+|our\\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|next|last|final)\\s+point\\s*(?:is|today)?\\s*[:,.-]?\\s*(.+)$", 'i'),
  new RegExp(lead + "number\\s+(one|two|three|four|five|six|seven|eight|nine|ten)\\s*[:,.-]\\s*(.+)$", 'i'),
  new RegExp(lead + "(firstly|secondly|thirdly|fourthly|fifthly|sixthly|seventhly|finally)\\s*[:,.-]?\\s+(.+)$", 'i'),
];
const HIGHLIGHT_CUES = new RegExp(lead + "(?:" + [
  'write (?:this|that|it) down', 'somebody (?:should )?write (?:this|that) down', 'take note(?: of this)?', 'note this', 'mark this', 'underline (?:this|that)',
  'here is the (?:key|point|truth|secret|principle)', "here's the (?:key|point|truth|secret|principle)", 'the key is', 'the point is', 'the bottom line is',
  'if you (?:remember|forget) nothing else', "don't (?:ever )?forget this", 'never forget this', 'listen to (?:this|me)', 'hear me', 'catch this',
].join('|') + ")\\s*[:,.!-]?\\s*(.*)$", 'i');

function numberOf(word, state) {
  const w = String(word || '').toLowerCase();
  if (/^\d+$/.test(w)) return parseInt(w, 10);
  if (NUMBER_WORDS[w]) return NUMBER_WORDS[w];
  if (ORDINALS[w]) return ORDINALS[w];
  if (w === 'next') return (state.lastPoint || 0) + 1;
  if (w === 'last' || w === 'final' || w === 'finally') return (state.lastPoint || 0) + 1;
  return null;
}

const enough = t => clean(t).split(' ').filter(w => /[a-z]/i.test(w)).length >= 2;

// state per session (in memory): last point number, a highlight waiting for its sentence
const states = new Map();
function stateFor(sessionId) { if (!states.has(sessionId)) states.set(sessionId, { lastPoint: 0, pendingHighlight: 0 }); return states.get(sessionId); }

// What a finished sentence contains: [{ kind, number?, original }]
function detect(text, state = { lastPoint: 0, pendingHighlight: 0 }, nowMs = Date.now()) {
  const sentence = clean(text).replace(/^["“]|["”]$/g, '');
  if (sentence.split(' ').length < 3) return [];
  const out = [];
  for (const re of TITLE_PATTERNS) {
    const m = sentence.match(re);
    if (m && enough(m[1])) { out.push({ kind: 'title', original: sentence, phrase: clean(m[1]).replace(/[.!?]+$/, '') }); return out; }
  }
  for (const re of POINT_PATTERNS) {
    const m = sentence.match(re);
    if (m && enough(m[2])) {
      const n = numberOf(m[1], state);
      if (n) { state.lastPoint = n; out.push({ kind: 'point', number: n, original: sentence, phrase: clean(m[2]) }); return out; }
    }
  }
  const h = sentence.match(HIGHLIGHT_CUES);
  if (h) {
    if (enough(h[1])) out.push({ kind: 'highlight', original: sentence, phrase: clean(h[1]) });
    else state.pendingHighlight = nowMs + 20000;              // "write this down." — the next sentence is the highlight
    return out;
  }
  if (state.pendingHighlight && nowMs <= state.pendingHighlight) {
    state.pendingHighlight = 0;
    out.push({ kind: 'highlight', original: sentence, phrase: sentence });
  }
  return out;
}

// ── scripture associations: said explicitly (and real), or on screen at the time ──
// Sermon numbering ("number three, ...", "point number 2:") is never the book
// of Numbers: it is removed first, unless digits follow as a chapter and verse.
const NUMBERING = /\b(?:point\s+)?number\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})\b(?!\s*(?:[:.]\s*)?\d)[,:.]?/gi;
function spokenRefs(text) {
  const refs = [];
  for (const r of parseAll(String(text || '').replace(NUMBERING, ' '), 'KJV')) {
    const v = validateReference(r.book, r.chapter, r.verse);
    if (!v.valid) continue;
    const book = v.normalised || r.book;
    refs.push({ reference: `${book} ${r.chapter}:${r.verse}${r.verseEnd > r.verse ? '-' + r.verseEnd : ''}`, book, chapter: r.chapter, verse: r.verse,
      ...(r.verseEnd > r.verse ? { verseEnd: r.verseEnd } : {}), kind: 'spoken' });
  }
  return refs;
}
function refFromScreen(screen) {
  const v = screen && screen.action === 'SHOW_VERSE' && screen.verse;
  if (!v || !v.book || !v.chapter || !v.verse) return null;
  return { reference: v.reference, book: v.book, chapter: v.chapter, verse: v.verse, ...(v.verseEnd ? { verseEnd: v.verseEnd } : {}), kind: 'on-screen' };
}
function parseRefText(text) {
  const refs = spokenRefs(text);
  return refs.map(r => ({ ...r, kind: 'manual' }));
}
const uniqueRefs = list => { const seen = new Set(); return list.filter(r => r && !seen.has(r.reference) && seen.add(r.reference)); };

// ── store ──
const rowToNote = r => r && ({ ...r, refs: store.safeJson(r.refs, []) });

function currentSession() {
  const d = store.getDb();
  let s = d.prepare('SELECT * FROM sermon_sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1').get();
  if (!s) { const id = d.prepare('INSERT INTO sermon_sessions (started_at) VALUES (?)').run(store.now()).lastInsertRowid; s = d.prepare('SELECT * FROM sermon_sessions WHERE id = ?').get(id); }
  return s;
}
function newSession(title) {
  const d = store.getDb();
  d.prepare('UPDATE sermon_sessions SET ended_at = ? WHERE ended_at IS NULL').run(store.now());
  const id = d.prepare('INSERT INTO sermon_sessions (title, started_at) VALUES (?, ?)').run(title ? clean(title).slice(0, 200) : null, store.now()).lastInsertRowid;
  states.delete(Number(id));
  return d.prepare('SELECT * FROM sermon_sessions WHERE id = ?').get(id);
}
function notes(sessionId) {
  return store.getDb().prepare("SELECT * FROM sermon_notes WHERE session_id = ? AND status != 'dismissed' ORDER BY id").all(sessionId).map(rowToNote);
}
function getNote(id) { return rowToNote(store.getDb().prepare('SELECT * FROM sermon_notes WHERE id = ?').get(id)); }

function addNote({ kind, number = null, original, display = null, source = 'manual', status, refs = [], heardAt = null, sessionId }) {
  if (!['title', 'point', 'highlight'].includes(kind)) throw new Error('kind must be title, point or highlight');
  const text = clean(original);
  if (!text) throw new Error('note text is required');
  const session = sessionId || currentSession().id;
  const t = store.now();
  const id = store.getDb().prepare(`INSERT INTO sermon_notes (session_id, kind, number, original, display, status, source, refs, heard_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(session, kind, number == null ? null : Number(number), text.slice(0, 1000), display == null ? null : clean(display).slice(0, 300),
      status || (source === 'manual' ? 'approved' : 'suggested'), source, JSON.stringify(uniqueRefs(refs)), heardAt, t, t).lastInsertRowid;
  if (kind === 'title' && (status === 'approved' || source === 'manual')) store.getDb().prepare('UPDATE sermon_sessions SET title = ? WHERE id = ?').run(clean(display || text).slice(0, 200), session);
  return getNote(id);
}

function updateNote(id, changes = {}) {
  const note = getNote(id);
  if (!note) return null;
  const next = {
    original: changes.original != null ? clean(changes.original).slice(0, 1000) : note.original,
    display: changes.display !== undefined ? (changes.display == null || clean(changes.display) === '' ? null : clean(changes.display).slice(0, 300)) : note.display,
    status: changes.status && ['suggested', 'approved', 'dismissed'].includes(changes.status) ? changes.status : note.status,
    number: changes.number !== undefined ? (changes.number == null || changes.number === '' ? null : Number(changes.number)) : note.number,
    kind: changes.kind && ['title', 'point', 'highlight'].includes(changes.kind) ? changes.kind : note.kind,
    refs: Array.isArray(changes.refs) ? uniqueRefs(changes.refs) : note.refs,
  };
  if (!next.original) throw new Error('note text cannot be empty');
  store.getDb().prepare('UPDATE sermon_notes SET original = ?, display = ?, status = ?, number = ?, kind = ?, refs = ?, updated_at = ? WHERE id = ?')
    .run(next.original, next.display, next.status, next.number, next.kind, JSON.stringify(next.refs), store.now(), id);
  if (next.kind === 'title' && next.status === 'approved') store.getDb().prepare('UPDATE sermon_sessions SET title = ? WHERE id = ?').run((next.display || next.original).slice(0, 200), note.session_id);
  return getNote(id);
}
function deleteNote(id) { return store.getDb().prepare('DELETE FROM sermon_notes WHERE id = ?').run(id).changes > 0; }
function markShown(id) { store.getDb().prepare('UPDATE sermon_notes SET shown_count = shown_count + 1, last_shown_at = ? WHERE id = ?').run(store.now(), id); return getNote(id); }

// A finished sentence from listening: new suggestions (duplicates of an
// existing note in this session are not added again)
function observe(text, { screen = null, heardAt = null, nowMs = Date.now() } = {}) {
  const session = currentSession();
  const state = stateFor(session.id);
  const found = detect(text, state, nowMs);
  if (!found.length) return [];
  const existing = notes(session.id);
  const norm = t => clean(t).toLowerCase().replace(/[^a-z0-9 ]/g, '');
  const created = [];
  for (const f of found) {
    const dup = existing.find(n => n.kind === f.kind && (norm(n.original) === norm(f.original) || (f.kind === 'point' && n.number === f.number && n.source === 'speech')
      || (f.kind === 'title' && n.kind === 'title' && n.status !== 'dismissed')));
    if (dup) continue;
    const onScreen = refFromScreen(screen);
    // only the content: "Number three, obedience opens doors" must never read as Numbers 3
    // the passage on screen is context for a point or highlight; a title is announced on its own
    const refs = uniqueRefs([...spokenRefs(f.phrase), ...(onScreen && f.kind !== 'title' ? [onScreen] : [])]);
    const display = f.kind === 'title' ? titleCase(conciseWording(f.phrase, 12)) : conciseWording(f.phrase);
    created.push(addNote({ kind: f.kind, number: f.number || null, original: f.original, display, source: 'speech', status: 'suggested', refs, heardAt, sessionId: session.id }));
  }
  return created;
}

module.exports = { detect, conciseWording, titleCase, spokenRefs, refFromScreen, parseRefText, observe, currentSession, newSession, notes, getNote, addNote, updateNote, deleteNote, markShown, _states: states };

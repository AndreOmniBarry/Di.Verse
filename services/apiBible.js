// API.Bible (American Bible Society) — licensed access to copyrighted
// translations such as NKJV, AMP, NIV, ESV, NLT, MSG. Needs APIBIBLE_KEY in
// .env. Commercial use requires a paid API.Bible plan, and some translations
// need a separate licence from their publisher (see AUDIT.md §7).
//
// Run `npm run check:apibible` with your key to see exactly which
// translations your plan unlocks and the raw response for one verse.
require('dotenv').config();

const BASE_URL = process.env.APIBIBLE_BASE_URL || 'https://rest.api.bible/v1';

// USFM book codes, in canonical order (book_num 1-66)
const USFM = [
  'GEN','EXO','LEV','NUM','DEU','JOS','JDG','RUT','1SA','2SA','1KI','2KI','1CH','2CH',
  'EZR','NEH','EST','JOB','PSA','PRO','ECC','SNG','ISA','JER','LAM','EZK','DAN','HOS',
  'JOL','AMO','OBA','JON','MIC','NAM','HAB','ZEP','HAG','ZEC','MAL',
  'MAT','MRK','LUK','JHN','ACT','ROM','1CO','2CO','GAL','EPH','PHP','COL','1TH','2TH',
  '1TI','2TI','TIT','PHM','HEB','JAS','1PE','2PE','1JN','2JN','3JN','JUD','REV',
];

let bibleIds = null;      // { NKJV: '<api.bible id>', ... }
let discoveryError = null;
let discovering = null;
const verseCache = new Map(); // in memory only — licensed text is never written to disk

function isConfigured() {
  return Boolean(process.env.APIBIBLE_KEY);
}

async function request(path) {
  const res = await fetch(BASE_URL + path, {
    headers: { 'api-key': process.env.APIBIBLE_KEY, accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`API.Bible HTTP ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function describeError(err) {
  if (err.status === 401) return 'API.Bible key is invalid — check APIBIBLE_KEY in .env';
  if (err.status === 403) return 'Your API.Bible plan does not include this translation';
  if (err.status === 429) return 'API.Bible call limit reached for this plan';
  if (err.status === 404) return 'API.Bible does not have this verse in this translation';
  if (!err.status) return 'Cannot reach API.Bible — check internet connection';
  return err.message;
}

// APIBIBLE_IDS=NKJV=63097d2a0a2f7db3-01,AMP=... pins exact Bible IDs;
// anything not pinned is matched by abbreviation from GET /bibles
function pinnedIds() {
  const out = {};
  for (const pair of (process.env.APIBIBLE_IDS || '').split(',')) {
    const [code, id] = pair.split('=').map(x => x && x.trim());
    if (code && id) out[code.toUpperCase()] = id;
  }
  return out;
}

function normaliseAbbr(abbr) {
  return String(abbr || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function discover() {
  if (!isConfigured()) return {};
  if (bibleIds) return bibleIds;
  if (!discovering) {
    discovering = (async () => {
      const ids = {};
      try {
        const { data } = await request('/bibles?language=eng');
        for (const b of data || []) {
          for (const abbr of [b.abbreviation, b.abbreviationLocal]) {
            const code = normaliseAbbr(abbr);
            if (code && !ids[code]) ids[code] = b.id;
          }
        }
        discoveryError = null;
      } catch (err) {
        discoveryError = describeError(err);
        console.error('[API.Bible] Discovery failed:', err.message);
      }
      bibleIds = Object.assign(ids, pinnedIds());
      if (Object.keys(bibleIds).length) console.log('[API.Bible] Translations available:', Object.keys(bibleIds).join(', '));
      discovering = null;
      // On failure, allow another attempt in a minute rather than never
      if (discoveryError) setTimeout(() => { bibleIds = null; }, 60000);
      return bibleIds;
    })();
  }
  return discovering;
}

function stripVerseText(content) {
  return String(content || '')
    .replace(/<[^>]+>/g, ' ')        // in case HTML comes back
    .replace(/^\s*\[?\d+\]?\s*/, '') // leading verse number, if any
    .replace(/¶/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Returns verse data, or { error } explaining why it couldn't
async function getVerse(bookNum, book, chapter, verse, translation) {
  if (!isConfigured()) return { error: `${translation} needs an API.Bible key (APIBIBLE_KEY in .env)` };
  const ids = await discover();
  const bibleId = ids[normaliseAbbr(translation)];
  if (!bibleId) {
    return { error: discoveryError || `${translation} is not available on your API.Bible plan` };
  }

  const verseId = `${USFM[bookNum - 1]}.${chapter}.${verse}`;
  const key = `${bibleId}:${verseId}`;
  if (verseCache.has(key)) return verseCache.get(key);

  try {
    const qs = 'content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=false&include-verse-spans=false';
    const json = await request(`/bibles/${bibleId}/verses/${verseId}?${qs}`);
    const data = json.data || {};
    const text = stripVerseText(data.content);
    if (!text) return { error: `API.Bible returned no text for ${book} ${chapter}:${verse} (${translation})` };
    const result = {
      reference: `${book} ${chapter}:${verse}`,
      translation,
      text,
      book,
      chapter,
      verse,
      source: 'apibible',
      copyright: data.copyright ? stripVerseText(data.copyright) : null,
      fumsId: json.meta && json.meta.fumsId || null,
    };
    verseCache.set(key, result);
    if (verseCache.size > 2000) verseCache.delete(verseCache.keys().next().value);
    return result;
  } catch (err) {
    console.error('[API.Bible] Verse fetch failed:', err.message);
    return { error: describeError(err) };
  }
}

async function availableCodes() {
  return Object.keys(await discover());
}

function status() {
  return { configured: isConfigured(), error: discoveryError };
}

module.exports = { getVerse, availableCodes, status, discover, request, USFM, _reset: () => { bibleIds = null; verseCache.clear(); } };

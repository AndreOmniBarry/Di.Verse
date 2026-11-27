// How preachers actually ask for an edition, against a 57-edition catalogue
// (test/fixtures/edition-names-57.json: codes and names only, no Bible text).
// Phrases are examples of intent families, not required command syntax:
//   translation-only for the current passage · put/show/have on screen ·
//   read/see this/the same passage in another edition · reference + edition ·
//   switch / back to KJV · word-order variants ("on TPT" as well as "in TPT").
// Plus the guards: sermon words (message, passion, voice, good news, web,
// amplified, living bible) never switch editions on their own.
const test = require('node:test');
const assert = require('node:assert');
const { detectTranslation, parseAll } = require('../services/parser');
const CAT = require('./fixtures/edition-names-57.json');

const heard = text => detectTranslation(text, CAT);

test('the owner\'s examples', () => {
  for (const [said, code] of [
    ['Can we have TLB on screen?', 'TLB'],
    ['Can we read this same passage on TPT?', 'TPT'],
    ["Let's see that in the Living Bible.", 'TLB'],
    ['Could you put the New Living Translation up?', 'NLT'],
    ['Can we have this passage in the Message?', 'MSG'],
    ["Let's go back to King James.", 'KJV'],
    ['Put the New Living Translation on screen.', 'NLT'],
    ['Can we see this in the Message?', 'MSG'],
    ['Keep this reference, but show it in the Amplified.', 'AMP'],
    ["Let's change to the NIV.", 'NIV'],
    ['Read the next verse in the NKJV.', 'NKJV'],
    ['Can we have the same passage in the Living Bible?', 'TLB'],
  ]) assert.strictEqual(heard(said), code, said);
});

// every intent family, for codes and for full names
const FAMILIES = {
  'translation-only': n => [`in the ${n} please`, `can we have that in ${n}`, `${n} please`.replace(/^/, 'let us read it in ')],
  'on screen': n => [`can we have ${n} on screen`, `put the ${n} on screen`, `could you put ${n} up`, `show us the ${n}`],
  'same passage': n => [`can we read this same passage on ${n}`, `let's see that in the ${n}`, `read it on ${n}`, `can we see this verse in ${n}`],
  'switch': n => [`switch to ${n}`, `change it to the ${n}`, `let's go back to ${n}`, `switch over to ${n}`, `let's change to the ${n}`],
  'keep the reference': n => [`keep this reference but show it in the ${n}`, `same verses but in ${n} please`, `can we have the same passage in the ${n}`],
  'with a cue': n => [`read the next verse in the ${n}`, `let's read the previous verse in ${n}`],
};

test('every intent family works for every edition, by code and by full name', () => {
  const failures = [];
  const names = Object.entries(CAT);
  const nameCount = new Map();
  for (const [, name] of names) { const k = name.toLowerCase(); nameCount.set(k, (nameCount.get(k) || 0) + 1); }
  for (const [code, rawName] of names) {
    const name = rawName.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    const forms = [code, ...(nameCount.get(rawName.toLowerCase()) === 1 ? [name] : [])];
    for (const n of forms) for (const [family, make] of Object.entries(FAMILIES)) for (const said of make(n)) {
      const spoken = said.replace(/\bthe\s+the\b/gi, 'the');   // nobody says "the The Message"
      const got = heard(spoken);
      if (got !== code) failures.push(`${family}: "${spoken}" -> ${got} (want ${code})`);
    }
  }
  assert.deepStrictEqual(failures, [], failures.length + ' failures:\n' + failures.slice(0, 40).join('\n'));
});

test('a reference and an edition in one sentence, either word order', () => {
  for (const [said, code] of [
    ['Genesis 4 3 on TPT', 'TPT'], ['John 3 16 in the Living Bible', 'TLB'], ['turn to Romans 8 28 in the Message', 'MSG'],
    ['Romans 8 28 from the New Living Translation', 'NLT'], ['read Psalm 23 1 on the Amplified', 'AMP'], ['John 3 16 in the voice version', 'VOICE'],
  ]) {
    const refs = parseAll(said, 'KJV', CAT);
    assert.ok(refs.length >= 1, 'no reference in ' + said);
    assert.strictEqual(heard(said), code, said + ' (edition)');
  }
});

test('ambiguous sermon words never switch editions on their own', () => {
  for (const said of [
    'the message of the cross is power', 'we will focus on the message', "let's focus on the message today", 'God has a message for you',
    'can you hear the message', 'we have the message', 'I love the message', 'his passion for souls was great', 'we need passion',
    'the voice of the Lord is upon the waters', 'hear my voice o God', 'we are the voice', 'that was good news for them', 'the good news is here',
    'a web of lies', 'is this the net', 'the sound was amplified', 'his voice was amplified', 'the living bible is on my shelf at home',
    'turn to the voice of reason and wisdom', 'we went back to the King James era of England', 'King James was a British monarch', 'we should keep moving',
    'present your bodies a living sacrifice', 'he gave her living water', 'the living word of God', 'we serve a living God', 'his word is living and active',
    'the message is living and active', 'the world wide web', 'a voice crying in the wilderness', 'the good news of the kingdom', 'with great passion he preached',
  ]) assert.strictEqual(heard(said), null, said);
});

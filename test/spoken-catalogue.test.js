'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const ENABLED = process.env.DIVERSE_SPOKEN_CATALOGUE_QA === '1';

test('all locally installed translations are recognised and loaded from spoken references', {
  skip: !ENABLED,
}, async () => {
  const { localTranslations, getDb, getVerse } = require('../services/bibleDb');
  const { parse } = require('../services/parser');
  const transcribeRoute = require('../routes/transcribe');

  const catalogue = localTranslations();
  const entries = Object.entries(catalogue).sort(([a], [b]) => a.localeCompare(b));
  assert.ok(entries.length >= 57,
    'Expected the complete 57-version local catalogue; found ' + entries.length);

  const selectSample = getDb().prepare([
    'SELECT book, chapter, verse',
    'FROM verses',
    'WHERE translation = ?',
    "AND length(trim(text)) > 0",
    "AND substr(COALESCE(source, 'seed'), 1, 3) != 'ai_'",
    'ORDER BY book_num, chapter, verse',
    'LIMIT 1'
  ].join(' '));

  const normaliseName = value => String(value || '')
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const nameCounts = new Map();
  for (const [, name] of entries) {
    const key = normaliseName(name);
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  }

  const samples = [];
  for (const [code, name] of entries) {
    const row = selectSample.get(code);
    assert.ok(row, code + ' (' + name + ') is listed but has no local passage text');
    const byCode = parse('switch to ' + code, '__ACTIVE_TRANSLATION__');
    assert.ok(byCode && byCode.translationOnly && byCode.translation === code,
      code + ': spoken code should switch translation; got ' + JSON.stringify(byCode));

    // If two editions share the same display label, the code is the safe spoken
    // disambiguator. Unique display names must work as aliases as well.
    const normalisedName = normaliseName(name);
    const spokenName = normalisedName && nameCounts.get(normalisedName) === 1
      ? String(name).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
      : code;
    const utterance = 'Turn to ' + row.book + ' chapter ' + row.chapter +
      ' verse ' + row.verse + ' in ' + spokenName;
    const byName = parse(utterance, 'KJV');
    assert.ok(byName && !byName.translationOnly && byName.translation === code,
      code + ': spoken name/code should select this version; got ' + JSON.stringify(byName));

    samples.push({ code, name, spokenName, book: row.book, chapter: row.chapter, verse: row.verse });

    const byNameSwitch = parse('switch to ' + spokenName, '__ACTIVE_TRANSLATION__');
    assert.ok(byNameSwitch && byNameSwitch.translationOnly && byNameSwitch.translation === code,
      code + ': spoken name/code should switch to this version; got ' + JSON.stringify(byNameSwitch));

    const loaded = await getVerse(row.book, row.chapter, row.verse, code);
    assert.ok(loaded && typeof loaded.text === 'string' && loaded.text.trim(),
      code + ': local passage failed to load');
    assert.equal(loaded.translation, code, code + ': passage loaded under the wrong version');
    assert.equal(loaded.fallback, undefined, code + ': local passage unexpectedly fell back');
  }

  const prompt = transcribeRoute.buildWhisperPrompt(catalogue);
  for (const [code] of entries) {
    assert.ok(new RegExp('\\b' + code + '\\b').test(prompt), 'Whisper prompt is missing installed code ' + code);
  }
  assert.ok(prompt.length < 1200,
    'Whisper prompt is too long to remain a compact dictionary (' + prompt.length + ' chars)');

  const port = 41000 + (process.pid % 10000);
  const dataFolder = process.env.DIVERSE_DATA;
  assert.ok(dataFolder, 'Spoken QA runner must provide DIVERSE_DATA');

  const server = spawn(process.execPath, [path.join(__dirname, '../server.js')], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      DIVERSE_NO_BROWSER: '1',
      DIVERSE_STATE_FILE: path.join(dataFolder, 'spoken-qa-state.json'),
      PORT: String(port),
      GROQ_API_KEY: '',
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY: '',
      GEMINI_API_KEY: '',
      APIBIBLE_KEY: ''
    },
    stdio: 'pipe'
  });

  let serverOutput = '';
  server.stdout.on('data', data => { serverOutput += data.toString(); });
  server.stderr.on('data', data => { serverOutput += data.toString(); });

  async function waitForServer() {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (server.exitCode !== null) {
        throw new Error('QA server exited early:\n' + serverOutput);
      }
      try {
        const response = await fetch('http://127.0.0.1:' + port + '/api/version');
        if (response.ok) return;
      } catch (error) {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('QA server did not start:\n' + serverOutput);
  }

  try {
    await waitForServer();

    for (const sample of samples) {
      const spokenName = sample.spokenName || sample.code;
      const text = 'Turn to ' + sample.book + ' chapter ' + sample.chapter +
        ' verse ' + sample.verse + ' in ' + spokenName;

      const response = await fetch('http://127.0.0.1:' + port + '/api/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          activeTranslation: 'KJV',
          fast: true,
          cues: false,
          via: 'full-catalogue-spoken-qa'
        })
      });

      assert.equal(response.status, 200,
        sample.code + ': detect route returned HTTP ' + response.status);
      const result = await response.json();
      assert.equal(result.type, 'explicit',
        sample.code + ': spoken reference was not detected: ' + JSON.stringify(result));
      assert.equal(result.reference.translation, sample.code,
        sample.code + ': spoken reference selected the wrong code');
      assert.ok(result.verseData && result.verseData.text && result.verseData.text.trim(),
        sample.code + ': detect route returned no passage text');
      assert.equal(result.verseData.translation, sample.code,
        sample.code + ': detect route loaded the wrong version');
      assert.equal(result.verseData.fallback, undefined,
        sample.code + ': detect route used a fallback');
    }

    console.log('[Spoken QA] Passed for ' + samples.length + ' installed translations.');
  } finally {
    const exited = new Promise(resolve => server.once('exit', resolve));
    server.kill('SIGTERM');
    await Promise.race([
      exited,
      new Promise(resolve => setTimeout(() => {
        server.kill('SIGKILL');
        resolve();
      }, 2500))
    ]);
  }
});

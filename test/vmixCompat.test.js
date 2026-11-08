// The projection page runs inside vMix's Web Browser input, which embeds an
// older Chrome (around version 86 per vMix's forum; vMix 24 may be older).
// Newer features silently break the layout there — `inset` once collapsed
// the squeeze and full-screen panels to nothing — so keep them out.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const files = ['public/projection/index.html', 'public/projection/backgrounds.js']
  .map(f => [f, fs.readFileSync(path.join(__dirname, '..', f), 'utf8')]);

const CHECKS = [
  [/(^|[;{\s])inset\s*:/m, 'CSS `inset` (Chrome 87) — use top/right/bottom/left'],
  [/(^|[;{\s])gap\s*:/m, 'flex `gap` (Chrome 84) — use margins'],
  [/clip-path[^;]*path\(|clipPath\s*=\s*['"]path\(/, 'clip-path: path() (Chrome 88) — use polygon()'],
  [/aspect-ratio\s*:/, 'CSS `aspect-ratio` (Chrome 88)'],
  [/:is\(|:where\(/, 'CSS :is() / :where() (Chrome 88)'],
  [/\?\.[a-zA-Z_(]/, 'optional chaining ?. (Chrome 80)'],
  [/\?\?/, 'nullish coalescing ?? (Chrome 80)'],
  [/\.replaceAll\(/, 'String.replaceAll (Chrome 85)'],
];

for (const [file, src] of files) {
  test(`${file} uses only features vMix's browser supports`, () => {
    // ignore comments, which may name the features
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
    for (const [re, what] of CHECKS) assert.ok(!re.test(code), `${file}: ${what}`);
  });
}

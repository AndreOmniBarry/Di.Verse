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
  [/querySelectorAll\([^)]*\)\s*\.forEach|badges\.forEach/, 'NodeList.forEach (Chrome 51) — wrap with toArray()'],
  [/=>/, 'arrow functions — keep the page plain ES5 for older embedded browsers'],
  [/(^|[^.\w])(let|const)\s/m, 'let / const — keep the page plain ES5'],
  [/`/, 'template literals — keep the page plain ES5'],
];

for (const [file, src] of files) {
  test(`${file} uses only features vMix's browser supports`, () => {
    // ignore comments, which may name the features
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
    for (const [re, what] of CHECKS) assert.ok(!re.test(code), `${file}: ${what}`);
  });
}

// Every function the projection page calls must exist (a refactor once
// deleted updateSqueezeClip and the projector page lost its background)
test('projection page defines every function it calls', () => {
  const src = files.find(f => f[0] === 'public/projection/index.html')[1];
  const script = src.slice(src.indexOf('<script>'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')       // comments
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''")      // strings
    .replace(/\/(?:[^\/\\\n]|\\.)+\/[gimy]*/g, '/x/');                 // regexes
  const defined = new Set([...script.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(|([A-Za-z_$][\w$]*)\s*=\s*function\b/g)].map(m => m[1] || m[2]));
  const called = new Set([...script.matchAll(/(?:^|[^.\w$])([a-z][\w$]*)\s*\(/gm)].map(m => m[1]));
  const builtins = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'parseFloat', 'parseInt', 'setTimeout', 'clearTimeout', 'getComputedStyle', 'encodeURIComponent', 'requestAnimationFrame', 'polygon', 'calc', 'rgba', 'rgb', 'url', 'var', 'translateY', 'blur', 'saturate', 'linear', 'radial', 'from', 'to']);
  const missing = [...called].filter(n => !defined.has(n) && !builtins.has(n));
  assert.deepStrictEqual(missing, []);
});

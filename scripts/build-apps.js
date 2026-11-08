// Builds the installable apps:
//   dist/Di.Verse-<version>-mac.zip      Di.Verse.app (Apple Silicon + Intel)
//   dist/Di.Verse-<version>-windows.zip  Di.Verse folder with an installer
//   dist/linux-test/                     (with --linux) the same app for a Linux self-test
//
//   npm run build:apps            (needs internet the first time: Node runtimes are cached in dist/.cache)
//
// Each app carries its own Node runtime (from nodejs.org, checksum-verified),
// the Di.Verse code with its pure-JavaScript dependencies, and a starter set
// of Bibles. No compiled add-ons: SQLite is built into Node. The apps keep
// keys, Bibles and songs in a data folder outside the app (services/paths.js).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const CACHE = path.join(DIST, '.cache');
const PKG = require(path.join(ROOT, 'package.json'));
const VERSION = PKG.version;
const NODE_MAJOR = process.env.DIVERSE_NODE_MAJOR || '22';
const SHIP_BIBLES = ['KJV', 'ASV', 'YLT', 'BBE', 'BSB', 'WEB']; // the rest are one click in Admin → Bibles
const APP_FILES = ['server.js', 'package.json', 'package-lock.json', '.env.example', 'services', 'routes', 'public', 'scripts/supervisor.js', 'scripts/bibles.js'];
const withLinux = process.argv.includes('--linux');

const step = m => console.log('• ' + m);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

async function get(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// fromRepo: copying the code from the repository, so leave out its own
// node_modules (the staged app gets production-only dependencies instead)
function copy(src, dst, { fromRepo = false } = {}) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true, filter: s => !/(^|[\\/])\.DS_Store$/.test(s) && !(fromRepo && /(^|[\\/])node_modules$/.test(s)) });
}

// Windows wants CRLF in .cmd / .vbs / .txt
function writeWin(src, dst) { fs.writeFileSync(dst, fs.readFileSync(src, 'utf8').replace(/\r?\n/g, '\r\n')); }

// ── Node runtimes, verified against nodejs.org's published checksums ──
async function nodeRuntimes() {
  fs.mkdirSync(CACHE, { recursive: true });
  const index = JSON.parse((await get('https://nodejs.org/dist/index.json')).toString());
  const rel = index.find(r => r.version.startsWith('v' + NODE_MAJOR + '.') && r.lts);
  if (!rel) throw new Error('No Node ' + NODE_MAJOR + ' LTS release found');
  const v = rel.version;
  step(`Node runtime ${v} (${rel.lts} LTS, ${rel.date})`);
  const sums = (await get(`https://nodejs.org/dist/${v}/SHASUMS256.txt`)).toString();
  const want = {
    'darwin-arm64': `node-${v}-darwin-arm64.tar.gz`,
    'darwin-x64': `node-${v}-darwin-x64.tar.gz`,
    'win-x64': `node-${v}-win-x64.zip`,
    ...(withLinux ? { 'linux-x64': `node-${v}-linux-x64.tar.gz` } : {}),
  };
  const out = {};
  for (const [plat, file] of Object.entries(want)) {
    const cached = path.join(CACHE, file);
    if (!fs.existsSync(cached)) { step('  downloading ' + file); fs.writeFileSync(cached, await get(`https://nodejs.org/dist/${v}/${file}`)); }
    const sha = crypto.createHash('sha256').update(fs.readFileSync(cached)).digest('hex');
    const line = sums.split('\n').find(l => l.endsWith('  ' + file));
    if (!line || line.split(/\s+/)[0] !== sha) { fs.unlinkSync(cached); throw new Error(file + ': checksum mismatch — deleted, run again'); }
    const dir = path.join(CACHE, plat);
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    if (file.endsWith('.zip')) run('unzip', ['-q', '-j', cached, `node-${v}-win-x64/node.exe`, `node-${v}-win-x64/LICENSE`, '-d', dir]);
    else run('tar', ['-xzf', cached, '-C', dir, '--strip-components=2', `${file.replace('.tar.gz', '')}/bin/node`]),
      run('tar', ['-xzf', cached, '-C', dir, '--strip-components=1', `${file.replace('.tar.gz', '')}/LICENSE`]);
    out[plat] = dir;
  }
  return { version: v, dirs: out };
}

// ── The app: code + production dependencies (pure JavaScript) ──
function stageApp() {
  const stage = path.join(DIST, 'stage', 'app');
  fs.rmSync(path.join(DIST, 'stage'), { recursive: true, force: true });
  for (const f of APP_FILES) copy(path.join(ROOT, f), path.join(stage, f), { fromRepo: true });
  step('Installing dependencies (no compiled add-ons)');
  run('npm', ['ci', '--omit=dev', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: stage });
  if (fs.existsSync(path.join(stage, 'node_modules', 'better-sqlite3'))) fs.rmSync(path.join(stage, 'node_modules', 'better-sqlite3'), { recursive: true });
  const native = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.node')) native.push(p); } })(path.join(stage, 'node_modules'));
  if (native.length) throw new Error('Compiled add-ons would break the other platforms: ' + native.join(', '));
  for (const dep of Object.keys(PKG.dependencies)) if (!fs.existsSync(path.join(stage, 'node_modules', dep))) throw new Error('Dependency missing from the app: ' + dep);
  return stage;
}

// ── Starter Bibles: a slim copy of bible.db ──
function stageBibles() {
  const src = path.join(ROOT, 'db', 'bible.db');
  if (!fs.existsSync(src)) throw new Error('db/bible.db is missing — run npm run seed and npm run bibles -- add BSB WEB first');
  const dst = path.join(DIST, 'stage', 'bible.db');
  const sqlite = require('../services/sqlite');
  const from = sqlite.open(src, { readonly: true });
  from.exec(`VACUUM INTO '${dst.replace(/'/g, "''")}'`);
  from.close();
  const db = sqlite.open(dst);
  const keep = SHIP_BIBLES.map(c => `'${c}'`).join(',');
  db.exec(`DELETE FROM verses WHERE translation NOT IN (${keep}) OR substr(source, 1, 3) = 'ai_'`);
  try { db.exec(`DELETE FROM translation_meta WHERE code NOT IN (${keep})`); } catch (e) {}
  const have = db.prepare('SELECT translation, COUNT(*) AS n FROM verses GROUP BY translation').all();
  db.exec('VACUUM'); db.close();
  for (const f of ['-wal', '-shm']) fs.rmSync(dst + f, { force: true });
  const missing = SHIP_BIBLES.filter(c => !have.find(h => h.translation === c));
  step(`Starter Bibles: ${have.map(h => h.translation).join(', ')} (${(fs.statSync(dst).size / 1e6).toFixed(0)} MB)` + (missing.length ? ` — not included: ${missing.join(', ')} (add with npm run bibles -- add ${missing.join(' ')})` : ''));
  return dst;
}

// ── Icons from packaging/icon-*.png ──
function icns(dst) {
  const parts = [['ic08', 'icon-256.png'], ['ic09', 'icon-512.png'], ['ic10', 'icon-1024.png']].map(([type, f]) => {
    const png = fs.readFileSync(path.join(ROOT, 'packaging', f));
    const head = Buffer.alloc(8); head.write(type, 0, 'ascii'); head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8); head.write('icns', 0, 'ascii'); head.writeUInt32BE(body.length + 8, 4);
  fs.writeFileSync(dst, Buffer.concat([head, body]));
}
function ico(dst) {
  const png = fs.readFileSync(path.join(ROOT, 'packaging', 'icon-256.png'));
  const h = Buffer.alloc(22);
  h.writeUInt16LE(0, 0); h.writeUInt16LE(1, 2); h.writeUInt16LE(1, 4);       // icon, 1 image
  h.writeUInt8(0, 6); h.writeUInt8(0, 7); h.writeUInt8(0, 8); h.writeUInt8(0, 9); // 256×256
  h.writeUInt16LE(1, 10); h.writeUInt16LE(32, 12); h.writeUInt32LE(png.length, 14); h.writeUInt32LE(22, 18);
  fs.writeFileSync(dst, Buffer.concat([h, png]));
}

function zip(dir, entries, out) {
  fs.rmSync(out, { force: true });
  run('zip', ['-qry9', out, ...entries], { cwd: dir });
  step(`${path.relative(ROOT, out)} — ${(fs.statSync(out).size / 1e6).toFixed(0)} MB`);
}

function buildMac(stage, bibles, nodes) {
  const out = path.join(DIST, 'mac');
  fs.rmSync(out, { recursive: true, force: true });
  const app = path.join(out, 'Di.Verse.app', 'Contents');
  fs.mkdirSync(path.join(app, 'MacOS'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'packaging/mac/launcher.sh'), path.join(app, 'MacOS', 'Di.Verse'));
  fs.chmodSync(path.join(app, 'MacOS', 'Di.Verse'), 0o755);
  fs.writeFileSync(path.join(app, 'Info.plist'), fs.readFileSync(path.join(ROOT, 'packaging/mac/Info.plist'), 'utf8').replace(/__VERSION__/g, VERSION));
  fs.writeFileSync(path.join(app, 'PkgInfo'), 'APPL????');
  const res = path.join(app, 'Resources');
  copy(stage, path.join(res, 'app'));
  fs.copyFileSync(bibles, path.join(res, 'bible.db'));
  for (const arch of ['arm64', 'x64']) {
    copy(nodes['darwin-' + arch], path.join(res, 'node-' + arch));
    fs.chmodSync(path.join(res, 'node-' + arch, 'node'), 0o755);
  }
  icns(path.join(res, 'AppIcon.icns'));
  fs.copyFileSync(path.join(ROOT, 'packaging/mac/READ ME FIRST.txt'), path.join(out, 'READ ME FIRST.txt'));
  zip(out, ['Di.Verse.app', 'READ ME FIRST.txt'], path.join(DIST, `Di.Verse-${VERSION}-mac.zip`));
}

function buildWindows(stage, bibles, nodes) {
  const out = path.join(DIST, 'windows');
  fs.rmSync(out, { recursive: true, force: true });
  const dir = path.join(out, 'Di.Verse');
  copy(stage, path.join(dir, 'app'));
  copy(nodes['win-x64'], path.join(dir, 'node'));
  fs.copyFileSync(bibles, path.join(dir, 'bible.db'));
  for (const f of ['Di.Verse.vbs', 'Install Di.Verse.cmd', 'Uninstall Di.Verse.cmd', 'READ ME FIRST.txt']) writeWin(path.join(ROOT, 'packaging/windows', f), path.join(dir, f));
  ico(path.join(dir, 'Di.Verse.ico'));
  zip(out, ['Di.Verse'], path.join(DIST, `Di.Verse-${VERSION}-windows.zip`));
}

function buildLinuxTest(stage, bibles, nodes) {
  const dir = path.join(DIST, 'linux-test');
  fs.rmSync(dir, { recursive: true, force: true });
  copy(stage, path.join(dir, 'app'));
  copy(nodes['linux-x64'], path.join(dir, 'node'));
  fs.copyFileSync(bibles, path.join(dir, 'bible.db'));
  step('dist/linux-test — same app with the Linux runtime, for a self-test');
}

(async () => {
  console.log(`\nBuilding Di.Verse ${VERSION} apps\n`);
  const nodes = await nodeRuntimes();
  const stage = stageApp();
  const bibles = stageBibles();
  buildMac(stage, bibles, nodes.dirs);
  buildWindows(stage, bibles, nodes.dirs);
  if (withLinux) buildLinuxTest(stage, bibles, nodes.dirs);
  console.log('\nDone.\n');
})().catch(err => { console.error('\n✗ ' + err.message); process.exit(1); });

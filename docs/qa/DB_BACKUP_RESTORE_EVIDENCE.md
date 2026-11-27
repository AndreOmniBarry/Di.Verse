# Di.Verse v1.11.1: Bible database health, backup and restore evidence

Branch: `feature/db-health-backup-restore-v1.11.1-20261127`, based on `main` at `3f8ab4a` (rewritten history).
Pull request: https://github.com/AndreOmniBarry/Di.Verse/pull/20 (not merged).
Prepared: 27 November 2026.

Every result below was copied from real command output. Anything not run is listed under section 9.
No owner database was used: every test ran on a temporary data folder, or on a public-domain seed database (KJV, ASV, YLT, BBE, then BSB and WEB for the build) created inside a fresh clone in a cloud workspace.

## 1. Feature summary and changed files

Ported from the database commits `143df4c` and `5e0e137` on the earlier working branch and reconciled with v1.11.0. Nothing else from that branch is included. The v1.11.0 catalogue-driven parser is unchanged.

| Capability | Where |
|---|---|
| Health: database path, packaged or development mode, engine, size, WAL size, integrity check, translations with verse counts, backup status (last backup, number kept) | `services/dbBackup.js` `health()`, `GET /api/db/health`, Setup → Bible database |
| Backup: SQLite `VACUUM INTO` (a consistent copy from a read transaction, including committed WAL changes), unique names, integrity-checked, `.json` record beside each one, stored in `<data folder>/backups` | `create()`, `POST /api/db/backups`, Back up now |
| Restore: exact name confirmed; candidate checked first (integrity, Di.Verse `verses` table); safety backup of the current database; close with WAL checkpoint; stale `-wal`/`-shm` removed; swap; reopen; integrity check; rollback on failure; translation list and navigation caches refreshed | `restore()`, `POST /api/db/restore` with `{ name, confirm }`, Restore button with confirmation dialog |
| Operator laptop only: every `/api/db/*` route, reads included | `routes/database.js` |

Changed files (`git diff --name-status origin/main..HEAD`, 13 files, 684 insertions, 2 deletions, plus this report):

```
M  .gitignore                              backups/ ignored
M  public/setup/index.html                 Bible database section
A  routes/database.js
M  server.js                               one line: the route
M  services/bibleDb.js                     closeDb(), DB_PATH export
A  services/dbBackup.js
M  services/sqlite.js                      DIVERSE_SQLITE_ENGINE=better-sqlite3 test switch
A  test/browser/setup-database.js
A  test/db-backup-better-sqlite3.test.js
A  test/db-backup.test.js
A  test/helpers/backupScenario.js
A  test/helpers/tempBible.js
A  test/translation-persistence.test.js
A  docs/qa/DB_BACKUP_RESTORE_EVIDENCE.md, docs/qa/screenshots/setup-database-section.png
```

## 2. Versions

| Component | Version |
|---|---|
| Node.js | v22.23.5 |
| `node:sqlite` (built in) | SQLite 3.54.1 |
| `better-sqlite3` (optional dependency) | 12.11.1, SQLite 3.53.2 |
| `sqlite3` command-line tool (used by the test runner) | 3.45.1 |
| Playwright / Chromium (browser check) | 1.63.0 / 157.0.8103.78 |
| Local test machine | Linux 6.18 (cloud workspace) |
| CI | GitHub Actions: `ubuntu-latest` (tests), `macos-15` (installers) |

## 3. Commands executed

```bash
npm ci                                   # includes optional better-sqlite3
npm run seed                             # public-domain seed DB inside the fresh clone only
node --test test/db-backup.test.js test/db-backup-better-sqlite3.test.js
node --test test/translation-persistence.test.js
npm test                                 # scripts/run-tests.js + scripts/run-spoken-tests.js
node test/browser/setup-database.js docs/qa/screenshots/setup-database-section.png
npm run bibles -- add BSB WEB            # as CI does before building
npm run build:apps
```

## 4. Test totals

| Run | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|
| `npm test`, final run on commit `9191e36` | 141 | 140 | 0 | 1 |
| Backup/restore, both engines, plus persistence (`node --test` on the three files) | 32 | 32 | 0 | 0 |
| Setup page browser check | 19 checks | 19 | 0 | 0 |

- **The 1 skip in `npm test`** is the existing full-catalogue spoken QA. Its output: `[Spoken QA] Skipped full-catalogue check: 4/57 installed translations found.` It runs only with the full local library.
- **Baseline:** `main` at v1.11.0 gave 109 tests (108 passed, 1 skipped). The 32 new tests account for the difference.
- **The test runner** printed `Using a disposable database` and `Live db/bible.db will not be modified`.

## 5. Backup and restore results

The same 13 checks ran once per engine: `test/db-backup.test.js` on `node:sqlite` and `test/db-backup-better-sqlite3.test.js` on `better-sqlite3`. All passed on both:

| Check | node:sqlite | better-sqlite3 |
|---|---|---|
| Engine actually in use is the one under test | pass | pass |
| Temporary data folder used, never the real database | pass | pass |
| A backup includes changes still in the WAL file (WAL proven non-empty first) | pass | pass |
| Two backups in the same second get different names; nothing overwritten | pass | pass |
| The listing gives names and facts, no folder paths; `.json` metadata (time, size, verses, source, engine) | pass | pass |
| Restore refused without confirmation, with a wrong confirmation, and with a path-like name; database untouched | pass | pass |
| Confirmed restore brings the backup back; the "before-restore" safety backup holds the replaced database; integrity `ok`; no leftover temp file | pass | pass |
| After a restore, the normal verse lookup and translation list return the restored translation (no fallback) | pass | pass |
| After a restore, the v1.11.0 catalogue parser recognises the restored translation by name again (and not while it was removed) | pass | pass |
| A damaged file is refused; the current database is unchanged and healthy | pass | pass |
| A missing backup, and a valid SQLite file that is not a Bible database, are refused; database untouched | pass | pass |
| Rollback: if the restored file fails to open, the previous database is put back and the error says so | pass | pass |
| Health reports the active database, mode, engine and translations; "last backup" ignores files without a `.json` record | pass | pass |

**Persistence, `test/translation-persistence.test.js`** (6 checks, all passed). A translation stored through `library.store()`:
- is in `verses` and `translation_meta`;
- is readable from a fresh connection;
- is listed and served by a running server, both a single verse and a range;
- is still there after a server restart;
- is reported by `/api/db/health`.

Every `/api/db/*` route returns **HTTP 403** to a request from another network address.

**Setup page, `test/browser/setup-database.js`** (19 checks, all passed, on a throwaway copy of the seed database):
- the health rows (Healthy, database path, mode, engine, translations, "No backup yet");
- Back up now, with size and "checked", the list, the status line and the `.json` file;
- a cancelled restore changes nothing;
- a confirmed restore reports integrity checked, lists the safety backup, stays healthy, and lookups still work;
- a damaged backup is refused with its reason and the database stays healthy;
- no page errors.

The screenshot `screenshots/setup-database-section.png` shows paths, sizes and translation codes only.

## 6. Mac and Windows builds

**Local build** (`npm run build:apps`, Linux, Node v22.23.5 runtimes downloaded for darwin-arm64, darwin-x64 and win-x64): exit code 0.

| Package | Size | SHA-256 |
|---|---|---|
| `dist/Di.Verse-1.11.0-mac.zip` | 94 MB | `3138fe44870bdcdd19ff8489a4327a2c1631d2859e6a42520195f0768e164978` |
| `dist/Di.Verse-1.11.0-windows.zip` | 52 MB | `1eacab2eab030dfd1f6783570f57a67ab0f9c5f46b4fca04e2dae1a16cc6c9b1` |

- Starter Bibles bundled: ASV, BBE, BSB, KJV, WEB, YLT (40 MB).
- Both packages contain `services/dbBackup.js`, `routes/database.js`, the updated `services/sqlite.js` and `public/setup/index.html`.
- Neither contains a `backups/` folder, `bible-imports`, any AMP file, or Di.Verse's test files.
- **Packaged-mode smoke test** (Windows package, its `app/` folder run with the workspace's Linux Node, `DIVERSE_DATA` set to a temporary folder, bundled `bible.db` as the first-run source):
  - `/api/db/health` returned `mode packaged`, integrity `ok`, engine `node:sqlite`, and translations ASV, BBE, BSB, KJV, WEB and YLT;
  - `POST /api/db/backups` wrote `bible-2026-11-27T18-00-07Z-manual.db` (integrity `ok`) and its `.json` into the temporary data folder's `backups/`, outside the app.
- The version label is still 1.11.0, because `package.json` is unchanged. Bumping it to 1.11.1 is a release step.

**CI build on `macos-15`:** succeeded, including the workflow's own "Verify installer archives" step. See section 7.

## 7. GitHub Actions

Workflow: `.github/workflows/stable-release.yml` ("Di.Verse stable release"). On pull requests it runs "Test clean install" (`npm ci --omit=optional`, seed, `npm test`) and "Build Mac and Windows installers" (`macos-15`).

| Run | Commit | Job | Result |
|---|---|---|---|
| [#45](https://github.com/AndreOmniBarry/Di.Verse/actions/runs/46046212598) (pull_request) | `9191e36` | [Test clean install](https://github.com/AndreOmniBarry/Di.Verse/actions/runs/46046212598/job/140666010838) (ubuntu-latest) | **success**: 129 tests, 127 passed, 0 failed, 2 skipped |
| | | [Build Mac and Windows installers](https://github.com/AndreOmniBarry/Di.Verse/actions/runs/46046212598/job/140667008830) (macos-15) | **success**: build, "Verify installer archives" and upload all passed; artifact `Di.Verse-v1.11.0-installers` (141,938,712 bytes, SHA-256 of the artifact zip `39d72705eb29ee8c303a214f3097a5fb4d2ac324fccd78a90da72cfe08776308`), [download](https://github.com/AndreOmniBarry/Di.Verse/actions/runs/46046212598/artifacts/15223026202) |
| | | Publish GitHub release | skipped (only runs on release pushes, as intended) |

**Why CI shows 129 tests (2 skipped) against 141 (1 skipped) locally:** CI installs with `--omit=optional`, so `better-sqlite3` is absent there. Its 13 checks become a single skipped test with the reason "better-sqlite3 is not installed (optional dependency)" (141 − 13 + 1 = 129). The other skip is the full-catalogue spoken QA, as locally. Both engines were covered by the local run in section 5. The HTTP 403 test ran and passed in CI as well.

A later commit containing only this report triggers another run on the same workflow. Its result is on the pull request's Checks tab.

## 8. Manual checklist for the Setup page (owner's Mac)

Not yet performed. Use a test copy of the data folder, or check that a fresh backup exists before trying Restore.

- [ ] Setup → Bible database shows **Healthy**, the expected database path (installed app: `~/Library/Application Support/Di.Verse/db/bible.db`), the mode, size, engine and integrity.
- [ ] The translation count and verse counts match what Admin → Bibles shows (including AMP and AMPC).
- [ ] **Back up now** reports the size and "checked". The new file and its `.json` appear in the backups folder shown on the page. For a large database, note how long it takes.
- [ ] The status line changes from "No backup yet" to "Last backup …".
- [ ] **Restore** → Cancel: nothing changes.
- [ ] Only on a test copy: **Restore** → OK reports "Restored … integrity checked", and a "saved before a restore" backup appears.
- [ ] An Operator page left open shows the translation list within 30 seconds.
- [ ] From a second device (the projection PC), `http://<mac-ip>:3000/api/db/health` returns 403.

## 9. Limitations and work not completed

- **Manual checks:** the section 8 checklist has not been done on the owner's Mac. All results above come from automated runs in a Linux cloud workspace.
- **Native runtimes:** the Mac and Windows packages were built and inspected, and the packaged JavaScript was run in packaged mode with Linux Node. The bundled macOS and Windows Node runtimes were not started, because that needs a Mac and a Windows PC.
- **`better-sqlite3`** is covered locally only. CI skips it (optional dependency).
- **The browser check** (`test/browser/setup-database.js`) is run by hand. It is not part of `npm test` or CI, matching the existing `test/browser/screen-guard.js`.
- **The full 57-translation spoken QA** was skipped (it needs the owner's library). This change doesn't touch the parser.
- **Concurrency:** backup and restore run synchronously, so no other request in the same Di.Verse process touches the database meanwhile. Another program writing the same `bible.db` during a restore (for example `npm run bibles` in a second Terminal) is not protected against.
- **Phrase-finder index:** the quote and phrase-finder search index, built from KJV wording, is only rebuilt when Di.Verse restarts. The translation list, the catalogue parser and navigation refresh immediately.
- **Timing on a large database:** backup and restore of a database around 342 MB were not timed. They run synchronously, so the page waits until they finish.
- **Retention:** there is no automatic clean-up of old backups. They stay until deleted by hand.
- **Repository history:** separate from this change, the old AMP archive is still reachable through closed pull request refs on GitHub until GitHub Support removes them. The history purge is not complete until then.

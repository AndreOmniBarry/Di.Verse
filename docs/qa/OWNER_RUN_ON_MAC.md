# Running the v1.11.1 checks on your Mac

These commands only **read** your library: the check makes its own temporary copy, and your `bible.db` is never written to. Nothing is uploaded.

## 1. Get the release candidate (about 2 minutes)

```bash
cd ~/Projects/Di.Verse-rewritten
git fetch origin
git switch feature/v1.11.1-integration-20261127
npm ci
```

## 2. Full 57+ translation check (about 5 to 15 minutes)

Use the library that holds your 57+ translations. **If it's the installed app's library:**

```bash
node scripts/qa-full-catalogue.js --source "$HOME/Library/Application Support/Di.Verse/db/bible.db"
```

**If it's the importer folder's library** (read-only; nothing is seeded, imported or restored there):

```bash
node scripts/qa-full-catalogue.js --source "$HOME/Projects/Di.Verse-importer/db/bible.db"
```

It ends with `[Catalogue QA] PASSED` or `FAILED`, then:

```bash
open qa-output/translation-manifest.md
open qa-output/voice-test-list.csv
```

- **Send** `qa-output/translation-manifest.md` (it contains no verse text) or the final lines of the output.
- **Use** `voice-test-list.csv` for the per-edition voice check (plan §D8).
- **If it says the source changed while copying,** close Di.Verse and run the command again.

## 3. Optional: the browser checks on the Mac

These need a public-domain seed database in this folder. Seeding writes only `db/bible.db` **inside `Di.Verse-rewritten`**, never your installed app's library:

```bash
ls db/bible.db || npm run seed
npx playwright install chromium
for t in screen-guard listening translations setup-database regression; do node test/browser/$t.js || break; done
```

## 4. Church hardware

Follow `docs/qa/VOICE_AND_HARDWARE_TEST_PLAN.md` sections A to E with the installed v1.11.1 app (from PR #21's CI artifact `Di.Verse-v1.11.1-installers`), and fill in its Result column.

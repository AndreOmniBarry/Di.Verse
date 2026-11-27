# Di.Verse v1.12.0 (Sermon notes, operator redesign, virtual set)

## Highlights

- **Sermon notes.** Titles, numbered points and highlights are recognised from the preacher's own words and offered for approval.
  - The heard wording is always kept. An optional shorter display wording only removes filler words.
  - The operator can edit, approve, dismiss or add notes by hand.
  - References come only from what was said (validated against the Bible), the verse on screen when a point is made, or what the operator types. Nothing is guessed, and sermon numbering ("number three") is never read as Numbers.
  - A title shows for 10 seconds by default. Every note can be replayed. Hiding a note never clears the scripture or lyrics under it.
  - Notes survive a page refresh and a restart, in their own database (`db/presentation.db`).
- **Operator redesign.**
  - A navigation rail with Live Control, Scripture, Sermon Notes, Songs, Virtual Set, Presentation History and Settings, opened by Alt+1 to Alt+7.
  - What is on screen, the queue and Push stay visible in every section.
  - Dark navy, graphite, champagne gold and ivory palette; serif type for scripture; one consistent SVG icon set; no emoji on any page.
  - Setup, Admin, Bibles, About and the preacher monitor use the same palette.
- **Virtual set.**
  - Presentation profiles: layout, background (transparent for livestream graphics), palette, typeface, text scale, position, safe area, split ratio, transition and ministry name.
  - Each profile is edited in a live 16:9 preview and goes to the screens only after **Take live**.
  - New layouts: **Split** (preacher left or right) and **Cinematic teaching**.
- **vMix.** The Split layouts zoom the live camera into the split window through the existing Web Controller link, the same way Squeeze does. Squeeze geometry and automatic camera resizing are unchanged. Sermon notes and profile changes never move the camera, except a new split ratio while split.
- **Presentation History.** Every verse, song slide, reference and note shown, with time and detail.

## Changes in behaviour

- **Clear** (Esc) also removes a sermon note on screen.
- **Display controls have moved.**
  - The display mode, Squeeze camera size and caption look are now under **Scripture**.
  - Whisper double-check is under **Settings**.
  - Auto-push sits next to **Push** in the program column.
  - The mode button in the top bar still cycles the modes (M).
- **H** hides the sermon note.

## Data

- New file `db/presentation.db` (schema version 1): `sermon_sessions`, `sermon_notes`, `presentation_history` (latest 5,000 entries), `vset_profiles` and `presentation_settings`.
  - It is created on first use and is separate from `bible.db` and `songs.db`, which are not changed.
  - Later schema versions are added as numbered migrations in `services/presentationDb.js`.

## API (writes are operator-laptop only, like the rest of the API)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/sermon` | Current sermon, its notes, title duration |
| POST | `/api/sermon/session` | New sermon `{title?}` |
| POST | `/api/sermon/observe` | A finished sentence `{text, heardAt?}`; returns new suggestions |
| POST | `/api/sermon/notes` | Manual note `{kind, number?, original, display?, refText?}` |
| PATCH | `/api/sermon/notes/:id` | Edit `{display, status, number, kind, refs}` |
| POST | `/api/sermon/notes/:id/refs` | Attach a typed reference (422 if it doesn't exist) |
| DELETE | `/api/sermon/notes/:id` | Delete a note |
| POST | `/api/sermon/notes/:id/show` | Show or replay `{durationMs?}` (title 10,000 by default; 0 = until hidden; at most 10 minutes) |
| POST | `/api/sermon/hide` | Hide the note layer only |
| GET | `/api/vset` | Profiles, live profile, layouts, backgrounds, transitions |
| POST / PUT / DELETE | `/api/vset/profiles[/:id]` | Create, edit (re-applied if live), delete (refused while live) |
| POST | `/api/vset/live` | Take a profile live `{id}` |
| GET | `/api/history` | Presentation history `?limit=` |

Screen messages added: `SHOW_NOTE`, `HIDE_NOTE`, `APPLY_PROFILE`. The projection page stays ES5 for vMix's built-in browser.

## Validation

- Automated: `npm test` and the browser checks in `test/browser/` (including the new `sermon-virtualset.js`). See `docs/qa/V1_12_CHURCH_ROOM_TEST.md` for the manual checks on the church computers.

## Notes

- `package.json` still reads 1.11.1. Set the version when the release is cut.
- 3D virtual sets are not part of this release. Compositing is done in the browser.

# Di.Verse

**The Word, on cue.** Di.Verse listens to the preacher and puts the scripture on screen about a second after it's spoken. It shows on the projector, on the livestream (vMix, OBS), and on a preacher's monitor.

It runs on the church laptop. Bible text stored locally shows instantly and keeps working when the internet drops.

## What it does

- **Hears the reference.** "John 3:16", "Romans chapter 8 verse 28", "verses 17 to 19": Chrome's live captions find it in about a second, and Whisper (Groq) catches anything they miss.
- **Recognises a verse that's quoted, not named.** Exact KJV wording, modern wording, a paraphrase, or a misheard word ("Isaac *sold* in that land" → Genesis 26:12). Very clear matches go on screen; others wait in the queue for the operator.
- **Follows the preacher.** "Next verse", "take it back", "verse 17", "next chapter". It also responds to the operator's arrow keys or a presentation clicker.
- **Fits every verse on one screen,** however long. There are no "1/3" pages. Three looks:
  - **Lower third** over the camera.
  - **Squeeze:** the preacher shrinks to a window at the top left and the scripture fills the rest. vMix moves the camera automatically.
  - **Full screen:** scripture only.
- **Bible library.** KJV, ASV, YLT and BBE are built in. Eight free translations (BSB, WEB, MSB, AAB, Darby, RV, Geneva, Webster) download in about a second each. Licensed translations come from a file you're entitled to use, or from API.Bible.
- **Song lyrics,** with "follow the singer".
- **Built for long services.** Pages reconnect by themselves, the server restarts itself, the computer is kept awake, and old screens update themselves.

## Install

**Mac or Windows app (no Terminal):** build with `npm run build:apps`, then follow `READ ME FIRST.txt` in the zip. In short:
- **Mac:** drag Di.Verse.app into Applications.
- **Windows:** run `Install Di.Verse.cmd`.

Both open the Operator page in Chrome. Paste your free keys under **Settings**.

**From the code:**

```
npm ci
npm run seed          # KJV, ASV, YLT, BBE (once, needs internet)
npm run bibles -- add BSB WEB
npm start             # opens http://localhost:3000/operator
```

You need Node.js 22 or newer and Google Chrome (for live captions). Free keys from Groq and Gemini cover the beta. [SETUP.md](SETUP.md) has every step, including vMix and troubleshooting.

| Page | Address |
|---|---|
| Operator (the laptop) | `http://localhost:3000/operator` |
| Projector / TV | `http://<laptop-ip>:3000/projection` |
| Livestream overlay (vMix, OBS) | `http://<laptop-ip>:3000/projection?overlay=1` |
| Preacher's monitor | `http://<laptop-ip>:3000/preacher` |
| Settings, Bibles, Songs | `/setup`, `/admin/bibles.html`, `/admin` |

Only the operator laptop can control Di.Verse. Other devices on the Wi-Fi can only view.

## How it's built

Node.js and Express, a WebSocket to the screens, and SQLite (Node's built-in `node:sqlite`). It has no build step and no compiled add-ons.

| Folder | What's there |
|---|---|
| `server.js` | Web server, screen WebSocket, operator-only guard, Settings |
| `routes/` | HTTP API: verses, detection, push, songs, transcription, Bible library |
| `services/parser.js`, `quoteMatch.js`, `verseFinder.js`, `claude.js` | Finding the verse: spoken references, exact quotes, paraphrases and mishearings (offline), then AI |
| `services/navigation.js` | Next / previous verse and chapter, and the preacher's cues |
| `services/bibleDb.js`, `library.js`, `importer.js`, `books.js` | Bible storage, free downloads, file import (JSON, USFM, OSIS, Zefania) |
| `services/vmix.js` | vMix link (automatic squeeze, reloading old screens) |
| `public/` | Operator, projection, preacher, admin and settings pages |
| `scripts/` | `supervisor.js` (keeps it running), `bibles.js` (library CLI), `build-apps.js` (Mac and Windows packages) |
| `packaging/` | App launchers, installers and icons |
| `test/` | `npm test`, Node's built-in test runner |

[AUDIT.md](AUDIT.md) records why things are built the way they are, including every piece of feedback from live testing and what changed because of it.

## Translations and licences

Di.Verse only stores and shows scripture it's allowed to:
- **Built-in and free:** public domain or openly licensed, with each licence checked before download.
- **Copyrighted versions** (NKJV, AMP, TPT, NIV, …): only from a publisher-licensed source, either API.Bible or a file you import with a note of where it came from.
- **AI-recalled wording** is never presented as the real text.

## Software licence

The Di.Verse application code is distributed under the ISC licence in [LICENSE](LICENSE). This software licence does **not** grant rights to Bible translations, song lyrics, publisher content, or files imported by an operator. Those materials remain subject to their own copyright and licence terms.

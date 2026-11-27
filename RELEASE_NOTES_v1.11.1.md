# Di.Verse v1.11.1

## Highlights

- **Bible database health, backups and safe restore.**
  - Setup → Bible database shows which database file is in use, packaged or development mode, the engine, size, integrity, every stored translation with its verse count, and the backup status.
  - **Back up now** makes a checked, consistent copy that includes recent unsaved changes and never overwrites an earlier backup.
  - **Restore** asks for confirmation, checks the backup, keeps the current database as a backup, and puts it back automatically if anything goes wrong.
- **Partial Bible imports** (JSON and ZIP chapter archives). An edition doesn't need all 66 books. Books and testaments are recognised from the archive, paragraph ranges (MSG, J. B. Phillips) are kept as one passage, unsafe archive paths are rejected, and you state where the file came from and that you may use it.
- **Navigating incomplete editions.** Next and Previous follow the verses, chapters and books an edition actually has. They respect gaps and paragraph ranges, and keep your chosen translation when a KJV fallback has to be shown.
- **Footnote markers** such as `[a]` or `[12]` show as small superscripts on scripture only. The stored text, song lyrics and other text are never changed.
- **Licensed editions are only shown in their real wording** (issue #18).
  - Text from AI is never presented as AMP, AMPC, TPT, MSG, NIV, NKJV or any other named licensed edition.
  - Saved AI answers never count as an installed translation.
  - A passage missing from a licensed edition comes from API.Bible when your plan allows it. Otherwise the KJV fallback is labelled with the reason.
- **Listening in church:**
  - Whisper is tuned for sermons: a higher-accuracy model, English, longer audio context, and hints for Nigerian-English pronunciations of book names (Proverbs, Zephaniah, Ephesians and others).
  - You can choose the audio input, with adaptive voice detection.
  - Built-in microphones keep automatic gain; mixer and Focusrite line inputs bypass it.
- **Windows audio link.** The church PC with the Focusrite (PC 2) can send its audio to the Di.Verse computer (PC 1) through a paired browser link, protected by a one-time link from the Operator page.
- **Reading and following:**
  - While a verse on screen is being read aloud, nothing else replaces it, and the screen follows the reading into the next verse.
  - A book said in one phrase and the numbers in the next are joined.
  - An unclear reference gets a second listen through Whisper.
  - "Next verse", "verse 17" and "take it back" keep working.
- **Bible stories and reference-only display.** Mentioning a Bible story, such as Abraham and Isaac, suggests its passage. **Ref on screen** shows "Scriptural Reference — Genesis 22:1–19" as a lower third for note-takers. Modern wording (BSB, WEB) also finds verses.
- **Translations by voice.** Saying "can we have that in the NKJV", "let's read from the Passion Translation" or "go back to the King James" re-shows the verse on screen in that translation, keeping the verse range. An unavailable translation is reported, and the screen stays as it was. An open Operator page notices translations imported or removed elsewhere within 30 seconds.

## Changes in behaviour

- **Auto-push is now off by default.** Detected verses go to the queue for the operator to push. Tick **Auto-push** to project automatically.
- With Auto-push on, a verse goes up automatically only at confidence 0.93 or above. That covers named references, voice cues and a book joined with its numbers. Exact quotes and completed half-heard references wait in the queue.
- Opening Setup no longer runs the slow full integrity check, which paused Di.Verse for about 2 seconds on a large library. Setup shows the last check; **Check again** runs a new one. Backups and restores always check.

## Validation

- Automated suite: see `docs/qa/DI_VERSE_V1_11_1_FINAL_ACCEPTANCE.md` for the exact totals, CI links and status of every acceptance area.
- The full translation-library check (`scripts/qa-full-catalogue.js`) and the microphone, church audio, vMix and native Mac and Windows startup checks are run by the owner on the church computers. Their results are recorded in the acceptance document before release.

## Notes

- Fresh installers include KJV, ASV, YLT, BBE, BSB and WEB. Your own imported translations, keys, songs and backups stay in your data folder and are never included in an installer.
- The Mac app is not Apple-signed. macOS may ask you to approve it on first launch under Privacy & Security.

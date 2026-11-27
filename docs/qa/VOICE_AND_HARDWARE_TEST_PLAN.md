# Di.Verse v1.11.1: voice and church hardware test plan

These checks need you, the real computers and real sound. Nothing in this file can be automated or simulated in the cloud workspace. Record each result as **Pass / Fail / Not tested**, plus a note, in the "Result" column, then copy the totals into `DI_VERSE_V1_11_1_FINAL_ACCEPTANCE.md` (section "Audio and hardware").

**Setup.**
- PC 1 is the Mac running Di.Verse and the Operator page.
- PC 2 is the Windows PC running vMix 24 with the Focusrite.
- Both are on the church network.
- Before starting, make a backup: Setup → Bible database → Back up now.

**What "projected correctly" means:** the reference and translation badge on the projection (and in vMix) match what was asked for, and the text is that translation's.

## A. Before the service (10 minutes)

| ID | Check | How | Expected | Result |
|---|---|---|---|---|
| A1 | Native Mac start | Open the installed Di.Verse 1.11.1 app on PC 1 | Operator opens, header shows **v1.11.1**, Setup's System check is all ✅ or ⚠️ | |
| A2 | Native Windows start (optional) | On a Windows PC, install from `Di.Verse-1.11.1-windows.zip` and open it | Operator opens on that PC, header v1.11.1 | |
| A3 | Library intact after upgrade | Setup → Bible database | Same database path as before, translation count and AMP/AMPC counts as before, **Check again** → Healthy | |
| A4 | Projection in vMix | vMix browser input → `http://<mac-ip>:3000/projection` | Logo shows; a pushed verse appears; lower-third / squeeze / full-screen all render | |
| A5 | Preacher monitor | Second screen → `http://<mac-ip>:3000/preacher` | Shows the same verse as the projection | |
| A6 | Other devices can't control it | From PC 2's browser open `http://<mac-ip>:3000/api/db/health` | HTTP 403 "Operator laptop only" | |

## B. Windows PC 2 → Mac audio link (Focusrite / mixer)

| ID | Check | How | Expected | Result |
|---|---|---|---|---|
| B1 | Connector | On PC 1, Operator → **Link Windows audio** downloads `DiVerse-Windows-Audio-Bridge.bat`. Copy it to PC 2, right-click → **Run as administrator** | "Link ready", Chrome/Edge opens "Windows audio input" | |
| B2 | Choose the Focusrite input | **Find inputs** → pick the Focusrite input vMix uses → **Start sending audio** | The page shows it is sending; Operator shows the Windows audio link as connected with the input name | |
| B3 | Level | Pastor or a reader speaks into the pulpit mic | The Operator level bar moves around half; transcript lines appear | |
| B4 | No double capture | While the link is active | The Mac's own microphone isn't used at the same time (Operator says so) | |
| B5 | Restart behaviour | Restart Di.Verse on PC 1 | The old link stops working (the pairing link changes each start). Download a fresh connector and repeat B1–B2 | |
| B6 | Network drop | Unplug PC 2's network for 10 s, then reconnect | Operator shows an audio-link warning; after reconnecting, restarting the bridge page restores it | |

## C. Speech recognition with a live voice

Use the pulpit mic through the B link, or Chrome's own microphone on the Mac for C1 (state which in the note). **Auto-push** on for C2–C12 unless stated otherwise.

| ID | Check | Say | Expected | Result |
|---|---|---|---|---|
| C1 | Chrome live captions | Any sentence | Words appear in Live transcription within about 1 s | |
| C2 | Full reference | "Turn with me to John chapter three verse sixteen" | John 3:16 projected | |
| C3 | Numbers as words, misheard numbers | "Romans eight twenty-eight", then "Matthew eleven thirty-five" | Romans 8:28 projected; for Matthew 11:35 (doesn't exist) the closest real verses are offered in the queue, nothing wrong is projected | |
| C4 | Several references in one sentence | "Read Philippians four thirteen and then Isaiah forty thirty-one" | Philippians 4:13, then Isaiah 40:31 | |
| C5 | Split phrases | "Let's turn to the book of Romans" … pause … "chapter eight verse twenty-eight" | Romans 8:28 projected | |
| C6 | Next / previous | With John 3:16 up: "next verse", "verse eighteen", "take it back" | 3:17, 3:18, 3:17 | |
| C7 | Reading without false changes | Read John 3:16 aloud slowly, then read into 3:17 | 3:16 stays while it is read; follows to 3:17; no other verse replaces it | |
| C8 | Second listen | Mumble or speak a reference over music | Transcript shows "[ listened again … ]" and the reference if it was heard | |
| C9 | Whisper (Groq) | Setup: GROQ key set; untick nothing. Speak while captions are off (Operator → audio input = Focusrite line) | Transcript shows Whisper lines; references found | |
| C10 | Provider fallback | With an invalid/expired GROQ key and a valid OpenAI key (if you have one) | Operator notes Groq failed and OpenAI was used; or, with no backup, a clear message and manual search still works | |
| C11 | Quotes wait in the queue | Quote "for God so loved the world that he gave his only begotten Son" without naming it | John 3:16 appears in the queue (not projected automatically, by design since v1.11.1) | |
| C12 | Bible story | "When Abraham took Isaac up the mountain to sacrifice him…" | Story card "Abraham offers Isaac · Genesis 22:1–19"; R shows the reference-only lower third | |

## D. Translation switching by voice

| ID | Check | Say | Expected | Result |
|---|---|---|---|---|
| D1 | By name | With John 3:16 KJV up: "Can we have that in the New King James" | Same verse re-shown in NKJV (badge NKJV), Operator dropdown NKJV | |
| D2 | By code | "Read it in NIV" | Same verse in NIV | |
| D3 | Reference + translation | "Genesis four three in the Amplified" | Genesis 4:3 in AMP | |
| D4 | Range kept | With John 3:16–18 up: "in the Message" | John 3:16–18 in MSG | |
| D5 | Back to KJV | "Let's go back to the King James" | Same verse in KJV | |
| D6 | Unavailable edition | Name an edition you don't have installed | Alert "… requested, but it is unavailable …"; screen and dropdown unchanged; nothing labelled as that edition | |
| D7 | Passage missing from a partial edition | Ask for a book a partial edition doesn't contain, in that edition | Honest message or labelled KJV fallback, never shown under the partial edition's name | |
| D8 | **Every installed edition** | Work through `qa-output/voice-test-list.csv` (made by the catalogue QA command): say the "switch" phrase, then the "reference with edition" phrase | Each edition heard and projected correctly; fill the Y/N columns | |

D8 is the per-edition voice check. The list is generated from your real library, with a reference that edition really contains, so you are never guessing. Doing all 57+ in one sitting takes about 30 to 40 minutes. Any edition that fails, note what Whisper or the captions wrote in the transcript.

## E. During a real service (observe, don't interfere)

| ID | Check | Expected | Result |
|---|---|---|---|
| E1 | Sermon of 30+ minutes | No crash, no page errors, no duplicate verses stacking in the queue | |
| E2 | Setup → Session report afterwards | Success rate, missed references and advice shown; export the day's file for review | |
| E3 | vMix output | Squeeze shrinks the camera when VMIX_URL is set; full-screen and lower-third clean on the stream | |

## What is automated vs what needs you

| Area | Automated (cloud, every change) | Needs you (this plan) |
|---|---|---|
| Reference recognition, cues, split phrases, reading lock, stale-result guard | Yes, text fed to the real detection route and Operator page | Real voice and captions (C) |
| Translation switching logic and honesty | Yes, parser, detection route and Operator page | Real voice per edition (D, D8) |
| 57+ edition catalogue (counts, retrieval, prompt, partial editions) | Runs on your Mac with one command (not in the cloud) | Run the command once |
| Whisper request format, provider fallback | Mocked providers | Real Groq / OpenAI (C9, C10) |
| Audio worklet (voice detection, downmix) | Unit tests on generated audio | Real microphone and Focusrite (B, C) |
| Windows audio link security (pairing token) | Server tests | The physical link (B) |
| Projection modes, footnotes, stories, lyrics, clicker, reconnection | Browser tests with screenshots | vMix rendering (A4, E3) |
| Backup / restore | Both engines, 360 MB timing | One backup on your Mac (A3) |
| Installers | Built and inspected in CI | Native start on Mac / Windows (A1, A2) |

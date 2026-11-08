# Di.Verse: Setup, Step by Step

> **Updating an existing install?** Save the new ZIP to Downloads, double-click it, then in Terminal:
> ```
> cd ~/Downloads/Di.Verse-new
> bash install.sh
> ```
> It keeps your keys, Bibles and songs, keeps the old version as `Desktop/Di.Verse-previous`, installs and starts. The Operator page shows the running version (e.g. `v1.4.0`) in the header.

For a Mac (Windows notes are in brackets). It takes about 20 minutes the first time.

---

## What it costs

| Service | What it does in Di.Verse | Cost for the beta |
|---|---|---|
| **Groq** | Live transcription (Whisper), AI verse detection, AI verse checks | **Free.** The free tier covers about 8 hours of audio a day (check your exact limits at console.groq.com → Settings → Limits) |
| **Gemini** | Second opinion on TPT/NKJV/AMP wording | **Free** tier |
| Bible text: KJV, ASV, YLT, BBE | Stored on your laptop | **Free**, works offline |
| OpenAI | *Optional* backup if Groq's free limit runs out | Paid from prepaid credit (about $0.006 per minute of audio) |
| Anthropic (Claude) | *Optional* extra detection and opinion | Paid from API credit (a few cents per hour of sermon) |
| API.Bible | *Optional* licensed NKJV/AMP/NIV text | Free for non-commercial use; paid plan needed before you sell |

**For the beta you don't need to pay for anything.** Groq and Gemini on their free tiers cover it.

### About your OpenAI "plan"
- **ChatGPT Plus (monthly) and the OpenAI API are billed separately.** Your ChatGPT subscription does **not** pay for Whisper. Even if you haven't used up your ChatGPT plan, the API can't use it.
- The API runs on **prepaid credit**: you add money and each minute of audio is deducted from it. It isn't monthly.
- **Prepaid API credit expires one year after you bought it.** If the payment you abandoned was over a year ago, that balance is gone.
- To check: platform.openai.com → Settings → Billing shows your credit balance and expiry dates. If it's $0 or expired, either add a few dollars or just use Groq (free). Di.Verse uses Groq first anyway.
- The same applies to Claude: a Claude.ai Pro subscription doesn't include API credit.

---

## Step 1: Install Node.js (once)

1. Go to **nodejs.org** and download the **LTS** version (v22 or newer). Install it.
2. Open **Terminal** (Cmd+Space, type "Terminal") [Windows: open "Command Prompt"].
3. Type `node -v` and press Enter. You should see `v22...` or higher.

## Step 2: Get the code

In Terminal:

```bash
cd ~/Desktop
git clone https://github.com/AndreOmniBarry/Di.Verse.git
cd Di.Verse
git checkout claude/trusting-archimedes-b7qg2u
```

(If you already have the folder: `cd` into it, then `git fetch` and `git checkout claude/trusting-archimedes-b7qg2u`, then `git pull`.)

## Step 3: Install and download the Bibles (once, needs internet)

```bash
npm ci
npm run seed
```

The last line should show KJV, ASV, YLT and BBE with about 31,000 verses each.

## Step 4: Get your free keys

**Groq** (the important one):
1. Go to **console.groq.com** and sign up (Google sign-in works).
2. Open **API Keys** → **Create API Key** → name it `Di.Verse` → copy the key (it starts with `gsk_`).

**Gemini:**
1. Go to **aistudio.google.com/apikey** and sign in with Google.
2. Click **Create API key** → copy it.

Keep both somewhere private. They work like passwords.

## Step 5: Put the keys in `.env`

```bash
cp .env.example .env
open -e .env          # Windows: notepad .env
```

Paste your keys after the `=` signs, with no spaces or quotes:

```
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxx
GEMINI_API_KEY=AIzaxxxxxxxxxxxxxxx
```

Leave the other lines blank unless you have those keys. Save and close.

## Step 6: Check everything works

```bash
npm test
```
It should end with `# fail 0`.

```bash
npm run prefetch -- TPT "John 3:16"
```
- `VERIFIED` or `GROUNDED`: AI verse lookup is working.
- `UNVERIFIED`: it works but only one source answered, which is normal if only one key is set.
- `KJV fallback — ...`: the message says which key or limit is the problem.

## Step 7: Start Di.Verse

```bash
npm start
```

Chrome opens the **Operator** page. The Terminal window shows two more addresses:
- **Projection** (`http://<your-ip>:3000/projection`): open it on the projector screen or second display, full screen (Ctrl+Cmd+F on Mac, F11 on Windows).
- **Preacher** (`http://<your-ip>:3000/preacher`): open it on the preacher's phone. The phone must be on the **same Wi-Fi** as the laptop.

## Step 8: First live test

1. On the Operator page, click **Start** and allow the microphone.
2. Say: *"Turn with me to John chapter 3 verse 16."*
3. Within a few seconds the words appear under Live Transcription, the verse appears in the Queue, and it shows on the projector (Auto-push is on).
4. Say: *"Let's read that in the Passion Translation."* The translation switches to TPT.
5. Try a range: *"Romans chapter 8 verses 28 through 30."* All three verses show, numbered.
6. Try a song: add one in **Admin** (`/admin`), then click its slides in the Operator's **Songs** panel.

If something's wrong, the red **ALERT** box on the Operator page says exactly what (for example, "Groq free-tier limit reached", "OpenAI account has no credit", "No transcription key").

---

## Before each service

Load the sermon's verses the night before, so they're instant and work even if the church internet drops:

```bash
npm run prefetch -- TPT "John 3:16; Romans 8:28-30; Psalm 23:1-6"
npm run prefetch -- NKJV "John 3:16; Romans 8:28-30"
```

Anything listed under "Check these before the service" was unconfirmed. Read it against a Bible before Sunday.

## Day-of checklist

- [ ] Laptop on power, `npm start` running
- [ ] Projector page full screen on the second display
- [ ] Preacher phone on the same Wi-Fi, `/preacher` page open
- [ ] Mic or mixer feed connected. The VAD bar on the Operator page moves when someone speaks.
- [ ] Your existing presentation software open as a fallback

## If something goes wrong

| You see | Do this |
|---|---|
| "No transcription key" | Step 4–5: add `GROQ_API_KEY` to `.env`, then stop (Ctrl+C) and `npm start` again |
| "Groq free-tier limit reached" | Wait a minute (per-minute limit) or until tomorrow (daily limit). For long days, add `OPENAI_API_KEY` as a paid backup. Di.Verse switches over automatically. |
| "OpenAI account has no credit" | Add credit at platform.openai.com → Billing, or remove `OPENAI_API_KEY` and use Groq only |
| VAD bar never moves | Check the Mac's sound input (System Settings → Sound → Input) and that Chrome is allowed to use the mic |
| VAD shows SPEECH but nothing is transcribed | Look at the ALERT box and the Terminal window for the error |
| Projector or phone shows "Reconnecting" | Same Wi-Fi? The laptop's firewall must allow Node on port 3000 |
| Wrong translation shown | Pick it in the dropdown at the top. Greyed-out ones show why when you hover over them. |

Changing `.env` always needs a restart: Ctrl+C in Terminal, then `npm start`.

---

## How listening works (speed and accuracy)

- **Live captions (fast path):** Chrome's built-in speech recognition shows the words *while* the preacher speaks. A named verse ("John 3:16") reaches the screen about a second after it's said. This uses Google's speech service through Chrome, so it needs internet. It's free and needs no key.
- **Whisper on Groq (backup):** runs alongside and catches anything the live captions miss. If live captions stop (no internet to Google, blocked mic permission), Whisper takes over automatically, a few seconds slower.
- **Quoted verses:** when the preacher quotes about 8 words of a KJV verse without naming it ("I wish above all things that thou mayest prosper"), it's recognised instantly from the Bible stored on the laptop and shown. About 6–7 words gives an orange suggestion to confirm.
- **Misheard numbers:** if the reference heard ("1st John 1:2") and the words quoted (3 John 1:2) differ only by the number in front of the book, the quoted verse is shown.
- **Other translations (TPT, NKJV, AMP…):** AI wording is shown **only** when two independent AI sources give the same words, or when it was found by a web search. Otherwise KJV is shown with a note saying why. Made-up wording never reaches the screen. Use `npm run prefetch` before the service so sermon verses are ready and instant.

---

## Livestream (OBS, vMix, Ecamm…)

Add Di.Verse to the stream as a **browser source** with the overlay address. The page is transparent, so only the verse box shows over the camera:

- Streaming software on the **same laptop** as Di.Verse: `http://localhost:3000/projection?overlay=1`
- Streaming software on **another computer** on the same network: `http://<laptop-ip>:3000/projection?overlay=1` (the IP is printed in Terminal when Di.Verse starts)

**OBS:** Sources → **+** → **Browser** → paste the URL, set Width **1920** and Height **1080**, leave "Custom CSS" as it is, then OK. Put the source above your camera in the list.

**vMix, step by step:**
1. Start Di.Verse on the laptop (`npm start`).
2. In vMix: **Add Input** (bottom left) → **Web Browser**.
3. URL: `http://localhost:3000/projection?overlay=1` if vMix runs on the same laptop, otherwise `http://<laptop-ip>:3000/projection?overlay=1` (the IP is printed in Terminal when Di.Verse starts; both computers on the same network).
4. Size **1920 × 1080** → **OK**. The new input looks empty or black until a verse is pushed; that's the transparent part.
5. Under that input, click overlay button **1**. Di.Verse now sits on top of whatever is in Program. Leave it on for the whole service: when nothing is pushed it's invisible.
6. Push a verse from the Operator page and check it appears over the camera in Program.
7. If the verse appears on a black box instead of over the camera, open the input's settings (cog) and make sure transparency isn't turned off, then right-click the input → **Refresh**.

The Wi-Fi lock doesn't affect vMix or OBS: the projection page is open to any computer on the network, only control is locked to the operator laptop.

Use **Lower-Third** mode for the stream (Full-Screen mode deliberately covers the whole picture). The projector and the stream can run at the same time: the projector uses `/projection` (solid background) and the stream uses `/projection?overlay=1`. Both follow every push, clear, theme and font change.

---

## Free tiers, backup keys and long services

- Chrome live captions do the listening and cost nothing. **Whisper double-check** (header switch) is off by default: Whisper then only listens when the live captions aren't working, so Groq's free daily limit lasts all day. Turned on, Whisper checks everything too and uses roughly 4–5 hours of free Groq audio a day.
- **Backup keys:** put several keys in one line, separated by commas: `GROQ_API_KEY=gsk_main,gsk_backup`. When a key hits its limit it rests for 10 minutes and the next one is used in the same moment; a rejected key rests for a day. Works for `GROQ_API_KEY`, `GEMINI_API_KEY` and `OPENAI_API_KEY`. Use keys you're entitled to, for example a colleague's own account with their agreement, or a cheap paid key as the last backup. Creating extra free accounts just to get around the limits breaks the providers' terms and can get all of them blocked.
- `npm start` keeps Di.Verse running: if it ever stops, it restarts within a second and every screen comes back showing what it showed before. The Mac is kept awake while it runs.
- Keep the Operator window **visible** (not minimised or covered by a full-screen app): Chrome slows down timers in hidden tabs.

---

## Squeeze-back: shrink the preacher, big scripture (vMix)

Three caption modes, chosen with the mode button on the Operator page:
- **Lower Third:** the verse across the bottom of the camera picture.
- **Squeeze (UEFA in-game style):** the preacher shrinks to a small framed window at the **top left** (20% of the screen by default: the **Camera** picker also offers 25%, 33% and 46%) and the scripture fills the rest of the screen in a large glass panel.
- **Full Screen:** scripture only, no preacher.

**Every verse fits on one screen, in every mode, however long** (Esther 8:9, 90 words, included). There are never "1/3" pages. Full Screen and Squeeze use the largest text that fits: short verses come up huge, long ones as large as the space allows. The Lower Third keeps your chosen size for ordinary verses, and for a very long verse it grows upward with smaller type.

**Automatic squeeze: vMix shrinks the camera for you, so you don't build any scene.** Set it up once:

1. **Turn on vMix's remote control.** vMix: **Settings → Web Controller** → tick enabled (port **8088**) → OK. If Windows asks whether to allow vMix on the network, allow it on **Private** networks.
2. **Find the vMix PC's address.** On Windows: Start → type `cmd` → Enter → type `ipconfig` → read the **IPv4 Address** (e.g. `192.168.0.120`).
3. **Tell Di.Verse.** On the Di.Verse Mac: `open -e ~/Desktop/Di.Verse/.env` and add one line (your address):
   ```
   VMIX_URL=http://192.168.0.120:8088
   ```
   Save, then restart Di.Verse (Ctrl + C, then `npm start`).
4. **Check the link.** On the Mac open `http://localhost:3000/api/vmix`. It should say `"reachable": true`, `"mode": "automatic"` and name your camera as `live`.
5. In vMix, keep the Di.Verse Web Browser input on **Overlay 1** all the time, with the URL ending `?overlay=1`.
6. **Check the vMix screen itself.** With the vMix input refreshed, `http://localhost:3000/api/vmix` also lists `screens`: one should say `"where": "vMix …"` with its browser version. If anything on that screen goes wrong, the Operator page shows a "Screen problem on vMix…" message and Terminal prints a `[Screen]` line. Send that line to your helper.

From then on: pushing a verse in **Squeeze** mode makes vMix zoom the live camera down into the window at the top left (exactly inside Di.Verse's frame). **✕ Clear**, or showing the next verse in another mode, puts the camera back to full screen. Changing the Camera size while squeezed resizes it live.

*Alternative, a scene of your own:* if you'd rather build a vMix scene with the camera already shrunk, also add `VMIX_SQUEEZE_INPUT=<scene name>`; Di.Verse then fades to that scene and back instead (`VMIX_TRANSITION`, `VMIX_DURATION` set the transition).

Without the vMix link (no `VMIX_URL`), Squeeze still draws the layout and the camera stays full size behind it.

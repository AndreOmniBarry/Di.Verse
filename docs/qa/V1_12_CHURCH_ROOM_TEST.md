# v1.12 church-room validation

Run on the church computers before release. Record the result of each step (pass, fail and what happened) in the table at the end. Use a disposable copy of the data folder if you want to keep the live sermon history clean. The Bible database is never written by these features.

## Setup

1. Start Di.Verse (`npm start`, or the installed app) on the operator laptop.
2. Open the Operator page, the projector (`/projection`) and the preacher monitor (`/preacher`).
3. In vMix, keep the Web Browser input at `/projection?overlay=1`, with `VMIX_URL` set (SETUP.md, "Automatic squeeze").
4. Run the vMix output at 1920 × 1080. Repeat steps 14 to 17 at 3840 × 2160 if the church outputs 4K.

## Sermon notes (live microphone)

5. Start listening. Have someone read: "Today's message is titled walking in divine purpose." A title suggestion appears in Live Control within about 2 seconds.
6. Read: "Point number one, God has a plan for your life. As Jeremiah 29 11 says." A "Point 1" suggestion appears, with Jeremiah 29:11 attached as *spoken*.
7. Read: "Number three, obedience opens doors." The suggestion has no reference (never Numbers 3).
8. Read: "Write this down." Pause. "Delay is not denial." A highlight appears with the second sentence.
9. Read ordinary sermon talk for a minute ("Jesus is number one in my life", "turn with me to John 3"). No notes are suggested.
10. Push a verse. Approve the point and **Show** it. The note appears at the top of the projector, the preacher monitor and vMix. The verse stays. The camera does not move.
11. Press **H**. The note goes, and the verse stays on every screen.
12. Show the title. It disappears by itself after 10 seconds. **Show** replays it.
13. Refresh the Operator page. Every note is still listed, with its wording and status.

## Virtual set and vMix

14. Virtual Set → "Teaching: Navy and Gold" → **Sample verse**. The preview changes; the projector and vMix do not. **Take live**. All screens change to the cinematic layout, and the mode button reads "Cinematic teaching".
15. Take "Split: Preacher Left" live and push a verse. vMix zooms the live camera into the left window; the camera picture sits exactly inside the frame. Switch to "Split: scripture left, preacher right" (Scripture → Display mode). The camera moves to the right without returning to full screen first.
16. Change the split ratio of the live profile and **Take live**. The camera window resizes in vMix.
17. Switch to Squeeze. The camera goes to the top-left window at the Squeeze camera size, as in v1.11. Press **Clear**. The camera returns to full screen.
18. Take "Livestream Overlay" live. In vMix, the lower third sits over the camera with the camera visible around it (transparent background).
19. Leave vMix open, restart Di.Verse. The vMix input comes back with the live profile and what was on screen.

## Operator speed

20. During a rehearsal, run a whole service segment from the keyboard: Alt+1..7, `/`, Space, the arrow keys, R, H, M and Esc. No control is out of reach, and the Push button and queue stay visible in every section.

## Results

| Step | Result | Notes |
|---|---|---|
| 5–9 | | |
| 10–13 | | |
| 14–19 | | |
| 20 | | |

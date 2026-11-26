#!/bin/bash
# Di.Verse.app — what runs when you double-click the app.
# Starts Di.Verse in the background (if it isn't already running) and opens
# the Operator page in Google Chrome. Live captions need Chrome.
# Your keys, Bibles and songs: ~/Library/Application Support/Di.Verse
# Log: ~/Library/Application Support/Di.Verse/logs/diverse.log

CONTENTS="$(cd "$(dirname "$0")/.." && pwd)"
RES="$CONTENTS/Resources"
DATA="$HOME/Library/Application Support/Di.Verse"
LOG="$DATA/logs/diverse.log"
URL="http://localhost:3000/operator"
mkdir -p "$DATA/logs"

case "$(uname -m)" in
  arm64) NODE="$RES/node-arm64/node" ;;
  *)     NODE="$RES/node-x64/node" ;;
esac

EXPECTED_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$CONTENTS/Info.plist" 2>/dev/null || true)"
running_version() {
  curl -fsS --max-time 2 http://localhost:3000/api/version 2>/dev/null |
    sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}

open_operator() {
  if [ -d "/Applications/Google Chrome.app" ] || [ -d "$HOME/Applications/Google Chrome.app" ]; then
    open -a "Google Chrome" "$URL"
  else
    open "$URL"
    osascript -e 'display dialog "Di.Verse is running.\n\nInstall Google Chrome for live captions (the fastest listening) — other browsers can only use the slower Whisper listening." buttons {"OK"} default button 1 with title "Di.Verse"' >/dev/null 2>&1 &
  fi
}

CURRENT_VERSION="$(running_version)"
if [ -n "$CURRENT_VERSION" ]; then
  if [ "$CURRENT_VERSION" = "$EXPECTED_VERSION" ]; then open_operator; exit 0; fi

  # An older app may still own port 3000 after the user replaces the bundle.
  # Ask it to stop cleanly so its supervisor exits too, then start this version.
  echo "=== $(date) — updating running Di.Verse $CURRENT_VERSION to $EXPECTED_VERSION ===" >> "$LOG"
  if ! curl -fsS --max-time 3 -X POST http://localhost:3000/api/shutdown >/dev/null 2>&1; then
    osascript -e 'display dialog "Another Di.Verse version is still running on port 3000, but it could not be stopped safely. Stop it from its own Settings page, then open Di.Verse again." buttons {"OK"} default button 1 with title "Di.Verse update" with icon caution' >/dev/null 2>&1
    exit 1
  fi
  for i in $(seq 1 80); do
    [ -z "$(running_version)" ] && break
    sleep 0.25
  done
  if [ -n "$(running_version)" ]; then
    osascript -e 'display dialog "The previous Di.Verse server did not stop. Your data is safe; stop the older app from its Settings page and try again." buttons {"OK"} default button 1 with title "Di.Verse update" with icon caution' >/dev/null 2>&1
    exit 1
  fi
fi

# First launch on a Mac that ran the Terminal version: bring its keys,
# Bibles (including any imported) and songs across. The old folder is untouched.
OLD="$HOME/Desktop/Di.Verse"
if [ ! -f "$DATA/.env" ] && [ -f "$OLD/.env" ]; then
  mkdir -p "$DATA/db"
  cp "$OLD/.env" "$DATA/.env"
  for f in "$OLD"/db/bible.db* "$OLD"/db/songs.db*; do [ -f "$f" ] && cp "$f" "$DATA/db/"; done
  echo "=== $(date) — copied keys, Bibles and songs from $OLD ===" >> "$LOG"
fi

# keep the log from growing forever over months of services
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG" 2>/dev/null || echo 0)" -gt 5000000 ]; then mv -f "$LOG" "$LOG.old"; fi

export DIVERSE_DATA="$DATA"
export DIVERSE_BUNDLED_DB="$RES/bible.db"
export DIVERSE_NO_BROWSER=1
cd "$RES/app" || exit 1
echo "=== $(date) — starting Di.Verse ===" >> "$LOG"
nohup "$NODE" scripts/supervisor.js >> "$LOG" 2>&1 &

for i in $(seq 1 80); do
  if running; then open_operator; exit 0; fi

  sleep 0.25
done

osascript -e 'display dialog "Di.Verse did not start.\n\nIs another program using port 3000? The details are in:\n~/Library/Application Support/Di.Verse/logs/diverse.log" buttons {"Open log", "OK"} default button 2 with title "Di.Verse" with icon caution' -e 'if button returned of result is "Open log" then do shell script "open -e " & quoted form of (POSIX path of (path to home folder) & "Library/Application Support/Di.Verse/logs/diverse.log")' >/dev/null 2>&1
exit 1

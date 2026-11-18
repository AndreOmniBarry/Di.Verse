#!/bin/bash
# Di.Verse installer — puts this downloaded copy on the Desktop as "Di.Verse",
# keeping your keys (.env), Bibles and songs from the copy you already have.
#
#   cd ~/Downloads/Di.Verse-new
#   bash install.sh
#
# Your previous version is kept as Desktop/Di.Verse-previous.

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Desktop/Di.Verse"
PREV="$HOME/Desktop/Di.Verse-previous"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m%s\033[0m\n\n' "$1"; exit 1; }

[ -f "$SRC/server.js" ] || fail "This doesn't look like a Di.Verse folder."
[ "$SRC" = "$DEST" ] && fail "This copy is already the installed one. Just run: npm start"

# Stop a running Di.Verse first (it would hold the old folder)
if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  say "Stopping the Di.Verse that's running..."
  pkill -f "node .*Di.Verse.*/(server|scripts/supervisor)\.js" 2>/dev/null
  pkill -f "node scripts/supervisor.js" 2>/dev/null
  sleep 2
fi

# Where are the keys, Bibles and songs? The installed copy, else the previous one
OLD=""
for d in "$DEST" "$PREV"; do
  if [ -f "$d/.env" ]; then OLD="$d"; break; fi
done

say "Copying your keys, Bibles and songs..."
if [ -n "$OLD" ]; then
  cp "$OLD/.env" "$SRC/.env" && echo "  ✓ keys (.env) from $(basename "$OLD")"
  for f in "$OLD"/db/bible.db* "$OLD"/db/songs.db*; do
    [ -f "$f" ] && cp "$f" "$SRC/db/" && echo "  ✓ $(basename "$f")"
  done
  # session reports (Settings → Session report)
  if [ -d "$OLD/logs" ]; then cp -R "$OLD/logs" "$SRC/" && echo "  ✓ session reports"; fi
else
  [ -f "$SRC/.env" ] || cp "$SRC/.env.example" "$SRC/.env"
  echo "  ! No previous copy found — you'll need to add your keys: open -e ~/Desktop/Di.Verse/.env"
fi

say "Swapping in the new version..."
if [ -d "$DEST" ]; then
  rm -rf "$PREV"
  mv "$DEST" "$PREV" && echo "  ✓ old version kept as Desktop/Di.Verse-previous"
fi
mv "$SRC" "$DEST" || fail "Couldn't move the new folder to the Desktop."
echo "  ✓ new version is Desktop/Di.Verse"
cd "$DEST" || exit 1

say "Installing (about 20 seconds)..."
npm ci --no-audit --no-fund || fail "Install failed — send the lines above to your helper."

if [ ! -f db/bible.db ]; then
  say "Downloading the Bibles (first time only, about a minute)..."
  npm run seed || fail "Bible download failed — check the internet and run: npm run seed"
fi

# Free modern translations (about a second each); skipped if already there
if ! node -e "process.exit(require('./services/library').list().installed.some(m=>m.code==='BSB')?0:1)" >/dev/null 2>&1; then
  say "Adding free modern translations (BSB, WEB)..."
  npm run -s bibles -- add BSB WEB || echo "  ! Couldn't download them now — add them later in Admin → Bibles"
fi

say "Done — Di.Verse v$(node -p "require('./package.json').version") is installed. Starting it now."
echo "  (Next time, just: cd ~/Desktop/Di.Verse && npm start)"
npm start

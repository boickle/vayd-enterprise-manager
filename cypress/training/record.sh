#!/bin/bash
# Record one narrated training video on the running TEST stack (see README.md).
#
#   record.sh <spec name> <voice> <final .mp4>
#     spec name: emr-v6-wrap-up   (cypress/training/<name>.cy.ts + narration/<name>.json)
#     voice:     "Samantha" (free Mac voice, for dry runs) or "openai:nova" (final take)
#
# Work files go to $TRAINING_WORK/<spec name> (default ~/.vayd-training). Frames for checking: frames/.
set -euo pipefail
NAME="$1"; VOICE="$2"; FINAL="$3"
HERE="$(cd "$(dirname "$0")" && pwd)"; FE="$(cd "$HERE/../.." && pwd)"
WORK="${TRAINING_WORK:-$HOME/.vayd-training}"; E="$WORK/stack"; OUT="$WORK/$NAME"
API_DIR="${API_DIR:?Set API_DIR to the vayd-api checkout the stack runs}"
[ -f "$E/world.json" ] || { echo "No $E/world.json: start the stack first (stack/stack-up.sh)"; exit 1; }
mkdir -p "$OUT"; rm -rf "$OUT/videos" "$OUT/frames"
bash "$HERE/make-voice.sh" "$HERE/narration/$NAME.json" "$VOICE" "$OUT"
cd "$FE"
env -u ELECTRON_RUN_AS_NODE TRAINING_NARRATION="$OUT/narration.json" TRAINING_OUT="$OUT" \
  CYPRESS_BASE_URL=http://localhost:5210 CYPRESS_API_URL=http://localhost:3210 \
  CYPRESS_SCHEDULING_WORLD="$(cat "$E/world.json")" CYPRESS_EMAIL_CAPTURE_PATH="$E/emails.jsonl" \
  CYPRESS_SCH_API_DIR="$API_DIR" CYPRESS_SCH_DB=vayd_api_test_e2e CYPRESS_SCH_SMS_CAPTURE="$E/sms.jsonl" \
  npx cypress run --browser electron --config-file cypress.training.config.ts \
  --spec "cypress/training/$NAME.cy.ts" > "$OUT/run.log" 2>&1 || { tail -40 "$OUT/run.log"; exit 1; }
bash "$HERE/assemble.sh" "$OUT" "$FINAL"
# A frame every 10 seconds, for a quick look without watching the whole video.
mkdir -p "$OUT/frames"
ffmpeg -hide_banner -loglevel error -i "$FINAL" -vf fps=1/10,scale=960:-2 "$OUT/frames/f%03d.jpg"
echo "frames: $OUT/frames"

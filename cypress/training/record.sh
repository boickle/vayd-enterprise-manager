#!/bin/bash
# Record one narrated training video on the running TEST stack (see README.md).
#
#   record.sh <spec name> <voice> <final .mp4>
#     spec name: emr-v6-wrap-up   (cypress/training/<name>.cy.ts + narration/<name>.json)
#     voice:     "openai:nova" (normal; clips are cached by text, so re-takes only pay for changed lines)
#                or a Mac voice such as "Samantha"
#
# Work files go to $TRAINING_WORK/<spec name> (default ~/.vayd-training). Frames for checking: frames/.
# On failure it prints only the error and saves a small screenshot (fail.jpg). On success it prints how far
# each click lands into the line that names it.
set -euo pipefail
NAME="$1"; VOICE="$2"; FINAL="$3"
HERE="$(cd "$(dirname "$0")" && pwd)"; FE="$(cd "$HERE/../.." && pwd)"
WORK="${TRAINING_WORK:-$HOME/.vayd-training}"; E="$WORK/stack"; OUT="$WORK/$NAME"
API_DIR="${API_DIR:?Set API_DIR to the vayd-api checkout the stack runs}"; export API_DIR
[ -f "$E/world.json" ] || { echo "No $E/world.json: start the stack first (stack/stack-up.sh)"; exit 1; }
# Sign-in tokens in world.json last 4 hours. Restart the stack well before that.
if [ $(( $(date +%s) - $(stat -f %m "$E/world.json") )) -gt 12600 ]; then
  echo "Stack tokens are over 3.5 h old: restarting the stack"
  bash "$HERE/stack/stack-down.sh" >/dev/null 2>&1 || true
  bash "$HERE/stack/stack-up.sh" | tail -1
fi
mkdir -p "$OUT"; rm -rf "$OUT/videos" "$OUT/frames" "$OUT/screenshots" "$OUT/fail.jpg"
bash "$HERE/make-voice.sh" "$HERE/narration/$NAME.json" "$VOICE" "$OUT"
cd "$FE"
if ! env -u ELECTRON_RUN_AS_NODE TRAINING_NARRATION="$OUT/narration.json" TRAINING_OUT="$OUT" \
  CYPRESS_BASE_URL=http://localhost:5210 CYPRESS_API_URL=http://localhost:3210 \
  CYPRESS_SCHEDULING_WORLD="$(cat "$E/world.json")" CYPRESS_EMAIL_CAPTURE_PATH="$E/emails.jsonl" \
  CYPRESS_SCH_API_DIR="$API_DIR" CYPRESS_SCH_DB=vayd_api_test_e2e CYPRESS_SCH_SMS_CAPTURE="$E/sms.jsonl" \
  npx cypress run --browser electron --config-file cypress.training.config.ts \
  --spec "cypress/training/$NAME.cy.ts" > "$OUT/run.log" 2>&1; then
  echo "FAILED. Error:"
  grep -m1 -A6 -E "AssertionError|CypressError|Error:" "$OUT/run.log" | grep -v "^\s*$" | head -8
  SHOT=$(find "$OUT/screenshots" -name "*.png" 2>/dev/null | head -1)
  # Crop away the Cypress command log and shrink, so the screenshot is cheap to look at.
  [ -n "$SHOT" ] && ffmpeg -hide_banner -loglevel error -y -i "$SHOT" -vf "crop=iw*0.8:ih:iw*0.2:0,scale=1000:-2" "$OUT/fail.jpg" \
    && echo "screenshot: $OUT/fail.jpg"
  exit 1
fi
bash "$HERE/assemble.sh" "$OUT" "$FINAL"
python3 -I - "$OUT/marks.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1])); clicks = m.pop("__clicks", []); m.pop("__frame", None); m.pop("__cuts", None)
starts = sorted((v, k) for k, v in m.items())
late = []
for t in clicks:
    s, k = max(x for x in starts if x[0] <= t)
    if (t - s) / 1000 > 2.0: late.append(f"{k} +{(t - s) / 1000:.1f}s")
print(f"clicks: {len(clicks)}, all within 2 s of their line" if not late else "LATE CLICKS: " + ", ".join(late))
PY
# A small frame every 10 seconds, for a quick look without watching the whole video.
mkdir -p "$OUT/frames"
ffmpeg -hide_banner -loglevel error -i "$FINAL" -vf fps=1/10,scale=800:-2 "$OUT/frames/f%03d.jpg"
echo "frames: $OUT/frames"

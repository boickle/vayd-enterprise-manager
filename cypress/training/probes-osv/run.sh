#!/bin/bash
# Run one OSV probe against this session's training stack (no voice). Local, not committed.
#   bash cypress/training/probes-osv/run.sh osv01-portal-shopping
set -e
source ~/.vayd-osv-env.sh
cd "$(dirname "$0")/../../.."
free=$(memory_pressure | tail -1 | grep -oE '[0-9]+%' | tr -d %)
if [ "${free:-0}" -lt 20 ]; then echo "Memory free ${free}% < 20%: stopping"; exit 3; fi
OUT="$TRAINING_WORK/probes"; mkdir -p "$OUT"
env -u ELECTRON_RUN_AS_NODE \
  CYPRESS_BASE_URL=http://localhost:$TRAINING_APP_PORT CYPRESS_API_URL=http://localhost:$TRAINING_API_PORT \
  CYPRESS_SCH_DB=$TRAINING_DB CYPRESS_SCHEDULING_WORLD="$(cat $TRAINING_WORK/stack/world.json)" \
  CYPRESS_OSV_WORLD="$(cat $TRAINING_WORK/osv-world.json)" CYPRESS_OSV_OUT="$OUT" TRAINING_OUT="$OUT" \
  npx cypress run ${OSV_BROWSER:+--browser $OSV_BROWSER} --config-file cypress.training.config.ts --spec "cypress/training/probes-osv/$1.cy.ts" \
  --config video=false,screenshotsFolder="$OUT/shots" > "$OUT/$1.log" 2>&1 || true
grep -E "│ (✔|✖)|AssertionError|CypressError|Error:" "$OUT/$1.log" | head -8
ls "$OUT/shots/$1.cy.ts" 2>/dev/null | head -30
# Cypress empties the screenshots folder at the start of every run: keep a copy per probe, with small versions.
SRC="$OUT/screenshots/$1.cy.ts"; DEST="$TRAINING_WORK/shots/$1"
if [ -d "$SRC" ]; then rm -rf "$DEST"; mkdir -p "$DEST/small"; cp "$SRC"/*.png "$DEST/" 2>/dev/null; for f in "$DEST"/*.png; do sips -Z 1100 "$f" --out "$DEST/small/$(basename "$f")" >/dev/null; done; echo "shots: $DEST"; fi

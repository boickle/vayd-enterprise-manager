#!/bin/bash
# Run one permissions probe spec (no voice, no video) against the perm training stack.
#   bash cypress/training/probes-perm/run-probe.sh p01-menus [PROBE_WHO=a,b]
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; FE="$(cd "$HERE/../../.." && pwd)"
source "$HERE/../stack/stack-env.sh"
E="$TRAINING_WORK/stack"; OUT="$TRAINING_WORK/probes"; mkdir -p "$OUT"
cd "$FE"
env -u ELECTRON_RUN_AS_NODE PGPASSWORD=vayd PGHOST=localhost PGUSER=vayd TRAINING_OUT="$OUT/cy" CYPRESS_BASE_URL=http://localhost:$TRAINING_APP_PORT CYPRESS_API_URL=http://localhost:$TRAINING_API_PORT \
  CYPRESS_SCHEDULING_WORLD="$(cat "$E/world.json")" CYPRESS_PERM_WORLD="$(cat "$E/perm.json")" CYPRESS_PROBE_OUT="$OUT" CYPRESS_PAID_INVOICE="$(cat "$E/paid-invoice.txt" 2>/dev/null)" \
  CYPRESS_PROBE_WHO="${PROBE_WHO:-}" CYPRESS_SCH_DB=$TRAINING_DB CYPRESS_EMAIL_CAPTURE_PATH="$E/emails.jsonl" \
  nice -n 10 npx cypress run --config-file cypress.training.config.ts --config video=false --spec "cypress/training/probes-perm/$1.cy.ts" > "$OUT/$1.log" 2>&1; grep -E "✓|✖|[0-9]+\) |Error|failing|passing" "$OUT/$1.log" | head -40

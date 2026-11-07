#!/bin/bash
# Stop the training TEST stack started by stack-up.sh.
source "$(cd "$(dirname "$0")" && pwd)/stack-env.sh"
S="$TRAINING_WORK/stack"
for f in api vite stripe osrm; do [ -f "$S/$f.pid" ] && { pkill -P "$(cat "$S/$f.pid")" 2>/dev/null; kill "$(cat "$S/$f.pid")" 2>/dev/null; rm -f "$S/$f.pid"; }; done
for p in $TRAINING_API_PORT $TRAINING_APP_PORT $TRAINING_STRIPE_PORT $TRAINING_OSRM_PORT; do pid=$(lsof -nP -t -iTCP:$p -sTCP:LISTEN 2>/dev/null); [ -n "$pid" ] && kill $pid; done
echo down

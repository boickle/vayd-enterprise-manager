#!/bin/bash
# Stop the training TEST stack started by stack-up.sh.
S="${TRAINING_WORK:-$HOME/.vayd-training}/stack"
for f in api vite stripe osrm; do [ -f "$S/$f.pid" ] && { pkill -P "$(cat "$S/$f.pid")" 2>/dev/null; kill "$(cat "$S/$f.pid")" 2>/dev/null; rm -f "$S/$f.pid"; }; done
for p in 3210 5210 4010 4020; do pid=$(lsof -nP -t -iTCP:$p -sTCP:LISTEN 2>/dev/null); [ -n "$pid" ] && kill $pid; done
echo down

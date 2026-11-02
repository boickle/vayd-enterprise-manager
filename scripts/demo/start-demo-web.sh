#!/bin/bash
# Starts the website for the DEMO: http://localhost:5174, talking to the demo API on port 3100.
cd "$(dirname "$0")/../.." || exit 1
echo "== Demo website: http://localhost:5174  (demo API: http://localhost:3100) =="
VITE_API_BASE_URL=http://localhost:3100 exec npx vite --port 5174 --strictPort

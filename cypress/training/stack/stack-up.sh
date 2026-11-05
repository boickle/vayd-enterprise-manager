#!/bin/bash
# Start the isolated TEST stack for training videos: a fresh copy of the test database, the seeded demo world
# with demo names, fake Stripe and fake OSRM, the API (no scheduled jobs, email captured, SMS/Gmail keys blank)
# on :3210 and Vite on :5210. Nothing here can reach a real client.
#
#   API_DIR=<vayd-api checkout> stack-up.sh
# Work files: ${TRAINING_WORK:-~/.vayd-training}/stack (world.json, logs, captured email).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; FE="$(cd "$HERE/../../.." && pwd)"
API="${API_DIR:?Set API_DIR to the vayd-api checkout}"
S="${TRAINING_WORK:-$HOME/.vayd-training}/stack"; DB=vayd_api_test_e2e
mkdir -p "$S"; export PGPASSWORD=vayd
for p in 3210 5210 4010 4020; do if lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1; then echo "port $p busy (stack-down.sh?)"; exit 1; fi; done
psql -h localhost -U vayd -d postgres -q -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB TEMPLATE vayd_api_test_base OWNER vayd"
cd "$API"
(MIGRATION_DB_NAME=$DB NODE_OPTIONS=--no-experimental-strip-types npm run -s migration:run > "$S/migrate.log" 2>&1)
rm -f tsconfig.build.tsbuildinfo tsconfig.tsbuildinfo; npx nest build > "$S/build.log" 2>&1
rm -f "$S/world.json"; : > "$S/emails.jsonl"; : > "$S/stripe.jsonl"; : > "$S/sms.jsonl"
NODE_ENV=test NODE_OPTIONS=--no-experimental-strip-types npx ts-node -T test/scripts/scheduling-e2e-seed.ts seed $DB "$S/world.json" > "$S/seed.log" 2>&1
bash "$HERE/demo-names.sh" $DB "$S/world.json" > "$S/demo-names.log" 2>&1
(PORT=4020 nohup node test/scripts/e2e-fake-osrm.js > "$S/osrm.log" 2>&1 & echo $! > "$S/osrm.pid")
(PORT=4010 STRIPE_LOG="$S/stripe.jsonl" nohup node test/scripts/e2e-fake-stripe.js > "$S/stripe.log" 2>&1 & echo $! > "$S/stripe.pid")
(redis-cli -n 9 flushdb >/dev/null; PORT=3210 REDIS_URL=redis://127.0.0.1:6379/9 OSRM_URL=http://127.0.0.1:4020 ROUTING_PROVIDER=osrm \
  DB_DATABASE=$DB MIGRATION_DB_NAME=$DB DISABLE_SCHEDULED_JOBS=true STRIPE_API_BASE=http://127.0.0.1:4010 \
  E2E_API_DIR="$API" EMAIL_CAPTURE_PATH="$S/emails.jsonl" APPOINTMENT_REQUEST_TEST_EMAIL=deirdre@vetatyourdoor.com \
  APPOINTMENT_REQUEST_TEST_SMS= ROOM_LOADER_TEST_SMS= OPENPHONE_API_KEY= GMAIL_SMTP_PASS= GMAIL_SMTP_USER= GMAIL_OAUTH_CLIENT_SECRET= \
  NODE_OPTIONS="--require $API/test/scripts/e2e-capture-preload.js" nohup node dist/main.js > "$S/api.log" 2>&1 & echo $! > "$S/api.pid")
cd "$FE"
(VITE_API_BASE_URL=http://localhost:3210 nohup npx vite --port 5210 --strictPort > "$S/vite.log" 2>&1 & echo $! > "$S/vite.pid")
for i in $(seq 1 90); do curl -s -o /dev/null http://localhost:3210/health && curl -s -o /dev/null http://localhost:5210 && break; sleep 2; done
echo "up: API :3210 (DB $DB), app :5210. Work files: $S"

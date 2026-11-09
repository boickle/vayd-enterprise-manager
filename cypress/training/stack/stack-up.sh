#!/bin/bash
# Start the isolated TEST stack for training videos: a fresh copy of the test database, the seeded demo world
# with demo names, fake Stripe and fake OSRM, the API (no scheduled jobs, email captured, SMS/Gmail keys blank)
# on :3210 and Vite on :5210. Nothing here can reach a real client.
#
#   API_DIR=<vayd-api checkout> stack-up.sh
# Work files: ${TRAINING_WORK:-~/.vayd-training}/stack (world.json, logs, captured email).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; FE="$(cd "$HERE/../../.." && pwd)"
source "$HERE/stack-env.sh"
API="${API_DIR:?Set API_DIR to the vayd-api checkout}"
S="$TRAINING_WORK/stack"; DB="$TRAINING_DB"
mkdir -p "$S"; export PGPASSWORD=vayd
for p in $TRAINING_API_PORT $TRAINING_APP_PORT $TRAINING_STRIPE_PORT $TRAINING_OSRM_PORT; do if lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1; then echo "port $p busy (stack-down.sh?)"; exit 1; fi; done
psql -h localhost -U vayd -d postgres -q -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB TEMPLATE vayd_api_test_base OWNER vayd"
cd "$API"
(MIGRATION_DB_NAME=$DB NODE_OPTIONS=--no-experimental-strip-types npm run -s migration:run > "$S/migrate.log" 2>&1)
rm -f tsconfig.build.tsbuildinfo tsconfig.tsbuildinfo; npx nest build > "$S/build.log" 2>&1
rm -f "$S/world.json"; : > "$S/emails.jsonl"; : > "$S/stripe.jsonl"; : > "$S/sms.jsonl"
NODE_ENV=test NODE_OPTIONS=--no-experimental-strip-types npx ts-node -T test/scripts/scheduling-e2e-seed.ts seed $DB "$S/world.json" > "$S/seed.log" 2>&1
bash "$HERE/demo-names.sh" $DB "$S/world.json" > "$S/demo-names.log" 2>&1
(PORT=$TRAINING_OSRM_PORT nohup node test/scripts/e2e-fake-osrm.js > "$S/osrm.log" 2>&1 & echo $! > "$S/osrm.pid")
# Stripe: the fake at :4010 by default. TRAINING_STRIPE=test uses Stripe's own test mode instead (the card
# fields load from stripe.com), with the sk_test_ key in $API/.env. Never a live key.
STRIPE_BASE=http://127.0.0.1:$TRAINING_STRIPE_PORT
if [ "${TRAINING_STRIPE:-fake}" = test ]; then
  grep -q '^STRIPE_SECRET_KEY=sk_test_' "$API/.env" || { echo "Refusing: $API/.env has no sk_test_ STRIPE_SECRET_KEY"; exit 2; }
  STRIPE_BASE=https://api.stripe.com
else
  (PORT=$TRAINING_STRIPE_PORT STRIPE_LOG="$S/stripe.jsonl" nohup node test/scripts/e2e-fake-stripe.js > "$S/stripe.log" 2>&1 & echo $! > "$S/stripe.pid")
fi
# Texts: off (no key) unless TRAINING_SMS_CAPTURE=1, which records every OpenPhone send in sms.jsonl instead of sending.
SMS_KEY=; SMS_FROM=; SMS_PRELOAD=
if [ "${TRAINING_SMS_CAPTURE:-0}" = 1 ]; then SMS_KEY=captured-not-real; SMS_FROM=+19195550100; SMS_PRELOAD=" --require $HERE/sms-capture-preload.cjs"; fi
# IDEXX: off by default. TRAINING_IDEXX=sandbox uses IDEXX's sandbox practice (a demo, not live; owner, Nov 8, 2026),
# from the commented "# IDEXX_..." lines in $API/.env. The API only honours it on a test database with the control
# database off (vayd-api src/idexx/idexx-test-sandbox.ts). Values are read here, never printed.
IDEXX_ENV=()
if [ "${TRAINING_IDEXX:-off}" = sandbox ]; then
  for k in IDEXX_PIMS_ID IDEXX_PIMS_VERSION IDEXX_VCP_USERNAME IDEXX_VCP_PASSWORD IDEXX_ORDERING_BASE_URL IDEXX_RESULTS_BASE_URL; do
    v="$(sed -n "s/^#[[:space:]]*$k=//p" "$API/.env" | head -1)"; [ -z "$v" ] && v="$(sed -n "s/^$k=//p" "$API/.env" | head -1)"
    [ -n "$v" ] && IDEXX_ENV+=("$k=$v")
  done
  IDEXX_ENV+=("IDEXX_TEST_SANDBOX=true" "IDEXX_RESULTS_SYNC_ENABLED=false")
fi
# CONTROL_DB_ENABLED=false: the shared control database would otherwise hand this stack the real Gmail, OpenPhone,
# Stripe and IDEXX secrets. GMAIL_POLL_INTERVAL_MS=0: no mailbox polling.
(redis-cli -n $TRAINING_REDIS_DB flushdb >/dev/null; env "${IDEXX_ENV[@]}" CONTROL_DB_ENABLED=false GMAIL_POLL_INTERVAL_MS=0 PORT=$TRAINING_API_PORT REDIS_URL=redis://127.0.0.1:6379/$TRAINING_REDIS_DB OSRM_URL=http://127.0.0.1:$TRAINING_OSRM_PORT ROUTING_PROVIDER=osrm \
  DB_DATABASE=$DB MIGRATION_DB_NAME=$DB DISABLE_SCHEDULED_JOBS=true STRIPE_API_BASE=$STRIPE_BASE \
  E2E_API_DIR="$API" EMAIL_CAPTURE_PATH="$S/emails.jsonl" APPOINTMENT_REQUEST_TEST_EMAIL=deirdre@vetatyourdoor.com \
  APPOINTMENT_REQUEST_TEST_SMS= ROOM_LOADER_TEST_SMS= OPENPHONE_API_KEY=$SMS_KEY OPENPHONE_FROM=$SMS_FROM SMS_REMINDERS_FROM=$SMS_FROM SMS_TEST_NUMBER=9195550199 \
  SMS_CAPTURE_PATH="$S/sms.jsonl" GMAIL_SMTP_PASS= GMAIL_SMTP_USER= GMAIL_OAUTH_CLIENT_SECRET= GMAIL_OAUTH_CLIENT_ID= GMAIL_TOKEN_ENCRYPTION_KEY= GMAIL_PUBSUB_TOPIC= \
  NODE_OPTIONS="--require $API/test/scripts/e2e-capture-preload.js$SMS_PRELOAD" nohup node dist/main.js > "$S/api.log" 2>&1 & echo $! > "$S/api.pid")
cd "$FE"
(VITE_API_BASE_URL=http://localhost:$TRAINING_API_PORT nohup npx vite ${TRAINING_VITE_CONFIG:+--config $TRAINING_VITE_CONFIG} --port $TRAINING_APP_PORT --strictPort > "$S/vite.log" 2>&1 & echo $! > "$S/vite.pid")
for i in $(seq 1 90); do curl -s -o /dev/null http://localhost:$TRAINING_API_PORT/health && curl -s -o /dev/null http://localhost:$TRAINING_APP_PORT && break; sleep 2; done
echo "up: API :$TRAINING_API_PORT (DB $DB), app :$TRAINING_APP_PORT. Work files: $S"

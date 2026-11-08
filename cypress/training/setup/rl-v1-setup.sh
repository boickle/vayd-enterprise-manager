#!/bin/bash
# Room Loader video (rl-v1) setup on the TEST stack. Run by rl-v1-room-loader.cy.ts before the clock starts.
#   rl-v1-setup.sh <db> <api dir> <maple id> <juniper id>
# 1. The starter Room Loader settings (src/utils/roomLoaderConfigSeed.ts) become the practice's settings.
# 2. Catalog items those settings point at are made by vayd-api's room-loader e2e seed (names as in the real
#    catalog), then given real catalog prices, read-only from vayd_api_local (catalog only, no client data).
# 3. setup/rl-v1.sql: the Riveras' ages, reminders, a wellness visit item and the trip fee.
# 4. setup/rl-v1-plans.py: the real Foundations membership plans.
set -euo pipefail
DB="$1"; API="$2"; MAPLE="$3"; JUNIPER="$4"
case "$DB" in vayd_api_test*) ;; *) echo "Refusing: $DB is not a vayd_api_test* database"; exit 2;; esac
HERE="$(cd "$(dirname "$0")" && pwd)"; FE="$(cd "$HERE/../../.." && pwd)"
W="${TMPDIR:-/tmp}/rl-v1-setup-$$"; mkdir -p "$W"; trap 'rm -rf "$W"' EXIT
export PGPASSWORD=vayd
cd "$FE"
npx esbuild src/utils/roomLoaderConfigSeed.ts --bundle --platform=node --format=cjs --outfile="$W/seed.cjs" --log-level=error
node -e "require('fs').writeFileSync('$W/doc.json', JSON.stringify(require('$W/seed.cjs').vaydRoomLoaderConfigSeed()))"
echo '{"species":"dog","ageMonths":48}' > "$W/scn.json"
cd "$API"
NODE_ENV=test NODE_OPTIONS=--no-experimental-strip-types ROOM_LOADER_SEED_DOC="$W/doc.json" \
  npx ts-node -T test/scripts/room-loader-e2e-seed.ts seed "$DB" "$W/out.json" "$W/scn.json" > "$W/seed.log" 2>&1 \
  || { cat "$W/seed.log"; exit 1; }
# Real prices for the seeded codes.
: > "$W/prices.sql"
for t in labs inventory_items procedures; do
  codes=$(psql -h localhost -U vayd "$DB" -tA -c "select string_agg(quote_literal(code), ',') from $t where \"pimsType\"='RLTEST'")
  [ -n "$codes" ] || continue
  psql -h localhost -U vayd vayd_api_local -tA -F'|' -c "select distinct on (code) code, price from $t where code in ($codes) and price is not null and not coalesce(\"isDeleted\",false) order by code, id desc" \
    | while IFS='|' read -r c p; do echo "update $t set price=$p where code='$c' and \"pimsType\"='RLTEST';" >> "$W/prices.sql"; done
done
psql -h localhost -U vayd "$DB" -q -f "$W/prices.sql"
echo "delete from room_loader_config where \"practiceId\"=1; insert into room_loader_config (\"practiceId\", config) values (1, :'doc'::jsonb);" \
  | psql -h localhost -U vayd "$DB" -q -v doc="$(cat "$W/doc.json")"
psql -h localhost -U vayd -d "$DB" -q -v maple="$MAPLE" -v juniper="$JUNIPER" -v practice=1 -f "$HERE/rl-v1.sql"
# 4. The practice's real Foundations plans (plan definitions only), so the membership pitch shows real coverage.
python3 "$HERE/rl-v1-plans.py" "$DB"
# Settings are cached by the API; the training stack's Redis db is set by stack/stack-env.sh.
[ -n "${TRAINING_REDIS_DB:-}" ] && redis-cli -n "$TRAINING_REDIS_DB" flushdb >/dev/null
echo "rl-v1 setup done"

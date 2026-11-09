#!/bin/bash
# Membership videos: Stripe TEST-mode objects for the demo plans and members. Refuses anything but an sk_test_ key.
#
#   stripe-mem.sh prices <API dir> <test db>
#       Gives each copied plan (pimsType MEM_TRAINING) a test-mode product and price (monthly or annual, the plan's
#       own price), and writes the price ids onto the plan. Price ids are cached in $TRAINING_WORK/stripe-prices.json
#       so a restarted stack reuses them instead of making new ones.
#   stripe-mem.sh sub <API dir> <email> <name> <price id> [<payment method, default pm_card_visa>]
#       A test-mode customer (found by email, or made) with the test card attached and set as default, and a
#       subscription on the price. Prints "<customer id> <subscription id>".
set -euo pipefail
CMD="$1"; API="$2"
KEY=$(grep -E '^STRIPE_SECRET_KEY=sk_test_' "$API/.env" | head -1 | cut -d= -f2- | tr -d '"' || true)
[ -n "$KEY" ] || { echo "Refusing: no sk_test_ STRIPE_SECRET_KEY in $API/.env" >&2; exit 2; }
st() { curl -s "https://api.stripe.com/v1/$1" -u "$KEY:" "${@:2}"; }
js() { python3 -I -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {}, {'d': d}))" "$1"; }

case "$CMD" in
prices)
  DB="$3"; case "$DB" in vayd_api_test*) ;; *) echo "Refusing: $DB is not a vayd_api_test* database" >&2; exit 2;; esac
  CACHE="${TRAINING_WORK:-$HOME/.vayd-training}/stripe-prices.json"; [ -f "$CACHE" ] || echo '{}' > "$CACHE"
  export PGPASSWORD=vayd
  psql -h localhost -U vayd -d "$DB" -AtF'|' -c "select id, name, \"billingCadence\", coalesce(\"priceMonthly\", \"priceAnnual\", price) from packages where \"pimsType\"='MEM_TRAINING' and not \"isArchived\"" |
  while IFS='|' read -r id name cadence amount; do
    key="$name|$cadence|$amount"
    price=$(python3 -I -c "import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2], ''))" "$CACHE" "$key")
    if [ -z "$price" ]; then
      prod=$(st products -d "name=$name (VAYD training)" -d "metadata[source]=vayd-training" | js "d['id']")
      interval=month; [ "$cadence" = annual ] && interval=year
      cents=$(python3 -I -c "print(round(float('$amount')*100))")
      price=$(st prices -d product="$prod" -d currency=usd -d unit_amount="$cents" -d "recurring[interval]=$interval" -d "metadata[source]=vayd-training" | js "d['id']")
      python3 -I -c "import json,sys; f=sys.argv[1]; c=json.load(open(f)); c[sys.argv[2]]=sys.argv[3]; json.dump(c, open(f,'w'), indent=1)" "$CACHE" "$key" "$price"
    fi
    col='"stripeMonthlyPriceId"'; [ "$cadence" = annual ] && col='"stripeAnnualPriceId"'
    psql -h localhost -U vayd -d "$DB" -qc "update packages set $col='$price' where id=$id"
  done
  echo "prices set"
  ;;
sub)
  EMAIL="$3"; NAME="$4"; PRICE="$5"; PM="${6:-pm_card_visa}"
  CUS=$(st customers -G --data-urlencode "email=$EMAIL" -d limit=1 | js "d['data'][0]['id'] if d.get('data') else ''")
  [ -n "$CUS" ] || CUS=$(st customers -d email="$EMAIL" -d name="$NAME" -d "metadata[source]=vayd-training" | js "d['id']")
  PMID=$(st "payment_methods/$PM/attach" -d customer="$CUS" | js "d['id']")
  st "customers/$CUS" -d "invoice_settings[default_payment_method]=$PMID" > /dev/null
  SUB=$(st subscriptions -d customer="$CUS" -d "items[0][price]=$PRICE" -d "default_payment_method=$PMID" -d "metadata[source]=vayd-training" | js "d['id']")
  echo "$CUS $SUB"
  ;;
pastdue)
  # stripe-mem.sh pastdue <API dir> <subscription id> <amount dollars>
  # Leaves a missed payment on the subscription: its card becomes Stripe's always-declining test card, and an
  # invoice for the amount is created and fails, so it stays open (unpaid) like a failed monthly charge.
  SUB="$3"; AMOUNT="$4"
  CUS=$(st "subscriptions/$SUB" -G | js "d['customer']")
  BAD=$(st "payment_methods/pm_card_chargeCustomerFail/attach" -d customer="$CUS" | js "d['id']")
  st "subscriptions/$SUB" -d "default_payment_method=$BAD" > /dev/null
  st "customers/$CUS" -d "invoice_settings[default_payment_method]=$BAD" > /dev/null
  CENTS=$(python3 -I -c "print(round(float('$AMOUNT')*100))")
  st invoiceitems -d customer="$CUS" -d subscription="$SUB" -d amount="$CENTS" -d currency=usd -d "description=Missed membership payment (training)" > /dev/null
  INV=$(st invoices -d customer="$CUS" -d subscription="$SUB" -d collection_method=charge_automatically | js "d['id']")
  st "invoices/$INV/finalize" -X POST > /dev/null
  st "invoices/$INV/pay" -X POST > /dev/null || true
  STATUS=$(st "invoices/$INV" -G | js "d['status']")
  echo "$INV $STATUS"
  ;;
*) echo "usage: stripe-mem.sh prices|sub|pastdue ..." >&2; exit 2;;
esac

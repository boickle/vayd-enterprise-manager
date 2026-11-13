#!/bin/bash
# INV-20: a Stripe TEST-mode customer with the test Visa attached, and a test subscription billed on that card
# (Maple's membership), so Replace card shows "Maple's membership is billed on a different card".
#   stripe-inv20.sh <API dir> <email> <name>   → prints "<customer id> <payment method id> <subscription id>"
# Refuses anything but an sk_test_ key. The product and price are cached in $TRAINING_WORK/stripe-inv20-price.
set -euo pipefail
KEY=$(grep -E '^STRIPE_SECRET_KEY=sk_test_' "$1/.env" | head -1 | cut -d= -f2- | tr -d '"' || true)
[ -n "$KEY" ] || { echo "Refusing: no sk_test_ STRIPE_SECRET_KEY in $1/.env" >&2; exit 2; }
st() { curl -s "https://api.stripe.com/v1/$1" -u "$KEY:" "${@:2}"; }
id() { python3 -I -c 'import json,sys; d=json.load(sys.stdin); print(d["id"])'; }
CACHE="${TRAINING_WORK:-$HOME/.vayd-training}/stripe-inv20-price"
PRICE=$(cat "$CACHE" 2>/dev/null || true)
if [ -z "$PRICE" ]; then
  PROD=$(st products -d "name=Membership - Adult - Annual (VAYD training)" -d "metadata[source]=vayd-training" | id)
  PRICE=$(st prices -d product="$PROD" -d currency=usd -d unit_amount=49900 -d "recurring[interval]=year" -d "metadata[source]=vayd-training" | id)
  echo "$PRICE" > "$CACHE"
fi
CUS=$(st customers -d email="$2" -d name="$3" -d "metadata[source]=vayd-training" | id)
PM=$(st payment_methods/pm_card_visa/attach -d customer="$CUS" | id)
st "customers/$CUS" -d "invoice_settings[default_payment_method]=$PM" > /dev/null
SUB=$(st subscriptions -d customer="$CUS" -d "items[0][price]=$PRICE" -d "default_payment_method=$PM" -d "metadata[source]=vayd-training" | id)
echo "$CUS $PM $SUB"

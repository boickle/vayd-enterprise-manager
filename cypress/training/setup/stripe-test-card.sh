#!/bin/bash
# A Stripe TEST-mode customer with Stripe's test Visa attached, for a demo hold (V10).
#   stripe-test-card.sh <API dir> <email> <name> [pm_card_visa]   → (4th: a Stripe test payment method, e.g. pm_card_chargeCustomerFail for a card that declines)
#   prints "<customer id> <payment method id>"
# Refuses anything but an sk_test_ key.
set -euo pipefail
KEY=$(grep -E '^STRIPE_SECRET_KEY=sk_test_' "$1/.env" | head -1 | cut -d= -f2- | tr -d '"' || true)
[ -n "$KEY" ] || { echo "Refusing: no sk_test_ STRIPE_SECRET_KEY in $1/.env" >&2; exit 2; }
PMT="${4:-pm_card_visa}"
CUS=$(curl -s https://api.stripe.com/v1/customers -u "$KEY:" -d email="$2" -d name="$3" -d "metadata[source]=vayd-training" | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["id"])')
PM=$(curl -s https://api.stripe.com/v1/payment_methods/$PMT/attach -u "$KEY:" -d customer="$CUS" | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["id"])')
echo "$CUS $PM"

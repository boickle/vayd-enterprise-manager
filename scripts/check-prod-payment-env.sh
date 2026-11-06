#!/usr/bin/env bash
# Refuses a non-QA frontend build that would ship Square or a test Stripe key (PAY-05).
#
# Usage: scripts/check-prod-payment-env.sh <build-mode>
#   Run from the frontend repo root, the directory whose .env files Vite reads.
#   <build-mode> "qa" is not checked. Any other mode (production) must have:
#     - VITE_STRIPE_PUBLISHABLE_KEY starting with pk_live_
#     - VITE_PAYMENT_PROVIDER equal to stripe (case-insensitive, unset means Square is NOT used)
#
# Values resolve the way Vite resolves them: shell environment first, then
# .env.<mode>.local, .env.<mode>, .env.local, .env (first file that sets the key wins).
# Exits 0 when the build may proceed, 1 with a message on stderr otherwise.
set -euo pipefail

mode="${1:-production}"
if [[ "$mode" == "qa" ]]; then
  exit 0
fi

# Prints the value Vite would use for $1 (empty if none). Quotes and surrounding spaces are removed.
env_value() {
  local key="$1" file line value
  if [[ -n "${!key+x}" ]]; then
    printf '%s' "${!key}"
    return 0
  fi
  for file in ".env.${mode}.local" ".env.${mode}" ".env.local" ".env"; do
    [[ -f "$file" ]] || continue
    line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=" "$file" | tail -n 1 || true)"
    [[ -n "$line" ]] || continue
    value="${line#*=}"
    value="$(printf '%s' "$value" | sed -E 's/\r$//; s/^[[:space:]]+//; s/[[:space:]]+$//')"
    case "$value" in
      \"*\") value="${value#\"}"; value="${value%\"}" ;;
      \'*\') value="${value#\'}"; value="${value%\'}" ;;
      *) value="$(printf '%s' "$value" | sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//')" ;;
    esac
    printf '%s' "$value"
    return 0
  done
  printf ''
}

errors=()

key="$(env_value VITE_STRIPE_PUBLISHABLE_KEY)"
if [[ "$key" != pk_live_* ]]; then
  if [[ -z "$key" ]]; then
    found="VITE_STRIPE_PUBLISHABLE_KEY is not set"
  else
    found="VITE_STRIPE_PUBLISHABLE_KEY is not a live key (found a key starting ${key%%_*}_)"
  fi
  errors+=("Production build needs a live Stripe key (pk_live_): $found")
fi

provider="$(env_value VITE_PAYMENT_PROVIDER | tr '[:upper:]' '[:lower:]')"
if [[ "$provider" != "stripe" ]]; then
  if [[ -z "$provider" ]]; then
    found="unset"
  else
    found="'$provider'"
  fi
  errors+=("Production build needs VITE_PAYMENT_PROVIDER=stripe (found $found; unset would build Square)")
fi

if (( ${#errors[@]} > 0 )); then
  for message in "${errors[@]}"; do
    echo "ERROR: $message" >&2
  done
  echo "Checked shell env, then .env.${mode}.local, .env.${mode}, .env.local, .env in $(pwd)." >&2
  exit 1
fi

echo "Payment env OK for $mode build (Stripe live key, provider stripe)."

#!/bin/bash
# Ports, database and work folder for one training TEST stack. Sourced by stack-up.sh, stack-down.sh and record.sh.
# The defaults are the original single stack. To run a second stack alongside it (another training session), set
# all of these first, for example:
#   export TRAINING_DB=vayd_api_test_sched TRAINING_API_PORT=3220 TRAINING_APP_PORT=5220 \
#          TRAINING_STRIPE_PORT=4011 TRAINING_OSRM_PORT=4021 TRAINING_REDIS_DB=10 TRAINING_WORK=~/.vayd-training-sched
# The database must start with vayd_api_test (the seed refuses anything else). The voice cache stays shared.
TRAINING_DB="${TRAINING_DB:-vayd_api_test_e2e}"
TRAINING_API_PORT="${TRAINING_API_PORT:-3210}"
TRAINING_APP_PORT="${TRAINING_APP_PORT:-5210}"
TRAINING_STRIPE_PORT="${TRAINING_STRIPE_PORT:-4010}"
TRAINING_OSRM_PORT="${TRAINING_OSRM_PORT:-4020}"
TRAINING_REDIS_DB="${TRAINING_REDIS_DB:-9}"
TRAINING_WORK="${TRAINING_WORK:-$HOME/.vayd-training}"
case "$TRAINING_DB" in vayd_api_test*) ;; *) echo "Refusing: TRAINING_DB=$TRAINING_DB is not a vayd_api_test* database"; exit 2;; esac
export TRAINING_DB TRAINING_API_PORT TRAINING_APP_PORT TRAINING_STRIPE_PORT TRAINING_OSRM_PORT TRAINING_REDIS_DB TRAINING_WORK

#!/usr/bin/env bash
set -euo pipefail

# ============================
# Config (override via env)
# ============================
REPO_DIR="${REPO_DIR:-$(pwd)}"                    # Path to your frontend repo
REMOTE="${REMOTE:-origin}"                        # Git remote name
BRANCH="${BRANCH:-main}"                          # Branch to deploy
GIT_AUTO_STASH="${GIT_AUTO_STASH:-false}"         # true|false -> stash dirty changes before pull

BUCKET="${BUCKET:-vayd-tools}"                    # S3 bucket name
DISTRIBUTION_ID="${DISTRIBUTION_ID:-EORC9GBUJCQ8A}"  # CloudFront distribution ID
BUILD_DIR="${BUILD_DIR:-dist}"                    # Build output dir (Vite default)
INVALIDATE_ALL="${INVALIDATE_ALL:-false}"         # true|false — default only index.html
EXTRA_INVALIDATE_PATHS="${EXTRA_INVALIDATE_PATHS:-}" # e.g. "/config.json /favicon.ico"
SKIP_BUILD="${SKIP_BUILD:-false}"                 # true to skip npm build step
AWS_PROFILE="${AWS_PROFILE:-}"                    # optional: set an AWS profile
AWS_REGION="${AWS_REGION:-us-east-1}"             # CF API region (certs live in us-east-1)

# ============================
# Helpers
# ============================
say() { echo -e "\033[1;36m==>\033[0m $*"; }
die() { echo -e "\033[1;31mERROR:\033[0m $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "Missing dependency: $1"; }

need git
need aws
if [[ "$SKIP_BUILD" != "true" ]]; then need npm; fi
[[ -n "${AWS_PROFILE}" ]] && export AWS_PROFILE
export AWS_REGION

REF="${1:-${REF:-$BRANCH}}"
[[ "$REF" =~ ^[A-Za-z0-9._/-]+$ ]] || die "Ref must be a branch or tag name: $REF"
case "$REF" in
  *..*) die "Ref must be a branch or tag name: $REF" ;;
esac
say "Publishing $REF to s3://${BUCKET} (distribution ${DISTRIBUTION_ID})"

# ============================
# Git: fetch latest main
# ============================
say "Switching to repo: $REPO_DIR"
cd "$REPO_DIR"

# Ensure it's a git repo
[[ -d .git ]] || die "Not a git repository: $REPO_DIR"

# Optional auto-stash if working tree dirty
if [[ "$GIT_AUTO_STASH" == "true" ]] && { ! git diff --quiet || ! git diff --cached --quiet; }; then
  say "Working tree dirty; stashing before pull..."
  git stash push -u -m "deploy_frontend_s3.sh auto-stash $(date -u +%FT%TZ)"
  AUTO_STASHED="true"
else
  AUTO_STASHED="false"
fi

say "Fetching $REF from $REMOTE..."
git fetch --prune "$REMOTE" --tags
if git show-ref --verify --quiet "refs/remotes/${REMOTE}/${REF}"; then
  if git show-ref --verify --quiet "refs/heads/${REF}"; then
    git checkout "$REF"
  else
    git checkout -b "$REF" "${REMOTE}/${REF}"
  fi
  git pull --ff-only "$REMOTE" "$REF"
elif git show-ref --verify --quiet "refs/tags/${REF}"; then
  say "Checking out tag $REF"
  git checkout --detach "refs/tags/${REF}"
else
  die "No branch or tag named $REF on $REMOTE"
fi

# ============================
# Build
# ============================
if [[ "$SKIP_BUILD" != "true" ]]; then
  if [[ -n "${VITE_API_BASE_URL:-}" ]]; then
    say "API URL for this build: $VITE_API_BASE_URL"
  elif [[ -f .env.production.local ]]; then
    say "API URL for this build comes from .env.production.local"
  else
    die "Set VITE_API_BASE_URL or add .env.production.local before building"
  fi
  say "Installing deps & building..."
  npm ci --prefer-offline || npm install
  npm run build
fi
[[ -d "$BUILD_DIR" ]] || die "Build dir not found: $BUILD_DIR"

# ============================
# Upload to S3 with good caching
# ============================
say "Syncing static assets with long cache..."
if [[ -d "$BUILD_DIR/assets" ]]; then
  aws s3 sync "$BUILD_DIR/assets/" "s3://${BUCKET}/assets/" \
    --delete \
    --cache-control "public, max-age=31536000, immutable"
fi

say "Uploading remaining files..."
aws s3 sync "$BUILD_DIR/" "s3://${BUCKET}/" \
  --delete \
  --exclude "assets/*"

# Ensure HTML entry points get short/no cache
for html in index.html 200.html; do
  if [[ -f "$BUILD_DIR/$html" ]]; then
    say "Setting short cache on $html..."
    aws s3 cp "$BUILD_DIR/$html" "s3://${BUCKET}/$html" \
      --cache-control "no-cache, max-age=60" \
      --content-type "text/html; charset=utf-8"
  fi
done

# ============================
# CloudFront invalidation
# ============================
say "Creating CloudFront invalidation..."
if [[ "$INVALIDATE_ALL" == "true" ]]; then
  PATHS='/*'
else
  PATHS="/index.html"
  for p in $EXTRA_INVALIDATE_PATHS; do PATHS="$PATHS $p"; done
fi

# shellcheck disable=SC2086
aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths $PATHS >/dev/null

say "Deploy complete"
echo "Ref: $REF @ $REMOTE"
echo "Bucket: s3://${BUCKET}"
echo "Distribution: ${DISTRIBUTION_ID}"
echo "Invalidated: ${PATHS}"

if [[ "$AUTO_STASHED" == "true" ]]; then
  echo "Note: your local changes were stashed. Review with: git stash list"
fi

#!/usr/bin/env bash
set -euo pipefail

# ============================
# Usage / Args
# ============================
usage() {
  cat <<EOF
Usage: $(basename "$0") [branch-name]

If branch-name is provided, that branch or release tag will be deployed.
Otherwise, BRANCH env var is used, defaulting to 'main'.

Examples:
  $(basename "$0")
  $(basename "$0") feature/new-header
  $(basename "$0") release-2.1.7.9

Optional env overrides:
  REPO_DIR=/path/to/repo
  REMOTE=origin
  BRANCH=main
  GIT_AUTO_STASH=true
  BUILD_DIR=dist
  INVALIDATE_ALL=false
  EXTRA_INVALIDATE_PATHS="/config.json /favicon.ico"
  SKIP_BUILD=false
  AWS_PROFILE=myprofile
  AWS_REGION=us-east-1
  NODE_HEAP_MB=3072

Publishes to s3://vayd-tools-qa (distribution E1GTH89B31SU8D).
The build uses .env.qa.local (--mode qa). It does not publish to vayd-tools.
EOF
}

if [[ "${1-}" == "-h" || "${1-}" == "--help" ]]; then
  usage
  exit 0
fi

# ============================
# Config (override via env)
# ============================
REPO_DIR="${REPO_DIR:-$(pwd)}"
REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
GIT_AUTO_STASH="${GIT_AUTO_STASH:-false}"

BUCKET=vayd-tools-qa
DISTRIBUTION_ID=E1GTH89B31SU8D
BUILD_DIR="${BUILD_DIR:-dist}"
INVALIDATE_ALL="${INVALIDATE_ALL:-false}"
EXTRA_INVALIDATE_PATHS="${EXTRA_INVALIDATE_PATHS:-}"
SKIP_BUILD="${SKIP_BUILD:-false}"
AWS_PROFILE="${AWS_PROFILE:-}"
AWS_REGION="${AWS_REGION:-us-east-1}"

# Node heap for large Vite/Rollup builds
NODE_HEAP_MB="${NODE_HEAP_MB:-3072}"

# Positional arg overrides BRANCH
if [[ $# -gt 0 ]]; then
  BRANCH="$1"
fi

[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "Ref must be a branch or tag name: $BRANCH" >&2; exit 1; }
case "$BRANCH" in
  *..*) echo "Ref must be a branch or tag name: $BRANCH" >&2; exit 1 ;;
esac

# ============================
# Helpers
# ============================
say() { echo -e "\033[1;36m==>\033[0m $*"; }
warn() { echo -e "\033[1;33mWARN:\033[0m $*"; }
die() { echo -e "\033[1;31mERROR:\033[0m $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "Missing dependency: $1"; }

restore_stash_notice() {
  if [[ "${AUTO_STASHED:-false}" == "true" ]]; then
    echo "Note: your local changes were stashed. Review with: git stash list"
  fi
}
trap restore_stash_notice EXIT

need git
need aws
if [[ "$SKIP_BUILD" != "true" ]]; then
  need npm
  need node
fi

[ "$BUCKET" != "vayd-tools" ] || die "Refusing to publish to the production bucket"
[ "$DISTRIBUTION_ID" != "EORC9GBUJCQ8A" ] || die "Refusing to publish to the production CloudFront distribution"

if [[ -n "$AWS_PROFILE" ]]; then
  export AWS_PROFILE
fi
export AWS_REGION

# ============================
# Repo setup
# ============================
say "Switching to repo: $REPO_DIR"
cd "$REPO_DIR"

[[ -d .git ]] || die "Not a git repository: $REPO_DIR"

# ============================
# Optional stash
# ============================
AUTO_STASHED="false"
if [[ "$GIT_AUTO_STASH" == "true" ]]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    say "Working tree dirty; stashing before branch update..."
    git stash push -u -m "deploy_frontend_qa.sh auto-stash $(date -u +%FT%TZ)"
    AUTO_STASHED="true"
  fi
fi

# ============================
# Git update
# ============================
say "Fetching remote '$REMOTE'..."
git fetch --prune "$REMOTE" --tags

if git show-ref --verify --quiet "refs/remotes/${REMOTE}/${BRANCH}"; then
  say "Checking out branch '$BRANCH'..."
  if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git checkout "$BRANCH"
  else
    git checkout -b "$BRANCH" "$REMOTE/$BRANCH"
  fi

  say "Pulling latest '$BRANCH' from '$REMOTE'..."
  git pull --ff-only "$REMOTE" "$BRANCH"
elif git show-ref --verify --quiet "refs/tags/${BRANCH}"; then
  say "Checking out release '$BRANCH'..."
  git checkout --detach "refs/tags/${BRANCH}"
else
  die "No branch or tag named $BRANCH on $REMOTE"
fi

# ============================
# Build
# ============================
if [[ "$SKIP_BUILD" != "true" ]]; then
  [[ -f .env.qa.local ]] || die "Missing .env.qa.local. Restore it from the secret vayd/qa/frontend-env."

  say "Installing dependencies..."
  if ! npm ci --prefer-offline; then
    warn "npm ci failed, falling back to npm install"
    npm install
  fi

  # Preserve any existing NODE_OPTIONS, but ensure heap size is present.
  if [[ "${NODE_OPTIONS:-}" == *"--max-old-space-size="* ]]; then
    say "Using existing NODE_OPTIONS=$NODE_OPTIONS"
  else
    export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=${NODE_HEAP_MB}"
    export NODE_OPTIONS="${NODE_OPTIONS#"${NODE_OPTIONS%%[![:space:]]*}"}"
    say "Using NODE_OPTIONS=$NODE_OPTIONS"
  fi

  say "Building frontend for qa from .env.qa.local..."
  npm run build -- --mode qa
else
  say "Skipping build because SKIP_BUILD=true"
fi

[[ -d "$BUILD_DIR" ]] || die "Build dir not found: $BUILD_DIR"

# ============================
# Upload hashed assets with long cache
# ============================
if [[ -d "$BUILD_DIR/assets" ]]; then
  say "Syncing assets/ with long cache headers..."
  aws s3 sync "$BUILD_DIR/assets/" "s3://${BUCKET}/assets/" \
    --delete \
    --cache-control "public, max-age=31536000, immutable"
else
  warn "No assets directory found at $BUILD_DIR/assets"
fi

# ============================
# Upload remaining files
# ============================
say "Syncing remaining build files..."
aws s3 sync "$BUILD_DIR/" "s3://${BUCKET}/" \
  --delete \
  --exclude "assets/*"

# ============================
# Force low cache for HTML entry points
# ============================
for html in index.html 200.html; do
  if [[ -f "$BUILD_DIR/$html" ]]; then
    say "Uploading $html with short cache headers..."
    aws s3 cp "$BUILD_DIR/$html" "s3://${BUCKET}/$html" \
      --cache-control "no-cache, max-age=60" \
      --content-type "text/html; charset=utf-8"
  fi
done

# ============================
# CloudFront invalidation
# ============================
say "Creating CloudFront invalidation..."

INVALIDATION_PATHS=()
if [[ "$INVALIDATE_ALL" == "true" ]]; then
  INVALIDATION_PATHS=("/*")
else
  INVALIDATION_PATHS=("/index.html")
  if [[ -n "$EXTRA_INVALIDATE_PATHS" ]]; then
    # shellcheck disable=SC2206
    EXTRA_PATH_ARRAY=($EXTRA_INVALIDATE_PATHS)
    INVALIDATION_PATHS+=("${EXTRA_PATH_ARRAY[@]}")
  fi
fi

aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "${INVALIDATION_PATHS[@]}" >/dev/null

# ============================
# Done
# ============================
say "Deploy complete"
echo "Branch: $BRANCH @ $REMOTE"
echo "Bucket: s3://${BUCKET}"
echo "Distribution: ${DISTRIBUTION_ID}"
echo "Build dir: ${BUILD_DIR}"
echo "Invalidated: ${INVALIDATION_PATHS[*]}"
if [[ "$SKIP_BUILD" != "true" ]]; then
  echo "Node heap: ${NODE_HEAP_MB} MB"
fi

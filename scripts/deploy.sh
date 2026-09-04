#!/usr/bin/env bash
# Deploy this app to Embarko (https://hostnsoft.com/doc).
#
# Usage:
#   export DEPLOY_TOKEN="hns_..."      # from https://hostnsoft.com/app/tokens
#   ./scripts/deploy.sh                # prompts for confirmation before upload
#   ./scripts/deploy.sh --yes          # skip the confirmation prompt (CI)
#   ./scripts/deploy.sh --dry-run      # package + list files, upload nothing
#
# Packaging uses `git archive HEAD`, so ONLY git-tracked files are shipped.
# This is deliberate: .env / .env.bak hold live API keys and are untracked,
# so they cannot leak into the tarball. Do not switch this to `tar -C . .`
# (the pattern in Embarko's own quick start) -- that would include them.

set -euo pipefail

APP_NAME="${APP_NAME:-avataar}"
DEPLOY_HOST="${DEPLOY_HOST:-https://ship.hostnsoft.com}"
ENDPOINT="$DEPLOY_HOST/apps"

ASSUME_YES=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y)   ASSUME_YES=1 ;;
    --dry-run)  DRY_RUN=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

die() { echo "error: $*" >&2; exit 1; }

# --- preflight ---------------------------------------------------------------

[[ -n "${DEPLOY_TOKEN:-}" ]] || die "DEPLOY_TOKEN is not set.
  Create one at https://hostnsoft.com/app/tokens, then:
    export DEPLOY_TOKEN=\"hns_...\""

[[ "$DEPLOY_TOKEN" == hns_* ]] || echo "warning: DEPLOY_TOKEN does not start with 'hns_' -- Embarko tokens are hns_-prefixed." >&2

[[ "$APP_NAME" =~ ^[a-z0-9-]+$ ]] || die "APP_NAME '$APP_NAME' must match ^[a-z0-9-]+\$ (lowercase letters, numbers, dashes)."

git rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository -- packaging relies on git archive."

# Explicit unique version; docs warn a floating/reused tag can serve a stale build.
VERSION="$(git rev-parse --short HEAD)"
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  VERSION="${VERSION}-dirty"
  echo "note: working tree has uncommitted changes."
  echo "      git archive ships COMMITTED state only -- uncommitted edits will NOT deploy."
fi

# --- package -----------------------------------------------------------------

TARBALL="$(mktemp -t "${APP_NAME}".XXXXXX)".tar.gz
cleanup() { rm -f "$TARBALL"; }
trap cleanup EXIT

git archive --format=tar.gz -o "$TARBALL" HEAD

echo
echo "Deploying to Embarko"
echo "  endpoint : POST $ENDPOINT"
echo "  app name : $APP_NAME   -> https://${APP_NAME}.app.hostnsoft.com"
echo "  version  : $VERSION"
echo "  tarball  : $(du -h "$TARBALL" | cut -f1)"
echo

# Fail loudly rather than silently shipping a secret, in case a .env ever gets committed.
if git archive --format=tar HEAD | tar -tf - | grep -qE '(^|/)\.env($|\.)'; then
  die "a .env file is git-tracked and would be uploaded. Remove it from the index first:
    git rm --cached .env && echo '.env*' >> .gitignore"
fi

echo "Files to be uploaded ($(git archive --format=tar HEAD | tar -tf - | grep -vc '/$') files):"
git archive --format=tar HEAD | tar -tf - | grep -v '/$' | sed 's/^/  /'
echo

if [[ "$DRY_RUN" == 1 ]]; then
  echo "--dry-run: nothing uploaded."
  exit 0
fi

if [[ "$ASSUME_YES" != 1 ]]; then
  printf 'Upload the above to %s? [y/N] ' "$ENDPOINT"
  read -r reply
  [[ "$reply" == [yY] ]] || { echo "aborted."; exit 1; }
fi

# --- deploy ------------------------------------------------------------------

RESPONSE_BODY="$(mktemp)"
trap 'rm -f "$TARBALL" "$RESPONSE_BODY"' EXIT

HTTP_CODE="$(curl -sS -m 300 -X POST "$ENDPOINT" \
  -H "Authorization: Bearer $DEPLOY_TOKEN" \
  -H "X-App-Name: $APP_NAME" \
  -H "X-App-Version: $VERSION" \
  -F "source=@${TARBALL}" \
  -o "$RESPONSE_BODY" -w '%{http_code}')"

BODY="$(cat "$RESPONSE_BODY")"

# Branch on the machine-readable `code` field, not on `error` wording (docs: wording can change).
CODE=""
if command -v python3 >/dev/null 2>&1; then
  CODE="$(python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("code") or "")
except Exception: print("")' <<<"$BODY" 2>/dev/null || true)"
fi

if [[ "$HTTP_CODE" == 2* ]]; then
  echo "$BODY"
  echo
  URL="$(python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("url") or "")
except Exception: print("")' <<<"$BODY" 2>/dev/null || true)"
  [[ -n "$URL" ]] && echo "Live at: $URL"
  exit 0
fi

echo "Deploy failed (HTTP $HTTP_CODE)" >&2
echo "$BODY" >&2
echo >&2
case "$CODE" in
  unauthorized)     echo "-> DEPLOY_TOKEN is missing, invalid, or revoked. Reissue at https://hostnsoft.com/app/tokens" >&2 ;;
  invalid_app_name) echo "-> APP_NAME must match ^[a-z0-9-]+\$" >&2 ;;
  app_name_taken)   echo "-> '$APP_NAME' is taken by another company (names are unique platform-wide). Try: APP_NAME=${APP_NAME}-app $0" >&2 ;;
  app_name_check_failed) echo "-> Transient upstream check failure. Safe to retry." >&2 ;;
  invalid_app_version)   echo "-> X-App-Version must match ^[a-zA-Z0-9._-]+\$ (got '$VERSION')." >&2 ;;
  missing_source_file)   echo "-> The multipart upload carried no source file (packaging bug)." >&2 ;;
  unsupported_storage_pattern) echo "-> App calls window.storage, unavailable on Embarko. Use better-sqlite3 or PGlite under \$DATA_DIR. See https://hostnsoft.com/docs#storage-requirements" >&2 ;;
  deploy_failed)    echo "-> Build/deploy step failed server-side; read 'details' above." >&2 ;;
  "") [[ "$HTTP_CODE" == 404 ]] && echo "-> 404 with no error code: the deploy API is not responding at $ENDPOINT (docs specify 401 for an unauthenticated POST). Endpoint may be down or moved -- check the dashboard." >&2 ;;
esac
exit 1

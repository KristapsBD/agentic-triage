#!/usr/bin/env bash
# One-shot, idempotent bootstrap for a completely fresh clone/environment:
# brings up Gitea, creates its admin user + API token + repo (the one part
# that otherwise requires manually clicking through Gitea's web UI), and
# writes the result into .env. Safe to re-run — it detects what already
# exists and skips it.
#
# Usage: ./bootstrap.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

ENV_FILE=".env"
ADMIN_PASSWORD="${GITEA_ADMIN_PASSWORD:-TriageAdmin123!}"

if [ ! -f "$ENV_FILE" ]; then
    echo "==> No .env found, copying .env.example"
    cp .env.example "$ENV_FILE"
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
GITEA_URL="${GITEA_URL:-http://localhost:3000}"
GITEA_REPO_OWNER="${GITEA_REPO_OWNER:-triageadmin}"
GITEA_REPO_NAME="${GITEA_REPO_NAME:-bug-triage}"

set_env_var() {
    # set_env_var KEY VALUE — replaces KEY=... in .env, or appends it.
    python3 - "$ENV_FILE" "$1" "$2" <<'PYEOF'
import sys
path, key, value = sys.argv[1:4]
lines = open(path).read().splitlines()
out, found = [], False
for line in lines:
    if line.startswith(key + "="):
        out.append(f"{key}={value}")
        found = True
    else:
        out.append(line)
if not found:
    out.append(f"{key}={value}")
open(path, "w").write("\n".join(out) + "\n")
PYEOF
}

echo "==> Bringing up Gitea"
docker compose up -d --wait gitea

echo "==> Checking for an existing, working Gitea API token"
TOKEN_OK=false
if [ -n "${GITEA_TOKEN:-}" ]; then
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: token $GITEA_TOKEN" \
        "$GITEA_URL/api/v1/repos/$GITEA_REPO_OWNER/$GITEA_REPO_NAME" || true)
    if [ "$STATUS" = "200" ]; then
        TOKEN_OK=true
        echo "    existing GITEA_TOKEN in .env already works — leaving it as-is"
    fi
fi

if [ "$TOKEN_OK" = false ]; then
    echo "==> Creating Gitea admin user '$GITEA_REPO_OWNER' + API token"
    TOKEN_NAME="bootstrap-$(date +%s)"
    CREATE_OUTPUT=$(docker compose exec -u git gitea gitea admin user create \
        --username "$GITEA_REPO_OWNER" --password "$ADMIN_PASSWORD" \
        --email "$GITEA_REPO_OWNER@example.com" --admin \
        --access-token --access-token-name "$TOKEN_NAME" --access-token-scopes all 2>&1) || true
    echo "$CREATE_OUTPUT"

    TOKEN=$(echo "$CREATE_OUTPUT" | grep -oE '[0-9a-f]{40}' | tail -1 || true)

    if [ -z "$TOKEN" ]; then
        # User likely already existed (this container has run before) —
        # generate a fresh token for it instead of failing.
        echo "    admin user already existed; generating a new token for it"
        TOKEN=$(docker compose exec -u git gitea gitea admin user generate-access-token \
            -u "$GITEA_REPO_OWNER" -t "$TOKEN_NAME" --scopes all --raw)
    fi

    if [ -z "$TOKEN" ]; then
        echo "!! Could not obtain a Gitea API token. See output above." >&2
        exit 1
    fi

    set_env_var GITEA_TOKEN "$TOKEN"
    GITEA_TOKEN="$TOKEN"
    echo "    wrote GITEA_TOKEN to .env"
fi

echo "==> Ensuring repo '$GITEA_REPO_OWNER/$GITEA_REPO_NAME' exists"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: token $GITEA_TOKEN" \
    "$GITEA_URL/api/v1/repos/$GITEA_REPO_OWNER/$GITEA_REPO_NAME")
if [ "$STATUS" = "200" ]; then
    echo "    already exists"
else
    curl -s -X POST -H "Authorization: token $GITEA_TOKEN" -H "Content-Type: application/json" \
        -d "{\"name\": \"$GITEA_REPO_NAME\", \"private\": false, \"auto_init\": false}" \
        "$GITEA_URL/api/v1/user/repos" > /dev/null
    echo "    created"
fi

echo
echo "==> Gitea is ready: $GITEA_URL  (login: $GITEA_REPO_OWNER / $ADMIN_PASSWORD)"
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    echo "!! ANTHROPIC_API_KEY is empty in .env — set it before starting the triage service."
fi
echo
echo "Next: docker compose up -d --build triage-service"
echo "Then: docker compose run --rm triage-service python -m scripts.seed_set_a"

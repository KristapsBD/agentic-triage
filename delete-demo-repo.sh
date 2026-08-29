#!/usr/bin/env bash
# Deletes the triage service's demo TARGET repo (default "acme-app") via
# Gitea's REST API, as part of `make fresh-start`. This replaces the old
# manual "click through Danger Zone in Gitea's UI" step from
# service/README.md's "Fresh start" section.
#
# Hard safety requirement: this script must be structurally incapable of
# ever deleting "bug-triage" (this codebase's own Gitea project + issue
# tracker, see service/README.md). To that end:
#   - The repo owner/name come ONLY from GITEA_REPO_OWNER/GITEA_REPO_NAME
#     in .env, the same vars bootstrap.sh and the service already use.
#     There is no flag/argument to override them at call time.
#   - Before issuing the DELETE, the resolved name is checked against a
#     literal, hardcoded expected value ("acme-app") and against the
#     literal, hardcoded name of this codebase's own project
#     ("bug-triage"). Any mismatch aborts with no request sent.
#
# Usage: ./delete-demo-repo.sh
# For testing the guard in isolation without deleting anything for real:
#   GUARD_ONLY=1 GITEA_REPO_NAME=wrong-name ./delete-demo-repo.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

ENV_FILE=".env"
if [ -f "$ENV_FILE" ]; then
    # shellcheck disable=SC1090
    set -a; source "$ENV_FILE"; set +a
fi

GITEA_URL="${GITEA_URL:-http://localhost:3000}"
GITEA_REPO_OWNER="${GITEA_REPO_OWNER:-triageadmin}"
GITEA_REPO_NAME="${GITEA_REPO_NAME:-acme-app}"

# Belt-and-suspenders: these two literals are hardcoded, not read from any
# env var, so they can't drift or be overridden alongside GITEA_REPO_NAME.
EXPECTED_DEMO_REPO_NAME="acme-app"
OWN_REPO_NAME="bug-triage"

if [ "$GITEA_REPO_NAME" != "$EXPECTED_DEMO_REPO_NAME" ]; then
    echo "!! Refusing to delete: GITEA_REPO_NAME='$GITEA_REPO_NAME' does not match the known-safe demo target '$EXPECTED_DEMO_REPO_NAME'. No request sent." >&2
    exit 1
fi

if [ "$GITEA_REPO_NAME" = "$OWN_REPO_NAME" ]; then
    echo "!! Refusing to delete: resolved repo name equals this codebase's own Gitea project ('$OWN_REPO_NAME'). No request sent." >&2
    exit 1
fi

if [ "${GUARD_ONLY:-}" = "1" ]; then
    echo "    guard passed for '$GITEA_REPO_OWNER/$GITEA_REPO_NAME' (GUARD_ONLY=1, not sending a request)"
    exit 0
fi

if [ -z "${GITEA_TOKEN:-}" ]; then
    echo "!! GITEA_TOKEN is not set in .env -- run ./bootstrap.sh first." >&2
    exit 1
fi

echo "==> Deleting demo target repo '$GITEA_REPO_OWNER/$GITEA_REPO_NAME' (this is NOT '$OWN_REPO_NAME')"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
    -H "Authorization: token $GITEA_TOKEN" \
    "$GITEA_URL/api/v1/repos/$GITEA_REPO_OWNER/$GITEA_REPO_NAME")

if [ "$STATUS" = "204" ]; then
    echo "    deleted"
elif [ "$STATUS" = "404" ]; then
    echo "    already gone"
else
    echo "!! Unexpected status $STATUS deleting '$GITEA_REPO_OWNER/$GITEA_REPO_NAME'" >&2
    exit 1
fi

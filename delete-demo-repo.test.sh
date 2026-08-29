#!/usr/bin/env bash
# Unit test for delete-demo-repo.sh's safety guard: proves it refuses to
# proceed (and sends no request — GUARD_ONLY=1 short-circuits before the
# curl call) whenever the resolved repo name isn't the known-safe demo
# target, including the specific case of it matching this codebase's own
# Gitea project ("bug-triage").
#
# Run: ./delete-demo-repo.test.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

fail=0

assert_guard_refuses() {
    local name="$1" label="$2"
    if GUARD_ONLY=1 GITEA_REPO_NAME="$name" ./delete-demo-repo.sh >/dev/null 2>&1; then
        echo "FAIL: guard should have refused for $label (GITEA_REPO_NAME=$name), but exited 0"
        fail=1
    else
        echo "ok: guard refused for $label (GITEA_REPO_NAME=$name)"
    fi
}

assert_guard_allows() {
    local name="$1" label="$2"
    if GUARD_ONLY=1 GITEA_REPO_NAME="$name" ./delete-demo-repo.sh >/dev/null 2>&1; then
        echo "ok: guard allowed $label (GITEA_REPO_NAME=$name)"
    else
        echo "FAIL: guard should have allowed $label (GITEA_REPO_NAME=$name), but refused"
        fail=1
    fi
}

assert_guard_refuses "bug-triage" "this codebase's own repo name"
assert_guard_refuses "wrong-name" "an arbitrary mismatched name"
assert_guard_allows "" "an empty name (falls back to the acme-app default, same as bootstrap.sh)"
assert_guard_allows "acme-app" "the known-safe demo target"

if [ "$fail" = "1" ]; then
    echo "FAILED"
    exit 1
fi
echo "PASSED"

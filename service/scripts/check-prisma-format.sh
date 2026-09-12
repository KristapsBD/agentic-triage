#!/usr/bin/env bash
# Prisma's CLI has no built-in `--check` flag (unlike `prettier --check`), so
# this reimplements it: format a scratch copy of the schema and diff it
# against the committed one, without mutating the real file.
set -euo pipefail

cd "$(dirname "$0")/.."

SCHEMA="prisma/schema.prisma"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

cp "$SCHEMA" "$TMP"
npx prisma format --schema "$TMP" >/dev/null

if ! diff -q "$TMP" "$SCHEMA" >/dev/null; then
  echo "$SCHEMA is not formatted; run 'npx prisma format --schema $SCHEMA'" >&2
  exit 1
fi

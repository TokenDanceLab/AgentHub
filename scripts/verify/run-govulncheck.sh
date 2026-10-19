#!/usr/bin/env bash
# Run govulncheck in text mode and emit its summary on stdout for
# verify-vulnerability-gates.sh. Scanner failure exits non-zero with the error
# on stderr; findings (exit 3) are passed through for the verifier to judge.
set -uo pipefail

OUT="$(mktemp)"
ERR="$(mktemp)"
trap 'rm -f "$OUT" "$ERR"' EXIT

set +e
go run golang.org/x/vuln/cmd/govulncheck@v1.6.0 ./... >"$OUT" 2>"$ERR"
RC=$?
set -e

if [[ "$RC" -eq 3 ]]; then
  cat "$OUT"
  cat "$ERR" >&2
  exit 0
fi
if [[ "$RC" -ne 0 ]]; then
  cat "$ERR" >&2
  echo "::error::govulncheck scanner failed (exit $RC)" >&2
  exit "$RC"
fi
cat "$OUT"

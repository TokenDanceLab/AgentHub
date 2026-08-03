#!/usr/bin/env bash
# verify-gosec-gates — fail-closed gosec SAST wrapper (#1574)
#
# Usage:
#   go run github.com/securego/gosec/v2/cmd/gosec@latest -fmt=json ./... 2>&1 \
#     | verify-gosec-gates.sh
#
# Contract (fail-closed): any of the following MUST exit non-zero:
#   - empty or unparseable output (scanner failure / false green)
#   - output that cannot be parsed into the gosec JSON schema
#   - any finding in the Issues array
# Only a parseable, schema-valid, zero-issue result exits 0.
set -uo pipefail

raw="$(cat)"
if [[ -z "$(echo "$raw" | tr -d '[:space:]')" ]]; then
  echo "::error::gosec produced empty output — cannot verify (fail-closed)" >&2
  exit 1
fi

parse_rc=0
verdict=$(echo "$raw" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
except Exception as e:
    print(f'PARSE_ERROR: {e}')
    sys.exit(2)
if not isinstance(data, dict) or 'Issues' not in data:
    print('SCHEMA_ERROR: missing Issues array')
    sys.exit(3)
issues = data['Issues']
if not isinstance(issues, list):
    print('SCHEMA_ERROR: Issues is not an array')
    sys.exit(4)
if len(issues) > 0:
    for issue in issues[:20]:
        rule = issue.get('rule_id', '?')
        file = issue.get('file', '?')
        line = issue.get('line', '?')
        detail = issue.get('details', '')
        print(f'FINDING: gosec {rule} {file}:{line} {detail}', file=sys.stderr)
    if len(issues) > 20:
        print(f'FINDING: ... and {len(issues) - 20} more findings', file=sys.stderr)
    print(f'FINDING: gosec found {len(issues)} issue(s)', file=sys.stderr)
    sys.exit(5)
print('CLEAN')
sys.exit(0)
" 2>&1) || parse_rc=$?

if [[ "$parse_rc" -ne 0 ]]; then
  echo "::error::gosec output failed verification (exit=$parse_rc): $verdict (fail-closed)" >&2
  exit "$parse_rc"
fi

echo "::notice::gosec verified clean (0 issues)"
exit 0

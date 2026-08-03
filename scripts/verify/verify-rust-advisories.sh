#!/usr/bin/env bash
# verify-rust-advisories — fail-closed Rust advisory gate (#1578)
#
# Usage:
#   verify-rust-advisories.sh [--workspace <dir>]
#     --workspace  directory containing Cargo.lock (default: repo root's
#                  app/desktop/src-tauri)
#
# Why this gate exists: Dependabot raises alerts for Rust advisories that
# `cargo audit` treats as non-failing warnings (informational "unsound"
# class, e.g. GHSA-wrw7-89jp-8q8g / RUSTSEC-2024-0429 for glib < 0.20). A
# plain `cargo audit` run stays green on those — the exact cross-ecosystem
# false-green this gate closes.
#
# Contract (fail-closed): any of the following MUST exit non-zero:
#   - cargo-audit missing or crashing
#   - audit output unparseable or empty
#   - any advisory in the "vulnerability" class not in the allowlist
#   - any advisory in the "unsound" warning class not in the allowlist
#   - any allowlist entry past its review deadline (forces re-review)
# "unmaintained" warnings are reported as notices only: they carry no
# exploit path, and the GTK3 family (RUSTSEC-2024-0411..0420) is frozen
# upstream with no fix path until the Tauri GTK4 migration lands.
#
# Allowlist format: one `ID:YYYY-MM-DD` pair per line. The date is a hard
# review deadline — the gate fails after it passes, even if nothing changed.
# Override via RUST_ADVISORY_ALLOWLIST (e.g. "" to disable all allows).
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKSPACE="${REPO_ROOT}/app/desktop/src-tauri"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace)
      WORKSPACE="$2"
      shift 2
      ;;
    *)
      echo "::error::verify-rust-advisories: unknown argument '$1' (usage: --workspace <dir>)" >&2
      exit 2
      ;;
  esac
done

# ── Allowlist (documented disposition; see PR #1578) ──────────────────────
# RUSTSEC-2024-0429 (GHSA-wrw7-89jp-8q8g): glib < 0.20 VariantStrIter UB.
# Not fixable on the current Tauri 2 stable Linux stack: gtk/gdk/atk GTK3
# bindings are frozen upstream at 0.18.2 and every owning crate
# (webkit2gtk 2.0.2, wry 0.56, tao 0.36, muda 0.19, tray-icon 0.24,
# tauri 2.11.x) pins gtk-rs 0.18 / glib ^0.18.
# Disposition owner: AgentHub Desktop security review.
# Upstream trackers: tauri-apps/tauri#7335, #12563 (assignee lucasfernog),
# #14684 (GTK4 + WebKitGTK 6.0 migration PR, open).
# Review deadline: 2026-11-30 — gate fails after this date until re-review.
DEFAULT_ALLOWLIST='
RUSTSEC-2024-0429:2026-11-30
'

parse_allowlist() {
  # NOTE: use ${VAR-default} (not :-) so an explicitly empty
  # RUST_ADVISORY_ALLOWLIST="" disables ALL allows.
  local raw="${RUST_ADVISORY_ALLOWLIST-$DEFAULT_ALLOWLIST}"
  ALLOWED_IDS=()
  ALLOWED_DEADLINES=()
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    [[ "$line" =~ ^# ]] && continue
    local id="${line%%:*}"
    local deadline="${line##*:}"
    ALLOWED_IDS+=("$id")
    ALLOWED_DEADLINES+=("$deadline")
  done <<< "$raw"
}

fail() {
  echo "::error::verify-rust-advisories: $1" >&2
  exit 1
}

# ── 1. Preconditions (fail-closed) ─────────────────────────────────────────
CARGO_AUDIT_BIN="${CARGO_AUDIT_BIN:-cargo-audit}"
command -v "$CARGO_AUDIT_BIN" >/dev/null 2>&1 || fail "cargo-audit not found (CARGO_AUDIT_BIN=${CARGO_AUDIT_BIN}) — install with: cargo install cargo-audit --locked"
if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN=python3
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN=python
else
  fail "python3 (or python) not found — required to parse cargo audit JSON"
fi
if [[ ! -f "${WORKSPACE}/Cargo.lock" ]]; then
  fail "Cargo.lock not found at ${WORKSPACE}/Cargo.lock"
fi

# ── 2. Allowlist deadlines (fail-closed on expiry) ─────────────────────────
parse_allowlist
TODAY="$(date +%Y-%m-%d)"
for i in "${!ALLOWED_IDS[@]}"; do
  if [[ "$TODAY" > "${ALLOWED_DEADLINES[$i]}" ]]; then
    fail "allowlisted advisory ${ALLOWED_IDS[$i]} passed its review deadline ${ALLOWED_DEADLINES[$i]} (today ${TODAY}) — re-review required before this gate can pass"
  fi
done

# ── 3. Scan (fail-closed on tool/output errors) ────────────────────────────
IGNORE_FLAGS=()
for id in "${ALLOWED_IDS[@]}"; do
  IGNORE_FLAGS+=(--ignore "$id")
done

RAW_OUTPUT="$("$CARGO_AUDIT_BIN" audit --file "${WORKSPACE}/Cargo.lock" "${IGNORE_FLAGS[@]}" --json 2>/dev/null)" \
  || SCAN_RC=$?
if [[ -z "$RAW_OUTPUT" ]]; then
  fail "cargo audit produced empty output — cannot verify (fail-closed)"
fi

VERDICT="$("$PYTHON_BIN" - "$RAW_OUTPUT" "${ALLOWED_IDS[@]}" <<'PYEOF'
import json, sys

raw, allowed_ids = sys.argv[1], set(sys.argv[2:])
try:
    data = json.loads(raw)
except Exception as exc:
    print(f"PARSE_ERROR: {exc}")
    sys.exit(3)
if not isinstance(data, dict) or "vulnerabilities" not in data or "warnings" not in data:
    print("SCHEMA_ERROR: audit output is not the expected JSON shape")
    sys.exit(4)

def advisory_ids(items):
    """Accept both cargo-audit JSON shapes: dict {id: advisory} and
    list of {kind, package, advisory: {id, ...}} entries."""
    ids = []
    if isinstance(items, dict):
        ids.extend(items.keys())
    elif isinstance(items, list):
        for item in items:
            if not isinstance(item, dict):
                continue
            adv = item.get("advisory")
            if isinstance(adv, dict) and adv.get("id"):
                ids.append(adv["id"])
            elif item.get("id"):
                ids.append(item["id"])
    return ids

vuln = data["vulnerabilities"]
found = []
if isinstance(vuln, dict) and vuln.get("found"):
    found.extend(advisory_ids(vuln.get("list", [])))
found.extend(advisory_ids(data.get("warnings", {}).get("unsound", {})))
unmaintained = advisory_ids(data.get("warnings", {}).get("unmaintained", {}))

blocking = [aid for aid in found if aid not in allowed_ids]
print(f"found_total={len(found)} blocking={len(blocking)} unmaintained={len(unmaintained)}")
if blocking:
    print("blocking_advisories=" + ",".join(sorted(blocking)))
    sys.exit(1)
sys.exit(0)
PYEOF
)" || VERDICT_RC=$?

if [[ "${VERDICT_RC:-0}" -eq 3 ]] || [[ "${VERDICT_RC:-0}" -eq 4 ]]; then
  fail "$VERDICT"
fi
if [[ "${VERDICT_RC:-0}" -ne 0 ]]; then
  echo "::error::verify-rust-advisories: advisory(ies) found that are not allowlisted:" >&2
  echo "$VERDICT" | sed -n 's/^blocking_advisories=//p' | tr ',' '\n' | sed 's/^/  /' >&2
  exit 1
fi

echo "::notice::verify-rust-advisories: verified clean ($VERDICT)"
exit 0

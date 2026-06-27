#!/usr/bin/env bash
# AgentHub release gate verifier — bash equivalent of verify-release-gate.ps1
#
# Verifies release readiness: ref divergence, workflow policy, version alignment,
# RC tag policy, security risk register, and artifact manifest.
#
# Usage:
#   ./scripts/release/verify-release-gate.sh [--allow-open-high-risks] [--skip-ref-check]
#   ./scripts/release/verify-release-gate.sh --base-ref origin/master --dev-ref origin/dev/delicious233
#   ./scripts/release/verify-release-gate.sh --artifacts-root dist/unsigned-dry --report-path .tmp/release-gate-report.json
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
BASE_REF="${BASE_REF:-origin/master}"
DEV_REF="${DEV_REF:-origin/dev/delicious233}"
ARTIFACTS_ROOT="${ARTIFACTS_ROOT:-}"
REPORT_PATH="${REPORT_PATH:-.tmp/release-gate-report.json}"
ALLOW_OPEN_HIGH_RISKS=false
SKIP_REF_CHECK=false

# ── Parse args ───────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --allow-open-high-risks) ALLOW_OPEN_HIGH_RISKS=true; shift ;;
    --skip-ref-check) SKIP_REF_CHECK=true; shift ;;
    --base-ref) BASE_REF="$2"; shift 2 ;;
    --dev-ref) DEV_REF="$2"; shift 2 ;;
    --artifacts-root) ARTIFACTS_ROOT="$2"; shift 2 ;;
    --report-path) REPORT_PATH="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 2 ;;
  esac
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

step()    { printf '\n>>> %s\n' "$1"; }
ready()   { printf '%sREADY:%s %s\n' "$GREEN" "$NC" "$1"; READY+=("$1"); }
blocker() { printf '%sBLOCKER:%s %s\n' "$RED" "$NC" "$1"; BLOCKERS+=("$1"); }
warn()    { printf '%sWARN:%s %s\n' "$YELLOW" "$NC" "$1"; WARNINGS+=("$1"); }

READY=()
WARNINGS=()
BLOCKERS=()

# ── Helpers ──────────────────────────────────────────────────

read_text() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    blocker "required file is missing: $path"
    echo ""
    return
  fi
  cat "$path"
}

# Simple JSON value extractor (no jq dependency — fragile but works for known structures)
json_field() {
  local text="$1" field="$2"
  # Try using node if available (more reliable), otherwise grep
  if command -v node &>/dev/null; then
    node -e "try { const d=JSON.parse(require('fs').readFileSync('${text}','utf8')); console.log(d.${field}||''); } catch(e) { console.log(''); }" 2>/dev/null || echo ""
  else
    # Fallback: basic grep for known JSON patterns
    grep -oP "\"${field}\"\s*:\s*\"[^\"]*\"" "$text" 2>/dev/null | head -1 | grep -oP '(?<=": ")[^"]*' || echo ""
  fi
}

invoke_git() {
  git -C "$REPO_ROOT" "$@" 2>&1 || true
}

assert_pattern() {
  local text="$1" pattern="$2" ready_msg="$3" blocker_msg="$4"
  if echo "$text" | grep -qP "$pattern"; then
    ready "$ready_msg"
  else
    blocker "$blocker_msg"
  fi
}

# ── Ref check ────────────────────────────────────────────────

assert_release_refs() {
  if [[ "$SKIP_REF_CHECK" == "true" ]]; then
    warn "ref check skipped by caller"
    return
  fi

  step "dev to master refs"
  for ref in "$BASE_REF" "$DEV_REF"; do
    local sha
    sha="$(invoke_git rev-parse --verify "$ref" 2>/dev/null)" || true
    if [[ -z "$sha" ]]; then
      blocker "required ref is unavailable: $ref"
      return
    fi
    ready "$ref resolves to ${sha:0:8}"
  done

  local behind_count
  behind_count="$(invoke_git rev-list --count "${DEV_REF}..${BASE_REF}" 2>/dev/null)" || true
  local ahead_count
  ahead_count="$(invoke_git rev-list --count "${BASE_REF}..${DEV_REF}" 2>/dev/null)" || true

  if [[ -z "$behind_count" || -z "$ahead_count" ]]; then
    blocker "could not compute $DEV_REF divergence from $BASE_REF"
    return
  fi

  behind_count="${behind_count//[^0-9]/}"
  ahead_count="${ahead_count//[^0-9]/}"
  behind_count=${behind_count:-0}
  ahead_count=${ahead_count:-0}

  if [[ "$behind_count" -gt 0 ]]; then
    blocker "$DEV_REF is behind $BASE_REF by $behind_count commit(s); rebase/merge current master before dev->master"
  else
    ready "$DEV_REF is not behind $BASE_REF"
  fi
  ready "$DEV_REF is ahead of $BASE_REF by $ahead_count commit(s)"
}

# ── Workflow policy ──────────────────────────────────────────

assert_workflow_policy() {
  step "release workflow and dry gates"
  local readiness_text release_text
  readiness_text="$(read_text "$REPO_ROOT/.github/workflows/release-readiness.yml")" || true
  release_text="$(read_text "$REPO_ROOT/.github/workflows/release.yml")" || true

  assert_pattern "$readiness_text" "workflow_dispatch" "release readiness workflow is manually dispatchable" "release readiness workflow lacks workflow_dispatch"
  assert_pattern "$readiness_text" "run_windows_package_dry" "Windows package dry gate has an explicit manual input" "Windows package dry gate input is missing"
  assert_pattern "$readiness_text" "verify-tauri-package-dry\.ps1" "Windows dry gate delegates to verify-tauri-package-dry.ps1" "Windows dry gate does not call verify-tauri-package-dry.ps1"
  assert_pattern "$readiness_text" "actions/upload-artifact@v4" "release readiness dry outputs are workflow artifacts only" "release readiness workflow does not upload dry evidence artifacts"
  assert_pattern "$readiness_text" "run_macos_unsigned_dry_policy" "macOS future dry policy is manual and policy-only" "macOS unsigned dry policy input is missing"

  # Check no release upload/signing in readiness
  if echo "$readiness_text" | grep -qP 'softprops/action-gh-release|(?m)^\s*(gh\s+release|xcrun\s+notarytool|notarytool\s+submit|xcrun\s+stapler|stapler\s+staple|codesign\s|TAURI_SIGNING_PRIVATE_KEY|APPLE_)'; then
    blocker "release-readiness workflow contains release upload/signing/notarization execution surface"
  else
    ready "release-readiness workflow does not sign, notarize, staple, tag, or upload a GitHub Release"
  fi

  assert_pattern "$release_text" "tags:" "release workflow has tag trigger" "release workflow tag trigger is missing or not constrained to v*"
  assert_pattern "$release_text" "softprops/action-gh-release@v2" "release workflow has the real GitHub Release uploader isolated in the tag workflow" "release workflow GitHub Release uploader is missing"
  assert_pattern "$release_text" "prerelease:" "release workflow has prerelease policy" "release workflow prerelease policy is missing"
}

# ── Desktop version ──────────────────────────────────────────

get_desktop_version() {
  local pkg_json="$REPO_ROOT/app/desktop/package.json"
  local tauri_conf="$REPO_ROOT/app/desktop/src-tauri/tauri.conf.json"

  if [[ ! -f "$pkg_json" ]]; then
    blocker "desktop package.json is missing"
    echo ""
    return
  fi
  if [[ ! -f "$tauri_conf" ]]; then
    blocker "desktop tauri.conf.json is missing"
    echo ""
    return
  fi

  local package_version tauri_version
  package_version="$(json_field "$pkg_json" "version")"
  tauri_version="$(json_field "$tauri_conf" "version")"

  if [[ "$package_version" != "$tauri_version" ]]; then
    blocker "desktop package.json version ($package_version) does not match tauri.conf.json version ($tauri_version)"
  else
    ready "desktop package metadata version is aligned at $package_version"
  fi
  echo "$package_version"
}

# ── RC tag policy ───────────────────────────────────────────

assert_rc_tag_policy() {
  local ver="$1"
  step "RC and tag policy"
  if echo "$ver" | grep -qP '^\d+\.\d+\.\d+-rc\.\d+$'; then
    ready "current desktop version is an RC semver: $ver"
    ready "next RC tag convention: v$ver"
  elif echo "$ver" | grep -qP '^\d+\.\d+\.\d+$'; then
    warn "current desktop version is stable semver: $ver; use only after release blockers are closed"
  else
    blocker "desktop version is not an accepted stable or rc semver: $ver"
  fi
}

# ── Security release gate ──────────────────────────────────

get_open_high_risks() {
  local risk_path="$REPO_ROOT/docs/governance/security-risk-register.md"
  if [[ ! -f "$risk_path" ]]; then
    blocker "security risk register is missing"
    return
  fi

  local risks_json="["
  local first=true
  while IFS= read -r line; do
    if echo "$line" | grep -qP '^\|\s*(AH-SR-\d+)\s*\|\s*(Critical|High)\s*\|\s*Open\s*\|\s*([^|]+)\|'; then
      local id severity risk
      id="$(echo "$line" | sed -E 's/^\|\s*(AH-SR-[0-9]+)\s*\|.*/\1/')"
      severity="$(echo "$line" | sed -E 's/^\|\s*AH-SR-[0-9]+\s*\|\s*(Critical|High)\s*\|.*/\1/')"
      risk="$(echo "$line" | sed -E 's/^\|\s*AH-SR-[0-9]+\s*\|\s*(Critical|High)\s*\|\s*Open\s*\|\s*([^|]+)\|.*/\3/' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      if [[ "$first" == "true" ]]; then first=false; else risks_json+=","; fi
      risks_json+="{\"id\":\"$id\",\"severity\":\"$severity\",\"risk\":\"$risk\"}"
    fi
  done < "$risk_path"
  risks_json+="]"
  echo "$risks_json"
}

assert_security_release_gate() {
  step "security release gate"
  local open_risks_json
  open_risks_json="$(get_open_high_risks)" || true

  local count
  count="$(echo "$open_risks_json" | grep -o '"id"' | wc -l)" || true
  count="${count//[^0-9]/}"
  count=${count:-0}

  if [[ "$count" -eq 0 ]]; then
    ready "no Open Critical/High risks in security register"
    echo "$open_risks_json"
    return
  fi

  # Build ID list
  local ids=""
  while IFS= read -r id_line; do
    [[ -z "$id_line" ]] && continue
    local rid rsev
    rid="$(echo "$id_line" | grep -oP '(?<="id":")([^"]+)' || true)"
    rsev="$(echo "$id_line" | grep -oP '(?<="severity":")([^"]+)' || true)"
    [[ -z "$rid" ]] && continue
    ids+="${rid}(${rsev}), "
  done < <(echo "$open_risks_json" | grep -oP '\{[^}]+\}')

  ids="${ids%, }"

  if [[ "$ALLOW_OPEN_HIGH_RISKS" == "true" ]]; then
    warn "Open Critical/High risks are being reported but not failing because --allow-open-high-risks was set: $ids"
  else
    blocker "Open Critical/High risks block public release: $ids"
  fi
  echo "$open_risks_json"
}

# ── Artifact manifest ──────────────────────────────────────

assert_artifact_manifest() {
  if [[ -z "$ARTIFACTS_ROOT" ]]; then
    warn "artifact manifest check skipped because --artifacts-root was not provided"
    echo "[]"
    return
  fi

  step "Windows unsigned artifact manifest"
  local artifact_root_full
  if [[ "$ARTIFACTS_ROOT" == /* ]]; then
    artifact_root_full="$ARTIFACTS_ROOT"
  else
    artifact_root_full="$REPO_ROOT/$ARTIFACTS_ROOT"
  fi

  if [[ ! -d "$artifact_root_full" ]]; then
    blocker "artifact root does not exist: $artifact_root_full"
    echo "[]"
    return
  fi

  local manifest_path="$artifact_root_full/artifact-manifest.json"
  local package_report_path="$artifact_root_full/package-dry-report.json"

  if [[ ! -f "$manifest_path" ]]; then
    blocker "artifact-manifest.json is missing from $artifact_root_full"
  fi
  if [[ ! -f "$package_report_path" ]]; then
    blocker "package-dry-report.json is missing from $artifact_root_full"
  fi

  # Check required artifact patterns in manifest
  local required_patterns=(
    '^AgentHub_[0-9]+\.[0-9]+\.[0-9]+-rc\.[0-9]+_x64-setup\.exe$'
    '^AgentHub_[0-9]+\.[0-9]+\.[0-9]+-rc\.[0-9]+_x64-portable\.zip$'
    '^agenthub-edge-windows-amd64\.exe$'
    '^agenthub-desktop\.exe$'
    '^package-dry-report\.json$'
  )

  for pattern in "${required_patterns[@]}"; do
    local entry
    entry="$(node -e "
      const m = JSON.parse(require('fs').readFileSync('${manifest_path}','utf8'));
      const found = m.find(e => new RegExp('${pattern}').test(e.name));
      if (found) console.log(JSON.stringify(found));
    " 2>/dev/null)" || true

    if [[ -z "$entry" ]]; then
      blocker "artifact manifest lacks required artifact pattern: $pattern"
      continue
    fi

    local ename ebytes esha256
    ename="$(echo "$entry" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).name||'')" 2>/dev/null)" || true
    ebytes="$(echo "$entry" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(String(d.bytes||0))" 2>/dev/null)" || true
    esha256="$(echo "$entry" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).sha256||'')" 2>/dev/null)" || true

    if [[ -z "$ebytes" || "$ebytes" -le 0 ]] || ! echo "$esha256" | grep -qP '^[A-Fa-f0-9]{64}$'; then
      blocker "artifact manifest entry is invalid for $ename"
    else
      ready "artifact manifest includes $ename ($ebytes bytes, sha256 $esha256)"
    fi
  done

  # Package dry report checks
  if [[ -f "$package_report_path" ]]; then
    local signing release_upload
    signing="$(json_field "$package_report_path" "signing")" || true
    release_upload="$(json_field "$package_report_path" "releaseUpload")" || true
    if [[ "$signing" == "out-of-scope" && "$release_upload" == "out-of-scope" ]]; then
      ready "package dry report keeps signing and release upload out of scope"
    else
      blocker "package dry report does not preserve signing/release upload boundaries"
    fi

    if grep -q '"not_produced_unsigned_build"' "$package_report_path" 2>/dev/null; then
      warn "unsigned dry build did not produce latest.json/.sig; updater metadata remains a signing/release blocker"
    fi
  fi

  cat "$manifest_path"
}

# ── Execute gates ───────────────────────────────────────────

assert_release_refs
assert_workflow_policy
version="$(get_desktop_version)"
assert_rc_tag_policy "$version"
open_high_risks_json="$(assert_security_release_gate)"
manifest_json="$(assert_artifact_manifest)"

step "blocking external approval slices"
blocker "public release remains blocked until signing/notarization approval is explicit; this gate does not sign, notarize, staple, tag, push, or upload releases"
blocker "production updater publication remains blocked until signed latest.json and installer signature are produced and approved"

# ── Write report ───────────────────────────────────────────

report_dir="$(dirname "$REPORT_PATH")"
mkdir -p "$report_dir"

cat > "$REPORT_PATH" <<REPORTEOF
{
  "mode": "agenthub-release-gate",
  "baseRef": "$BASE_REF",
  "devRef": "$DEV_REF",
  "desktopVersion": "$version",
  "ready": $(printf '%s\n' "${READY[@]}" | node -e "const lines=require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n').filter(Boolean); console.log(JSON.stringify(lines))" 2>/dev/null || echo "[]"),
  "warnings": $(printf '%s\n' "${WARNINGS[@]}" | node -e "const lines=require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n').filter(Boolean); console.log(JSON.stringify(lines))" 2>/dev/null || echo "[]"),
  "blockers": $(printf '%s\n' "${BLOCKERS[@]}" | node -e "const lines=require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n').filter(Boolean); console.log(JSON.stringify(lines))" 2>/dev/null || echo "[]"),
  "openCriticalHighRisks": $open_high_risks_json,
  "artifactsRoot": "$ARTIFACTS_ROOT"
}
REPORTEOF

echo ""
echo "Release gate report: $REPORT_PATH"

if [[ ${#BLOCKERS[@]} -gt 0 ]]; then
  printf '%sRelease gate BLOCKED with %s blocker(s).%s\n' "$RED" "${#BLOCKERS[@]}" "$NC"
  exit 1
fi

printf '%sRelease gate READY.%s\n' "$GREEN" "$NC"

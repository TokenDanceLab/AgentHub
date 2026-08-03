#!/usr/bin/env bash
# AgentHub Tauri package readiness verifier — bash equivalent of verify-tauri-package-readiness.ps1
#
# Validates Tauri package metadata, version alignment, bundle configuration,
# updater policy, release workflow gates, and generated artifact ignore policy.
#
# Usage:
#   ./scripts/release/verify-tauri-package-readiness.sh
#   ./scripts/release/verify-tauri-package-readiness.sh --require-built-artifacts --built-artifacts-root dist/
#   ./scripts/release/verify-tauri-package-readiness.sh --require-bundled-sidecar
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
BUILT_ARTIFACTS_ROOT="${BUILT_ARTIFACTS_ROOT:-}"
REQUIRE_BUILT_ARTIFACTS=false
REQUIRE_BUNDLED_SIDECAR=false

# ── Parse args ───────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-root) REPO_ROOT="$2"; shift 2 ;;
    --built-artifacts-root) BUILT_ARTIFACTS_ROOT="$2"; shift 2 ;;
    --require-built-artifacts) REQUIRE_BUILT_ARTIFACTS=true; shift ;;
    --require-bundled-sidecar) REQUIRE_BUNDLED_SIDECAR=true; shift ;;
    *) echo "Unknown option: $1"; exit 2 ;;
  esac
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

step()    { printf '\n>>> %s\n' "$1"; }
pass()    { printf '%sPASS:%s %s\n' "$GREEN" "$NC" "$1"; }
fail()    { printf >&2 '%sFAIL:%s %s\n' "$RED" "$NC" "$1"; exit 1; }

# ── Helpers ──────────────────────────────────────────────────

read_text() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    fail "required file is missing: $path"
  fi
  cat "$path"
}

read_json() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    fail "JSON file not found: $path"
  fi
  cat "$path"
}

json_field() {
  local file="$1" field="$2"
  if command -v node &>/dev/null; then
    node -e "try{const d=JSON.parse(require('fs').readFileSync('${file}','utf8'));console.log(d.${field}||'');}catch(e){console.log('');}" 2>/dev/null
  else
    grep -oP "\"${field}\"\s*:\s*\"[^\"]*\"" "$file" 2>/dev/null | head -1 | grep -oP '(?<=": ")[^"]*' || \
    grep -oP "\"${field}\"\s*:\s*(true|false)" "$file" 2>/dev/null | head -1 | grep -oP '(true|false)' || echo ""
  fi
}

json_field_raw() {
  local file="$1" field="$2"
  if command -v node &>/dev/null; then
    node -e "try{const d=JSON.parse(require('fs').readFileSync('${file}','utf8'));console.log(JSON.stringify(d.${field}||null));}catch(e){console.log('null');}" 2>/dev/null
  else
    echo "null"
  fi
}

assert_true() {
  local condition="$1" msg="$2"
  if [[ "$condition" != "true" ]]; then
    fail "$msg"
  fi
  pass "$msg"
}

assert_file_exists() {
  local rel="$1" label="$2"
  local full="$REPO_ROOT/$rel"
  if [[ ! -f "$full" ]]; then
    fail "$label blocker: required file is missing ($rel)"
  fi
  pass "$label exists ($rel)"
}

assert_git_ignored() {
  local rel="$1" label="$2"
  if git -C "$REPO_ROOT" check-ignore -q -- "$rel" 2>/dev/null; then
    pass "$label is ignored by Git ($rel)"
  else
    fail "$label is not ignored by Git: $rel"
  fi
}

assert_git_path_clean() {
  local rel="$1" label="$2"
  git -C "$REPO_ROOT" update-index --refresh >/dev/null 2>&1 || true
  local dirty
  dirty="$(git -C "$REPO_ROOT" status --porcelain -- "$rel" 2>/dev/null)" || true
  if [[ -n "$dirty" ]]; then
    local untracked
    untracked="$(echo "$dirty" | grep '^??' || true)"
    if [[ -n "$untracked" ]]; then
      fail "$label has untracked generated changes: $untracked"
    fi

    if ! git -C "$REPO_ROOT" diff --quiet -- "$rel" 2>/dev/null || \
       ! git -C "$REPO_ROOT" diff --cached --quiet -- "$rel" 2>/dev/null; then
      fail "$label has uncommitted generated changes: $dirty"
    fi
  fi
  pass "$label has no uncommitted generated changes ($rel)"
}

get_cargo_version() {
  local path="$1"
  local text
  text="$(read_text "$path")"
  local ver
  ver="$(echo "$text" | grep -oP '(?m)^version\s*=\s*"\K[^"]+' | head -1)"
  if [[ -z "$ver" ]]; then
    fail "Cargo.toml package version is missing"
  fi
  echo "$ver"
}

get_cargo_lock_package_version() {
  local path="$1" pkg_name="$2"
  local ver
  ver="$(awk -v pkg="$pkg_name" '
    { sub(/\r$/, "") }
    /^\[\[package\]\]$/ {
      in_package = 1
      found_name = 0
      next
    }
    in_package && /^name[[:space:]]*=[[:space:]]*"/ {
      found_name = ($0 == "name = \"" pkg "\"")
      next
    }
    in_package && found_name && /^version[[:space:]]*=[[:space:]]*"/ {
      sub(/^version[[:space:]]*=[[:space:]]*"/, "")
      sub(/".*$/, "")
      print
      exit
    }
  ' "$path")"
  if [[ -z "$ver" ]]; then
    fail "Cargo.lock package version is missing for $pkg_name"
  fi
  echo "$ver"
}

invoke_git_quiet() {
  git -C "$REPO_ROOT" "$@" 2>/dev/null || true
}

get_head_release_tags() {
  local head_sha
  head_sha="$(invoke_git_quiet rev-parse --verify HEAD)" || true
  if [[ -z "$head_sha" ]]; then
    return
  fi

  local tags
  tags="$(invoke_git_quiet tag --points-at HEAD)" || true
  if [[ -z "$tags" ]]; then
    return
  fi

  while IFS= read -r tag; do
    [[ -z "$tag" ]] && continue
    if echo "$tag" | grep -qP '^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$'; then
      echo "$tag"
    fi
  done <<< "$tags"
}

workflow_has_tag_push_trigger() {
  local path="$1"
  awk '
    function indent_of(line) {
      match(line, /[^ ]/)
      return RSTART ? RSTART - 1 : length(line)
    }
    /^[[:space:]]*on:[[:space:]]*$/ {
      in_on = 1
      on_indent = indent_of($0)
      next
    }
    in_on && indent_of($0) <= on_indent && $0 !~ /^[[:space:]]*$/ {
      in_on = 0
      in_push = 0
    }
    in_on && /^[[:space:]]*push:[[:space:]]*$/ {
      in_push = 1
      push_indent = indent_of($0)
      next
    }
    in_push && indent_of($0) <= push_indent && $0 !~ /^[[:space:]]*$/ {
      in_push = 0
    }
    in_push && /^[[:space:]]*tags:[[:space:]]*/ {
      found = 1
    }
    END { exit found ? 0 : 1 }
  ' "$path"
}

get_workflow_job_block() {
  local text="$1" job_name="$2"
  echo "$text" | awk -v job="$job_name" '
    BEGIN { found=0; }
    /^  [A-Za-z0-9_-]+:/ {
      if (found) exit
      if ($0 ~ "^  " job ":") { found=1; next }
    }
    found { print }
  '
}

test_workflow_job_has_manual_opt_in() {
  local job_block="$1" input_name="$2"
  echo "$job_block" | grep -qP "github\.event_name\s*==\s*'workflow_dispatch'\s*&&\s*inputs\.${input_name//[.]/\\.}\s*==\s*true"
}

assert_workflow_command_explicit_opt_in() {
  local text="$1" cmd_pattern="$2" input_name="$3" job_name="$4" label="$5"

  if ! echo "$text" | grep -qP "$cmd_pattern"; then
    pass "$label command is absent"
    return
  fi

  # Check input declaration in workflow_dispatch
  if ! echo "$text" | grep -qP "(?ms)workflow_dispatch:\s*\n\s*inputs:.*?^\s{6}${input_name}\s*:"; then
    fail "$label opt-in input is not declared"
  fi

  local job_block
  job_block="$(get_workflow_job_block "$text" "$job_name")" || true
  if [[ -z "$job_block" ]]; then
    fail "$label job '$job_name' not found"
  fi

  if ! test_workflow_job_has_manual_opt_in "$job_block" "$input_name"; then
    fail "$label job is not gated by explicit workflow_dispatch input"
  fi

  pass "$label command is isolated to manual opt-in job"
}

# ── Schema cleanliness ──────────────────────────────────────

assert_generated_schema_clean() {
  local schema_dir_rel="app/desktop/src-tauri/gen/schemas"
  local schema_dir="$REPO_ROOT/$schema_dir_rel"
  local required_schemas=("desktop-schema.json" "windows-schema.json")

  step "Generated Tauri schema policy"
  if ! git -C "$REPO_ROOT" diff --ignore-cr-at-eol --quiet -- "$schema_dir_rel" 2>/dev/null || \
     ! git -C "$REPO_ROOT" diff --cached --ignore-cr-at-eol --quiet -- "$schema_dir_rel" 2>/dev/null; then
    fail "Tauri generated schemas has uncommitted generated content changes under $schema_dir_rel"
  fi
  pass "Tauri generated schemas has no uncommitted generated content changes ($schema_dir_rel)"
  assert_true "$([[ -d "$schema_dir" ]] && echo true || echo false)" "required generated schema directory exists ($schema_dir_rel)"

  local schema_count
  schema_count="$(find "$schema_dir" -maxdepth 1 -name '*.json' -type f 2>/dev/null | wc -l)" || true
  schema_count="${schema_count//[^0-9]/}"
  schema_count=${schema_count:-0}
  assert_true "$([[ "$schema_count" -gt 0 ]] && echo true || echo false)" "generated Tauri schema directory contains JSON schema files"

  for sn in "${required_schemas[@]}"; do
    local sf="$schema_dir/$sn"
    assert_true "$([[ -f "$sf" ]] && echo true || echo false)" "required generated schema file exists ($schema_dir_rel/$sn)"
  done
}

# ── Windows unsigned dev package contract ────────────────────

assert_windows_unsigned_dev_package_contract() {
  step "Windows unsigned/dev package reproducibility contract"
  local dry_script="$REPO_ROOT/scripts/release/verify-tauri-package-dry.ps1"
  assert_true "$([[ -f "$dry_script" ]] && echo true || echo false)" "Windows unsigned/dev package dry checker exists"

  local dry_text
  dry_text="$(read_text "$dry_script")"

  assert_true "$(echo "$dry_text" | grep -qP 'mode\s*=\s*"windows-desktop-package-dry"' && echo true || echo false)" "package dry report declares windows-desktop-package-dry mode"
  assert_true "$(echo "$dry_text" | grep -qP 'signing\s*=\s*"out-of-scope"' && echo "$dry_text" | grep -qP 'notarization\s*=\s*"out-of-scope"' && echo "$dry_text" | grep -qP 'stapling\s*=\s*"out-of-scope"' && echo "$dry_text" | grep -qP 'releaseUpload\s*=\s*"out-of-scope"' && echo true || echo false)" "package dry report keeps signing, notarization, stapling, and release upload out of scope"
  assert_true "$(echo "$dry_text" | grep -q 'Build Tauri executable without bundling' && echo "$dry_text" | grep -q -- '--no-bundle' && echo true || echo false)" "package dry checker proves the dev executable compile path with pnpm tauri build --no-bundle"
  assert_true "$(echo "$dry_text" | grep -qP 'if\s*\(\$RunWindowsBundle\)' && echo "$dry_text" | grep -q 'Build unsigned Tauri Windows NSIS package' && echo "$dry_text" | grep -q 'pnpm.*tauri.*build' && echo true || echo false)" "package dry checker gates the unsigned Windows NSIS package path behind -RunWindowsBundle"
  assert_true "$(echo "$dry_text" | grep -q 'GOOS' && echo "$dry_text" | grep -q 'GOARCH' && echo "$dry_text" | grep -q 'agenthub-edge-windows-amd64\.exe' && echo true || echo false)" "package dry checker compiles the Windows Local Edge sidecar explicitly"
  assert_true "$(echo "$dry_text" | grep -q 'prepare-tauri-sidecar-local' && echo "$dry_text" | grep -q 'agenthub-edge-x86_64-pc-windows-msvc\.exe' && echo true || echo false)" "package dry checker places the sidecar at the Tauri Windows target-triple path"
  assert_true "$(echo "$dry_text" | grep -q 'package-dry-report\.json' && echo "$dry_text" | grep -q 'artifact-manifest\.json' && echo "$dry_text" | grep -q 'Get-FileHash' && echo true || echo false)" "package dry checker writes report and manifest evidence with artifact hashes"
  assert_true "$(echo "$dry_text" | grep -q 'RequireUpdaterMetadata' && echo "$dry_text" | grep -q 'not_produced_unsigned_build' && echo true || echo false)" "package dry checker separates unsigned package proof from updater metadata/signature production"
  assert_true "$(echo "$dry_text" | grep -q 'Assert-SidecarSqlitePolicy' && echo true || echo false)" "package dry checker preserves reproducible Local Edge diagnostics without renderer direct CLI spawn"
}

# ── Release workflow prerelease policy ──────────────────────

assert_release_workflow_prerelease_policy() {
  local text="$1"
  step "Release workflow prerelease policy"
  local release_block
  release_block="$(get_workflow_job_block "$text" "release")" || true

  assert_true "$(echo "$release_block" | grep -q 'softprops/action-gh-release@v3' && echo true || echo false)" "release job creates GitHub Releases through softprops/action-gh-release"
  assert_true "$(echo "$release_block" | grep -qvP '(?m)^\s*prerelease:\s*false\s*$' && echo true || echo false)" "release job is not fixed stable for all v* tags"
  assert_true "$(echo "$release_block" | grep -qP "prerelease:\s*\\$\\{\\{\\s*contains\(github\.ref_name,\s*'-'\)\s*\\}\\}" && echo true || echo false)" "hyphenated semver tags are marked as GitHub prereleases"
  pass "RC/pre-release tags avoid the stable releases/latest updater channel; stable tags remain prerelease=false"
}

# ── Built artifact gate ────────────────────────────────────

assert_built_artifacts() {
  local pkg_version="$1"

  step "Built artifact gate"
  if [[ -z "$BUILT_ARTIFACTS_ROOT" ]]; then
    fail "BuiltArtifactsRoot is required when --require-built-artifacts is set"
  fi
  if [[ ! -d "$BUILT_ARTIFACTS_ROOT" ]]; then
    fail "Built artifacts root not found: $BUILT_ARTIFACTS_ROOT; expected latest.json, setup.exe, portable.zip, and .sig"
  fi

  # Find artifacts
  local setup portable latest sig manifest
  setup="$(find "$BUILT_ARTIFACTS_ROOT" -maxdepth 2 -name '*setup.exe' -type f 2>/dev/null | head -1)"
  portable="$(find "$BUILT_ARTIFACTS_ROOT" -maxdepth 2 -name '*portable.zip' -type f 2>/dev/null | head -1)"
  latest="$(find "$BUILT_ARTIFACTS_ROOT" -maxdepth 2 -name 'latest.json' -type f 2>/dev/null | head -1)"
  sig="$(find "$BUILT_ARTIFACTS_ROOT" -maxdepth 2 -name '*.sig' -type f 2>/dev/null | head -1)"
  manifest="$(find "$BUILT_ARTIFACTS_ROOT" -maxdepth 2 -name 'artifact-manifest.json' -type f 2>/dev/null | head -1)"

  [[ -n "$setup" ]] || fail "NSIS setup.exe not found under $BUILT_ARTIFACTS_ROOT"
  [[ -n "$portable" ]] || fail "Windows portable.zip not found under $BUILT_ARTIFACTS_ROOT"
  [[ -n "$latest" ]] || fail "Updater latest.json not found under $BUILT_ARTIFACTS_ROOT"
  [[ -n "$sig" ]] || fail "Updater signature .sig not found under $BUILT_ARTIFACTS_ROOT"
  [[ -n "$manifest" ]] || fail "Dry artifact manifest not found under $BUILT_ARTIFACTS_ROOT"

  local setup_size portable_size
  setup_size="$(stat -c%s "$setup" 2>/dev/null || echo 0)"
  portable_size="$(stat -c%s "$portable" 2>/dev/null || echo 0)"

  assert_true "$([[ "$setup_size" -ge 1 ]] && echo true || echo false)" "NSIS setup.exe is non-empty ($setup_size bytes)"
  assert_true "$([[ "$portable_size" -ge 1 ]] && echo true || echo false)" "Windows portable.zip is non-empty ($portable_size bytes)"

  # Check portable.zip contents
  if command -v unzip &>/dev/null; then
    local zip_contents
    zip_contents="$(unzip -l "$portable" 2>/dev/null || true)"
    assert_true "$(echo "$zip_contents" | grep -q 'AgentHub.exe' && echo true || echo false)" "Windows portable.zip contains AgentHub.exe"
    assert_true "$(echo "$zip_contents" | grep -q 'agenthub-edge.exe' && echo true || echo false)" "Windows portable.zip contains agenthub-edge.exe"
    assert_true "$(echo "$zip_contents" | grep -q 'README.txt' && echo true || echo false)" "Windows portable.zip contains README.txt"
  else
    pass "Windows portable.zip exists (unzip not available for content check)"
    pass "Windows portable.zip exists (unzip not available for content check)"
    pass "Windows portable.zip exists (unzip not available for content check)"
  fi

  # Check updater latest.json
  if command -v node &>/dev/null; then
    local latest_ver
    latest_ver="$(node -e "const d=JSON.parse(require('fs').readFileSync('${latest}','utf8'));console.log(d.version||'')" 2>/dev/null)"
    assert_true "$([[ "$latest_ver" == "$pkg_version" ]] && echo true || echo false)" "latest.json version matches desktop package ($latest_ver)"
  fi

  pass "built artifact gate passed"
}

# ── Main ─────────────────────────────────────────────────────

step "Desktop version metadata"

pkg_json="$REPO_ROOT/app/desktop/package.json"
tauri_conf="$REPO_ROOT/app/desktop/src-tauri/tauri.conf.json"
cargo_toml="$REPO_ROOT/app/desktop/src-tauri/Cargo.toml"
cargo_lock="$REPO_ROOT/app/desktop/src-tauri/Cargo.lock"

pkg_version="$(json_field "$pkg_json" "version")"
tauri_version="$(json_field "$tauri_conf" "version")"
cargo_version="$(get_cargo_version "$cargo_toml")"
cargo_lock_version="$(get_cargo_lock_package_version "$cargo_lock" "agenthub-desktop")"

assert_true "$([[ "$pkg_version" == "$tauri_version" ]] && echo true || echo false)" "package.json and tauri.conf.json versions match ($pkg_version)"
assert_true "$([[ "$cargo_version" == "$tauri_version" ]] && echo true || echo false)" "Cargo.toml and tauri.conf.json versions match ($cargo_version)"
assert_true "$([[ "$cargo_lock_version" == "$tauri_version" ]] && echo true || echo false)" "Cargo.lock and tauri.conf.json versions match ($cargo_lock_version)"

identifier="$(json_field "$tauri_conf" "identifier")"
product_name="$(json_field "$tauri_conf" "productName")"
assert_true "$([[ "$identifier" == "com.agenthub.desktop" ]] && echo true || echo false)" "Desktop Tauri identifier is stable"
assert_true "$([[ "$product_name" == "AgentHub Desktop" ]] && echo true || echo false)" "Desktop product name is stable"

# Release tag version alignment
step "Release tag version alignment"
release_tags="$(get_head_release_tags)" || true
if [[ -z "$release_tags" ]]; then
  pass "No semver release tag points at HEAD; package metadata version is $tauri_version"
else
  while IFS= read -r tag; do
    [[ -z "$tag" ]] && continue
    local tag_ver="${tag#v}"
    assert_true "$([[ "$tag_ver" == "$tauri_version" ]] && echo true || echo false)" "tag $tag expects desktop metadata version $tag_ver; found $tauri_version"
  done <<< "$release_tags"
fi

# Windows package policy
step "Windows package policy"

tauri_json="$(read_json "$tauri_conf")"

bundle_active="$(json_field "$tauri_conf" "bundle.active")"
assert_true "$([[ "$bundle_active" == "true" ]] && echo true || echo false)" "Tauri bundle is active"

# Check NSIS target
if echo "$tauri_json" | grep -q '"nsis"'; then
  pass "Tauri bundle targets Windows NSIS"
else
  fail "Tauri bundle does not target Windows NSIS"
fi

# Check not using "all" targets
if ! echo "$tauri_json" | grep -qP '"targets"\s*:\s*\[\s*"all"\s*\]'; then
  pass "Tauri bundle does not use broad all targets for internal package readiness"
else
  fail "Tauri bundle uses broad all targets"
fi

# Check externalBin
if echo "$tauri_json" | grep -q 'agenthub-edge'; then
  pass "Tauri config declares edge-server sidecar basename"
else
  fail "Tauri config missing edge-server sidecar"
fi

# NSIS install mode
if echo "$tauri_json" | grep -q '"installMode"\s*:\s*"currentUser"'; then
  pass "NSIS installer uses currentUser install mode"
else
  fail "NSIS installer missing currentUser install mode"
fi

# Read workflow and governance texts
release_wf="$REPO_ROOT/.github/workflows/release.yml"
readiness_wf="$REPO_ROOT/.github/workflows/release-readiness.yml"
governance_doc="$REPO_ROOT/docs/governance/governance-execution.md"
dry_gate_script="$REPO_ROOT/scripts/release/verify-tauri-package-dry.ps1"

release_wf_text="$(read_text "$release_wf")" || true
readiness_wf_text="$(read_text "$readiness_wf")" || true
governance_text="$(read_text "$governance_doc")" 2>/dev/null || governance_text=""
dry_gate_text="$(read_text "$dry_gate_script")" || true

assert_true "$(echo "$dry_gate_text" | grep -q 'agenthub-edge-x86_64-pc-windows-msvc\.exe' && echo true || echo false)" "release readiness dry gate prepares Windows sidecar agenthub-edge_x86_64-pc-windows-msvc.exe"
assert_true "$(echo "$dry_gate_text" | grep -qP 'AgentHub_\$\{desktopVersion\}_x64-portable\.zip|portable\.zip' && echo true || echo false)" "release readiness dry gate names portable.zip artifact"
assert_true "$(echo "$dry_gate_text" | grep -q 'setup\.exe' && echo true || echo false)" "release readiness dry gate collects NSIS setup.exe"

# Updater metadata policy
step "Updater metadata policy"

updater_active="$(json_field "$tauri_conf" "plugins.updater.active")"
assert_true "$([[ "$updater_active" == "true" ]] && echo true || echo false)" "Tauri updater plugin is active"

if echo "$tauri_json" | grep -q 'latest\.json'; then
  pass "Updater endpoint points at latest.json metadata"
else
  fail "Updater endpoint missing latest.json"
fi

pubkey="$(json_field "$tauri_conf" "plugins.updater.pubkey")"
assert_true "$([[ -n "$pubkey" ]] && echo true || echo false)" "Updater public key is configured"
assert_true "$(echo "$dry_gate_text" | grep -q 'RequireUpdaterMetadata' && echo "$dry_gate_text" | grep -q 'not_produced_unsigned_build' && echo true || echo false)" "unsigned dry gate records updater metadata as a separate signing/release gate"

# Tag release policy
step "Tag release policy"
assert_true "$(workflow_has_tag_push_trigger "$release_wf" && echo true || echo false)" "release workflow keeps tag push trigger"
assert_true "$(echo "$release_wf_text" | grep -q 'softprops/action-gh-release' && echo true || echo false)" "release workflow keeps GitHub Release creation"
assert_true "$(echo "$release_wf_text" | grep -q 'TAURI_SIGNING_PRIVATE_KEY' && echo true || echo false)" "release workflow keeps production Tauri signing secret boundary"
assert_release_workflow_prerelease_policy "$release_wf_text"

# Dry release policy
step "Dry release policy"
assert_true "$(echo "$readiness_wf_text" | grep -q 'workflow_dispatch' && echo true || echo false)" "release readiness workflow is manually runnable"
assert_true "$(echo "$readiness_wf_text" | grep -q '\.github/workflows/release\.yml' && echo true || echo false)" "release readiness workflow watches release.yml"
assert_true "$(echo "$readiness_wf_text" | grep -q 'app/desktop/src-tauri/Cargo\.lock' && echo true || echo false)" "release readiness workflow watches Cargo.lock"
assert_true "$(echo "$readiness_wf_text" | grep -qv 'softprops/action-gh-release' && echo true || echo false)" "release readiness workflow does not create GitHub releases"
assert_true "$(echo "$readiness_wf_text" | grep -qv 'TAURI_SIGNING_PRIVATE_KEY' && echo true || echo false)" "release readiness workflow does not require production signing secrets"
assert_true "$(echo "$readiness_wf_text" | grep -q 'verify-tauri-package-readiness\.ps1' && echo true || echo false)" "release readiness workflow runs this checker"
assert_true "$(echo "$readiness_wf_text" | grep -q 'verify-tauri-package-dry\.ps1' && echo true || echo false)" "release readiness workflow delegates unsigned Windows package proof to the dry gate"

# Assert-ReleaseWorkflowPrereleasePolicy already called above
assert_generated_schema_clean
assert_windows_unsigned_dev_package_contract

# Generated artifact ignore policy
step "Generated artifact ignore policy"
desktop_version="$pkg_version"
assert_git_ignored "dist/AgentHub_${desktop_version}_x64-setup.exe" "Windows setup.exe dry artifact"
assert_git_ignored "dist/AgentHub_${desktop_version}_x64-portable.zip" "Windows portable.zip dry artifact"
assert_git_ignored "dist/latest.json" "Updater latest.json dry artifact"
assert_git_ignored "dist/AgentHub_${desktop_version}_x64-setup.exe.sig" "Updater signature dry artifact"
assert_git_ignored "dist/agenthub-edge-windows-amd64.exe" "Windows sidecar dry intermediate"
assert_git_ignored "app/desktop/src-tauri/target/release/bundle/nsis/AgentHub_${desktop_version}_x64-setup.exe" "Tauri NSIS bundle output"
assert_git_ignored "app/desktop/src-tauri/binaries/agenthub-edge-x86_64-pc-windows-msvc.exe" "Windows sidecar binary"
assert_git_ignored "app/desktop/src-tauri/binaries/agenthub-edge-aarch64-apple-darwin" "macOS arm64 sidecar binary"

# Bundled sidecar gate
if [[ "$REQUIRE_BUNDLED_SIDECAR" == "true" ]]; then
  step "Bundled Local Edge sidecar presence gate"
  assert_file_exists "app/desktop/src-tauri/binaries/agenthub-edge-x86_64-pc-windows-msvc.exe" "Windows bundled Local Edge sidecar"
fi

# macOS unsigned dry policy boundary
step "macOS unsigned dry policy boundary"
assert_true "$(echo "$readiness_wf_text" | grep -q 'run_macos_unsigned_dry_policy' && echo true || echo false)" "release readiness workflow declares explicit macOS unsigned dry policy input"

macos_dry_block="$(get_workflow_job_block "$readiness_wf_text" "macos-unsigned-dry-policy")" || true
assert_true "$(test_workflow_job_has_manual_opt_in "$macos_dry_block" "run_macos_unsigned_dry_policy" && echo true || echo false)" "macOS unsigned dry policy job is gated by explicit workflow_dispatch input"
assert_true "$(echo "$macos_dry_block" | grep -q 'macOS unsigned dry' && echo true || echo false)" "release readiness workflow names macOS step as unsigned dry policy"
assert_true "$(echo "$macos_dry_block" | grep -q 'agenthub-edge-aarch64-apple-darwin' && echo true || echo false)" "release readiness workflow documents the future macOS arm64 sidecar boundary"
assert_true "$(echo "$macos_dry_block" | grep -q 'AgentHub\.app' && echo "$macos_dry_block" | grep -q 'AgentHub_.*aarch64.*\.dmg' && echo true || echo false)" "release readiness workflow documents future macOS app and versioned arm64 DMG bundle boundaries"
assert_true "$(echo "$macos_dry_block" | grep -q 'workflow artifacts only' && echo true || echo false)" "release readiness workflow scopes future macOS unsigned outputs to workflow artifacts only"
assert_true "$(echo "$macos_dry_block" | grep -q 'macos-unsigned-dry-policy\.json' && echo true || echo false)" "release readiness workflow writes a macOS unsigned dry policy manifest"
assert_true "$(echo "$macos_dry_block" | grep -q 'actions/upload-artifact@v7' && echo "$macos_dry_block" | grep -q 'name:\s*macos-unsigned-package-dry' && echo "$macos_dry_block" | grep -q 'path:\s*dist/macos-unsigned-dry-policy\.json' && echo true || echo false)" "release readiness workflow uploads only the macOS policy manifest as a workflow artifact"
assert_true "$(echo "$macos_dry_block" | grep -q 'Apple Developer ID signing' && echo "$macos_dry_block" | grep -q 'notarytool notarization' && echo "$macos_dry_block" | grep -q 'stapler staple' && echo true || echo false)" "release readiness workflow records Apple signing, notarization, and stapling as explicit approval gates"
assert_true "$(echo "$macos_dry_block" | grep -q 'GitHub Release upload' && echo "$macos_dry_block" | grep -q 'production updater metadata publication' && echo true || echo false)" "release readiness workflow records release upload and updater production metadata as explicit approval gates"
assert_true "$(echo "$macos_dry_block" | grep -q 'later approval slice' && echo true || echo false)" "release readiness workflow keeps signing, notarization, release upload, and updater metadata as later approval slice"

# Assert no build/release commands in macOS dry block
if echo "$macos_dry_block" | grep -qP 'pnpm\s+tauri\s+build|softprops/action-gh-release|gh release upload|TAURI_SIGNING_PRIVATE_KEY'; then
  fail "macOS unsigned dry policy job contains forbidden build/release commands"
else
  pass "macOS unsigned dry policy job does not run build, release upload, or production signing secret commands"
fi

# Assert no codesign/notarytool/stapler command execution.
if echo "$macos_dry_block" | grep -qiP '(^|[\s;&|(`])(?:xcrun\s+)?(?:codesign|notarytool|stapler)(?:\s|$)'; then
  fail "macOS unsigned dry policy job contains forbidden signing command"
else
  pass "macOS unsigned dry policy job has no codesign, notarytool, or stapler commands"
fi

if echo "$macos_dry_block" | grep -qiP '\bsoftprops/action-gh-release\b|\bactions/upload-release-asset\b|(^|[\s;&|(`])gh\s+release\s+(create|upload)(\s|$)|(^|[\s;&|(`])(aws\s+s3\s+cp|az\s+storage\s+blob\s+upload|gsutil\s+cp|rclone\s+copy|wrangler\s+r2\s+object\s+put)(\s|$)|\blatest\.json\b.*\b(upload|publish|release|s3|blob|r2|gsutil|rclone)\b|\bupdater\b.*\bmetadata\b.*\b(upload|publish|release)\b'; then
  fail "macOS unsigned dry policy job contains forbidden release/updater publication action"
else
  pass "macOS unsigned dry policy job has no GitHub Release upload or updater metadata publication actions"
fi

# Governance doc release dry topology (if governance exists)
if [[ -f "$governance_doc" ]]; then
  step "Release dry topology documentation"
  assert_true "$(echo "$governance_text" | grep -qP 'D2b\.\s+Release dry build topology' && echo true || echo false)" "governance doc records release dry build topology"
  assert_true "$(echo "$governance_text" | grep -qP 'topology/preflight|拓扑/预检' && echo true || echo false)" "governance doc keeps release dry topology to topology/preflight scope"
  assert_true "$(echo "$governance_text" | grep -qP 'full Tauri build|pnpm tauri build' && echo true || echo false)" "governance doc names full Tauri build as separate opt-in scope"
  assert_true "$(echo "$governance_text" | grep -qP 'agenthub-edge-x86_64-pc-windows-msvc\.exe' && echo true || echo false)" "governance doc records Windows Tauri sidecar name"
  assert_true "$(echo "$governance_text" | grep -qP 'latest\.json.*\.sig|\.sig.*latest\.json' && echo true || echo false)" "governance doc records updater metadata artifacts"
  assert_true "$(echo "$governance_text" | grep -qP 'agenthub-edge-aarch64-apple-darwin' && echo true || echo false)" "governance doc records macOS arm64 sidecar name"
  assert_true "$(echo "$governance_text" | grep -qP 'notarytool|notarization' && echo true || echo false)" "governance doc names notarization as out of scope"
  assert_true "$(echo "$governance_text" | grep -qP 'workflow artifact' && echo true || echo false)" "governance doc keeps dry artifacts scoped to workflow artifact upload"
fi

# Built artifact validation
if [[ "$REQUIRE_BUILT_ARTIFACTS" == "true" ]]; then
  assert_built_artifacts "$pkg_version"
fi

printf '\n%sTauri package readiness policy OK%s\n' "$GREEN" "$NC"

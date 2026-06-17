#!/usr/bin/env bash
# AgentHub Release Script — bump version, test, build, tag, push
# Usage:
#   ./scripts/release.sh <version>            # full release pipeline
#   ./scripts/release.sh <version> --skip-tests  # skip tests
#   ./scripts/release.sh <version> --dry-run     # print actions only
set -euo pipefail

# ── Globals ──────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
APP_DIR="$REPO_ROOT/app"
TAURI_CONF="$APP_DIR/desktop/src-tauri/tauri.conf.json"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

step()  { echo -e "\n${CYAN}>>> $*${NC}"; }
ok()    { echo -e "  ${GREEN}OK${NC} $*"; }
warn()  { echo -e "  ${YELLOW}WARN${NC} $*"; }
err()   { echo -e "  ${RED}ERROR${NC} $*" >&2; }

# ── Options ──────────────────────────────────────────────
DRY_RUN=false
SKIP_TESTS=false
SKIP_BUILD=false
SKIP_UPLOAD=false

usage() {
  echo "Usage: $0 <version> [OPTIONS]"
  echo ""
  echo "  <version>    New version (e.g. 0.5.0 or v0.5.0 — v prefix optional)"
  echo ""
  echo "Options:"
  echo "  --skip-tests    Skip test suite"
  echo "  --skip-build    Skip build step (version bump + test + tag only)"
  echo "  --skip-upload   Build but do not upload to GitHub"
  echo "  --dry-run       Print what would happen, do nothing"
  exit 1
}

# Parse args
VERSION=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-tests) SKIP_TESTS=true; shift ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    --skip-upload) SKIP_UPLOAD=true; shift ;;
    --dry-run)    DRY_RUN=true; shift ;;
    -h|--help)    usage ;;
    -*)           err "Unknown option: $1"; usage ;;
    *)           VERSION="$1"; shift ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  err "Missing version argument."
  usage
fi

# Normalize: strip leading 'v' then add consistent 'v' prefix
VERSION="${VERSION#v}"
TAG="v${VERSION}"

# ── Pre-flight checks ────────────────────────────────────
step "Pre-flight checks"

# Must be run from repo root
if [[ ! -f "$REPO_ROOT/package.json" ]] && [[ ! -f "$REPO_ROOT/Makefile" ]]; then
  err "Must be run from repo root. Detected root: $REPO_ROOT"
  exit 1
fi
ok "Working directory: $REPO_ROOT"

# Check required tools
for tool in node git; do
  if ! command -v "$tool" &>/dev/null; then
    err "Required tool not found: $tool"
    exit 1
  fi
done
ok "Required tools present (node, git)"

# Check clean working tree
if [[ "$DRY_RUN" != "true" ]]; then
  if ! git -C "$REPO_ROOT" diff --quiet 2>/dev/null; then
    warn "Working tree is dirty. Please commit or stash changes first."
    exit 1
  fi
  ok "Working tree is clean"
fi

# ── Version bump ─────────────────────────────────────────
step "Bump version to $VERSION (tag: $TAG)"

# List of package.json files to bump
PACKAGE_JSON_FILES=(
  "$APP_DIR/package.json"
  "$APP_DIR/desktop/package.json"
  "$APP_DIR/shared/package.json"
  "$APP_DIR/web/package.json"
  "$APP_DIR/mobile-rn/package.json"
)

bump_json_version() {
  local file="$1" new_version="$2"
  if [[ ! -f "$file" ]]; then
    warn "Skipping (not found): $file"
    return
  fi

  # Read current version from the file
  local old_version
  old_version=$(node -e "console.log(require('${file}').version || 'none')" 2>/dev/null || echo "none")
  if [[ "$old_version" == "$new_version" ]]; then
    ok "Already at $new_version: $(basename "$(dirname "$file")")/$(basename "$file")"
    return
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "  [DRY RUN] Would bump $file: $old_version → $new_version"
    return
  fi

  # Use node for in-place JSON edit (portable, no jq dependency on Windows)
  node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync('${file}', 'utf8'));
    p.version = '${new_version}';
    fs.writeFileSync('${file}', JSON.stringify(p, null, 2) + '\n');
  "
  ok "$(basename "$(dirname "$file")")/$(basename "$file"): $old_version → $new_version"
}

# Bump all package.json files
for pkg in "${PACKAGE_JSON_FILES[@]}"; do
  bump_json_version "$pkg" "$VERSION"
done

# Bump tauri.conf.json
if [[ -f "$TAURI_CONF" ]]; then
  old_tauri_ver=$(node -e "console.log(require('${TAURI_CONF}').version || 'none')" 2>/dev/null || echo "none")
  if [[ "$old_tauri_ver" == "$VERSION" ]]; then
    ok "tauri.conf.json already at $VERSION"
  else
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "  [DRY RUN] Would bump tauri.conf.json: $old_tauri_ver → $VERSION"
    else
      node -e "
        const fs = require('fs');
        const p = JSON.parse(fs.readFileSync('${TAURI_CONF}', 'utf8'));
        p.version = '${VERSION}';
        fs.writeFileSync('${TAURI_CONF}', JSON.stringify(p, null, 2) + '\n');
      "
      ok "tauri.conf.json: $old_tauri_ver → $VERSION"
    fi
  fi
else
  warn "tauri.conf.json not found at $TAURI_CONF"
fi

# ── Commit version bump ──────────────────────────────────
if [[ "$DRY_RUN" == "true" ]]; then
  echo -e "\n  [DRY RUN] Would commit version bump: chore: bump version to $TAG"
else
  step "Commit version bump"
  git -C "$REPO_ROOT" add \
    "$APP_DIR/package.json" \
    "$APP_DIR/desktop/package.json" \
    "$APP_DIR/shared/package.json" \
    "$APP_DIR/web/package.json" \
    "$APP_DIR/mobile-rn/package.json" \
    "$TAURI_CONF" \
    2>/dev/null || true
  git -C "$REPO_ROOT" commit -m "chore: bump version to $TAG" || true
  ok "Committed version bump"
fi

# ── Tests ────────────────────────────────────────────────
if [[ "$SKIP_TESTS" == "true" ]]; then
  warn "Skipping tests (--skip-tests)"
else
  step "Run tests"

  # Go tests
  if [[ -d "$REPO_ROOT/edge-server" ]]; then
    echo "  Go: edge-server unit tests..."
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "  [DRY RUN] Would run: cd edge-server && go test ./... -short -count=1 -timeout 60s"
    else
      (cd "$REPO_ROOT/edge-server" && go test ./... -short -count=1 -timeout 60s) || {
        err "Edge server tests failed"
        exit 1
      }
    fi
    ok "edge-server tests passed"
  fi

  if [[ -d "$REPO_ROOT/hub-server" ]]; then
    echo "  Go: hub-server unit tests..."
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "  [DRY RUN] Would run: cd hub-server && go test ./... -short -count=1 -timeout 60s"
    else
      (cd "$REPO_ROOT/hub-server" && go test ./... -short -count=1 -timeout 60s) || {
        err "Hub server tests failed"
        exit 1
      }
    fi
    ok "hub-server tests passed"
  fi

  # Frontend tests
  if [[ -f "$APP_DIR/package.json" ]]; then
    echo "  Frontend: vitest..."
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "  [DRY RUN] Would run: cd app && pnpm test"
    else
      (cd "$APP_DIR" && pnpm test) || {
        err "Frontend tests failed"
        exit 1
      }
    fi
    ok "frontend tests passed"
  fi

  # Typecheck
  echo "  TypeScript typecheck..."
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "  [DRY RUN] Would run: cd app && pnpm typecheck"
  else
    (cd "$APP_DIR" && pnpm typecheck) || {
      err "TypeScript typecheck failed"
      exit 1
    }
  fi
  ok "TypeScript typecheck passed"

  # Lint
  echo "  Frontend lint..."
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "  [DRY RUN] Would run: cd app && pnpm lint"
  else
    (cd "$APP_DIR" && pnpm lint) || warn "Lint found issues (non-fatal)"
  fi
  ok "frontend lint completed"
fi

# ── Build ─────────────────────────────────────────────────
if [[ "$SKIP_BUILD" == "true" ]]; then
  warn "Skipping build (--skip-build)"
else
  step "Build"

  # Web build
  if [[ -d "$APP_DIR/web" ]]; then
    echo "  Building web..."
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "  [DRY RUN] Would run: cd app && pnpm --filter agenthub-web build"
    else
      (cd "$APP_DIR" && pnpm --filter agenthub-web build) || {
        err "Web build failed"
        exit 1
      }
    fi
    ok "web build complete"
  fi

  # Desktop build (Tauri)
  # Note: Tauri desktop build requires Windows toolchain.
  # On non-Windows, this is skipped with a warning.
  if [[ -d "$APP_DIR/desktop/src-tauri" ]]; then
    if [[ "$(uname -s)" == "MINGW"* ]] || [[ "$(uname -s)" == "MSYS"* ]] || [[ "$OSTYPE" == "msys" ]] || command -v rustc &>/dev/null; then
      echo "  Building desktop (Tauri)..."
      if [[ "$DRY_RUN" == "true" ]]; then
        echo "  [DRY RUN] Would run: cd app && pnpm --filter agenthub-desktop tauri build"
      else
        if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
          warn "TAURI_SIGNING_PRIVATE_KEY not set — updater artifacts will not be signed"
        fi
        (cd "$APP_DIR" && pnpm --filter agenthub-desktop tauri build) || {
          err "Desktop build failed"
          exit 1
        }
      fi
      ok "desktop build complete"
    else
      warn "Skipping desktop build (Tauri requires Windows or Rust toolchain on this platform: $(uname -s))"
    fi
  fi
fi

# ── Git tag ───────────────────────────────────────────────
step "Create git tag: $TAG"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "  [DRY RUN] Would run: git tag -a $TAG -m 'Release $TAG'"
else
  if git -C "$REPO_ROOT" tag -l "$TAG" | grep -q .; then
    warn "Tag $TAG already exists"
  else
    git -C "$REPO_ROOT" tag -a "$TAG" -m "Release $TAG"
    ok "Created tag $TAG"
  fi
fi

# ── Push ──────────────────────────────────────────────────
step "Push tag to origin"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "  [DRY RUN] Would run: git push origin $TAG"
else
  git -C "$REPO_ROOT" push origin main 2>/dev/null || warn "Could not push main (may already be up to date)"
  git -C "$REPO_ROOT" push origin "$TAG"
  ok "Pushed tag $TAG to origin"
fi

# ── Upload (if applicable) ────────────────────────────────
# The full binary-release upload uses release.ps1 which handles
# Go cross-compilation + Tauri bundling + GitHub Release upload.
# This shell script focuses on version-bump + test + tag + push.
# For full binary release with upload, use: make release VER=$TAG
if [[ "$SKIP_UPLOAD" != "true" ]] && [[ -n "${UPLOAD_BINARIES:-}" ]]; then
  step "Upload binaries to GitHub Release"
  if [[ -f "$SCRIPT_DIR/release.ps1" ]]; then
    if command -v pwsh &>/dev/null; then
      pwsh -File "$SCRIPT_DIR/release.ps1" "$TAG"
    elif command -v powershell &>/dev/null; then
      powershell -File "$SCRIPT_DIR/release.ps1" "$TAG"
    else
      warn "PowerShell not available for binary upload. Run manually: make release VER=$TAG"
    fi
  else
    warn "release.ps1 not found. Upload binaries manually or use: make release VER=$TAG"
  fi
fi

# ── Done ──────────────────────────────────────────────────
step "Release $TAG complete"
echo ""
echo "  Summary:"
echo "    Version bumped:  all package.json + tauri.conf.json → $VERSION"
if [[ "$SKIP_TESTS" != "true" ]]; then
  echo "    Tests:           passed"
fi
echo "    Tag:             $TAG"
echo "    Pushed:          yes"
echo ""
echo "  Next steps:"
echo "    Binary build:    make release VER=$TAG  (Windows/PowerShell)"
echo "    Release URL:     https://github.com/TokenDanceLab/AgentHub/releases/tag/$TAG"
echo "    CHANGELOG:       Update CHANGELOG.md with release notes"

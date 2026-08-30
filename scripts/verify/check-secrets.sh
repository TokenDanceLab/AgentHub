#!/usr/bin/env bash
# Lightweight secret guard for local hooks and CI.
# It reports file paths and finding types only; it never prints matched values.

set -euo pipefail

MODE="${1:-}"
RANGE="${2:-}"

usage() {
  cat <<'USAGE'
Usage:
  scripts/verify/check-secrets.sh --staged
  scripts/verify/check-secrets.sh --worktree
  scripts/verify/check-secrets.sh --range <git-diff-range>

Scans changed paths and added lines for secret-like files or values.
USAGE
}

if [[ "$MODE" != "--staged" && "$MODE" != "--worktree" && "$MODE" != "--range" ]]; then
  usage
  exit 2
fi

if [[ "$MODE" == "--range" && -z "$RANGE" ]]; then
  usage
  exit 2
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

shopt -s nocasematch

FINDINGS=0

report() {
  local path="$1"
  local line="${2:-0}"
  local kind="$3"

  FINDINGS=1
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    if [[ "$line" != "0" ]]; then
      echo "::error file=${path},line=${line}::${kind}"
    else
      echo "::error file=${path}::${kind}"
    fi
  else
    if [[ "$line" != "0" ]]; then
      echo "secret guard: ${path}:${line}: ${kind}"
    else
      echo "secret guard: ${path}: ${kind}"
    fi
  fi
}

changed_files() {
  case "$MODE" in
    --staged)
      git diff --cached --name-only --diff-filter=ACMRT
      ;;
    --worktree)
      git diff --name-only --diff-filter=ACMRT
      ;;
    --range)
      git diff --name-only --diff-filter=ACMRT "$RANGE"
      ;;
  esac
}

changed_diff() {
  case "$MODE" in
    --staged)
      git diff --cached --unified=0 --no-ext-diff --diff-filter=ACMRT
      ;;
    --worktree)
      git diff --unified=0 --no-ext-diff --diff-filter=ACMRT
      ;;
    --range)
      git diff --unified=0 --no-ext-diff --diff-filter=ACMRT "$RANGE"
      ;;
  esac
}

is_allowed_secret_example_path() {
  local path="$1"
  [[ "$path" == *.env.example || "$path" == *.env.production.example || "$path" == *"/.env.example" || "$path" == *"/.env.production.example" ]]
}

should_scan_secret_assignments() {
  local path="$1"
  local lower
  lower="$(printf '%s' "$path" | tr '[:upper:]' '[:lower:]')"

  case "$lower" in
    *.env|*.env.*|*.envrc|*.yaml|*.yml|*.json|*.toml|*.ini|*.conf|*.config|*.properties|*.tfvars|*.tf)
      return 0
      ;;
    docker-compose*.yaml|docker-compose*.yml|*/deployments/*|*/config/*|*/configs/*|.github/workflows/*)
      return 0
      ;;
  esac

  return 1
}

is_i18n_locale_path() {
  # i18n locale JSON files are translation catalogs, not config. Keys often
  # contain words like "token"/"secret" (e.g. auth.tokenExchangeFailed) and
  # Chinese values have no whitespace, triggering the assignment heuristic.
  # Literal-format checks (sk-/AKIA/ghp_/JWT/etc.) run unconditionally above
  # and still catch real credentials embedded in locale files.
  local lower
  lower="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  [[ "$lower" == */i18n/locales/* ]]
}

check_sensitive_path() {
  local path="$1"
  local normalized="${path//\\//}"

  if is_allowed_secret_example_path "$normalized"; then
    return
  fi

  if [[ "$normalized" =~ (^|/)\.env($|[./]) ]]; then
    report "$path" 0 "sensitive .env-style file must not be committed; use an example file with placeholders"
  elif [[ "$normalized" =~ (^|/)\.envrc$ ]]; then
    report "$path" 0 "local .envrc must not be committed"
  elif [[ "$normalized" =~ (^|/)(secret|secrets|private)(/|$) ]]; then
    report "$path" 0 "secret/private directory must not be committed"
  elif [[ "$normalized" =~ (^|/)id_(rsa|dsa|ecdsa|ed25519)$ ]]; then
    report "$path" 0 "private SSH key must not be committed"
  elif [[ "$normalized" =~ \.(pem|key|p12|pfx|cer|crt)$ ]]; then
    report "$path" 0 "key/certificate material must not be committed"
  fi
}

is_placeholder_value() {
  local value="$1"
  local lower
  lower="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"

  [[ -z "$value" ]] && return 0
  [[ "$value" == *"<"* && "$value" == *">"* ]] && return 0
  [[ ${#value} -lt 16 ]] && return 0

  case "$lower" in
    *example*|*sample*|*placeholder*|*changeme*|*change-me*|*change-in-production*|*replace*|*redacted*|*dummy*|*fake*|*mock*|*test*|*local-smoke-token*|*dev-secret*|*token-a*|*token-b*|*secret!!*|*ci-integration-*|*not-a-real-secret*|your-*)
      return 0
      ;;
  esac

  return 1
}

is_path_literal() {
  # Absolute filesystem paths (/var/lib/tokendance-id/tokendance.db,
  # /tmp/id-private.pem) are location config, not secret values — e.g.
  # TOKENDANCE_DATABASE_DSN=…/tokendance.db or *_KEY_PATH=/tmp/….pem.
  # Only plain path charset qualifies; URL-shaped DSNs with userinfo
  # (scheme://user:pass@host/…) do not match and keep being judged.
  [[ "$1" =~ ^/[A-Za-z0-9_./-]+$ ]]
}

is_endpoint_url() {
  # http(s) endpoint without userinfo (no user:pass@) and without query or
  # fragment (no ?access_token=… / #…) is public endpoint config, not a
  # secret. Covers endpoint-holding names that do not end in _URL/_URI
  # (e.g. TOKENDANCE_JWT_ISSUER=http://127.0.0.1:3000). Credential-bearing
  # query/fragment keeps falling through to the assignment rule.
  [[ "$1" =~ ^https?://[^@[:space:]?#]+$ ]]
}

trim_line() {
  local line="$1"
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  printf '%s' "$line"
}

check_added_line() {
  local path="$1"
  local line_no="$2"
  local line="$3"
  local trimmed
  trimmed="$(trim_line "$line")"

  [[ -z "$trimmed" ]] && return
  [[ "$trimmed" == \#* || "$trimmed" == //* || "$trimmed" == \** || "$trimmed" == "/*"* ]] && return

  # *_URL / *_URI =…://… assignments are endpoint configuration (e.g.
  # AGENTHUB_TOKENDANCE_ID_ISSUER_URL=https://id.example.com,
  # AGENTHUB_TOKENDANCE_ID_REDIRECT_URI=https://hub.example.com/client/auth/callback
  # or the ${VAR:-https://…} default form in docker-compose files), not secrets.
  # Without this, any variable name containing "token" (TOKENDANCE,
  # TOKEN_EXCHANGE…) gets flagged for its public endpoint value.
  if [[ "$trimmed" =~ ^[A-Za-z0-9_.-]*_URL[\"\']?[[:space:]]*[:=][[:space:]]*.*:// ]]; then
    return
  fi
  if [[ "$trimmed" =~ ^[A-Za-z0-9_.-]*_URI[S]?[\"\']?[[:space:]]*[:=][[:space:]]*.*:// ]]; then
    return
  fi

  if [[ "$trimmed" =~ -----BEGIN[[:space:]]+.*PRIVATE[[:space:]]+KEY----- ]]; then
    report "$path" "$line_no" "private key block detected"
  fi

  if [[ "$trimmed" =~ AKIA[0-9A-Z]{16} ]]; then
    report "$path" "$line_no" "possible AWS access key detected"
  fi

  if [[ "$trimmed" =~ gh[pousr]_[A-Za-z0-9_]{20,} ]]; then
    report "$path" "$line_no" "possible GitHub token detected"
  fi

  if [[ "$trimmed" =~ xox[baprs]-[A-Za-z0-9-]{20,} ]]; then
    report "$path" "$line_no" "possible Slack token detected"
  fi

  if [[ "$trimmed" =~ AIza[0-9A-Za-z_-]{35} ]]; then
    report "$path" "$line_no" "possible Google API key detected"
  fi

  if [[ "$trimmed" =~ sk-[A-Za-z0-9_-]{24,} ]]; then
    report "$path" "$line_no" "possible API key detected"
  fi

  if [[ "$trimmed" =~ eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,} ]]; then
    report "$path" "$line_no" "possible JWT detected"
  fi

  if should_scan_secret_assignments "$path" && ! is_i18n_locale_path "$path"; then
    local value=""
    # Go config wiring (e.g. cfg.TokenDanceID.ClientSecret = envClientSecret or
    # cfg.JWT.Secrets = map[string]string{...}): the RHS is an identifier,
    # call, or map literal — env-provided values bound to struct fields, not
    # embedded secrets. Only quoted string literals are treated as secret-like.
    if [[ "$path" == *.go ]] && [[ "$trimmed" =~ ^[A-Za-z_][A-Za-z0-9_.]*\.[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=[[:space:]]*[A-Za-z_{] ]]; then
      return
    fi
    if [[ "$trimmed" =~ [\"\']?[A-Za-z0-9_.-]*(secret|token|password|passwd|api[_-]?key|private[_-]?key|client[_-]?secret|jwt[_-]?secret|auth[_-]?token)[A-Za-z0-9_.-]*[\"\']?[[:space:]]*[:=][[:space:]]*[\"\']?([^\"\'\#[:space:],}\)]{12,}) ]]; then
      value="${BASH_REMATCH[2]}"
      if ! is_placeholder_value "$value" && ! is_path_literal "$value" && ! is_endpoint_url "$value"; then
        report "$path" "$line_no" "secret-like assignment detected"
      fi
    fi
  fi
}

while IFS= read -r path; do
  [[ -z "$path" ]] && continue
  check_sensitive_path "$path"
done < <(changed_files)

current_file=""
current_line=0

while IFS= read -r diff_line; do
  if [[ "$diff_line" =~ ^\+\+\+[[:space:]]b/(.*)$ ]]; then
    current_file="${BASH_REMATCH[1]}"
    continue
  fi

  if [[ "$diff_line" =~ ^@@[[:space:]]-[^[:space:]]+[[:space:]]\+([0-9]+)(,([0-9]+))?[[:space:]]@@ ]]; then
    current_line="${BASH_REMATCH[1]}"
    continue
  fi

  if [[ "$diff_line" == "+++"* ]]; then
    continue
  fi

  if [[ "$diff_line" == "+"* ]]; then
    check_added_line "$current_file" "$current_line" "${diff_line:1}"
    current_line=$((current_line + 1))
    continue
  fi

  if [[ "$diff_line" != "-"* && "$current_line" -gt 0 ]]; then
    current_line=$((current_line + 1))
  fi
done < <(changed_diff)

if [[ "$FINDINGS" -ne 0 ]]; then
  echo ""
  echo "Secret guard blocked this change. Move real credentials to the operator secret store and commit placeholders only."
  exit 1
fi

echo "Secret guard passed."

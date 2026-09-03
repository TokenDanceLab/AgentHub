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

# ---------------------------------------------------------------------------
# 假凭据夹具登记簿（#2295 / ADR-028）
#
# 六条字面量规则对 diff 新增行无条件生效，而脱敏测试的被测对象恰恰是「真形状的
# 假凭据」⇒ 这类测试文件此前不可搬家（#2296 因此把 13 个
# TestSanitizeSubAgentResult_* 留在巨石文件里）。放行面收窄到精确 (path, literal)：
#
#   * 只有登记簿里那一个字面量出现在那一个路径上才不报；
#   * 同 literal 换路径 / 同路径换 literal / 未登记的真凭据形状一律照红；
#   * 禁止目录级、glob、包级、regex 豁免——加载器对这些形状 fail-closed；
#   * 登记簿自身没有路径豁免：它里面出现的凭据形状字面量必须是已登记 literal
#     之一（往 reason 里塞一个未登记的真凭据同样判红）。
#
# 只有这六条字面量规则可被登记。私钥块（含空白，而登记器禁止空白 literal）、
# secret-like 赋值规则与敏感路径规则都不可登记 ⇒ 放行面不因本机制变宽。
# ---------------------------------------------------------------------------
FIXTURE_ALLOWLIST_RELPATH="scripts/verify/secret-fixture-allowlist.json"
FIXTURE_ALLOWLIST_PATH="${ROOT}/${FIXTURE_ALLOWLIST_RELPATH}"

declare -A FIXTURE_ALLOWLIST=()
declare -A FIXTURE_LITERALS=()

load_fixture_allowlist() {
  [[ -f "$FIXTURE_ALLOWLIST_PATH" ]] || return 0

  if ! command -v python3 >/dev/null 2>&1; then
    echo "secret guard: ${FIXTURE_ALLOWLIST_RELPATH} exists but python3 is unavailable; refusing to load the registry (fail-closed)" >&2
    exit 1
  fi

  local payload rc=0
  payload="$(FIXTURE_ALLOWLIST_ROOT="$ROOT" FIXTURE_ALLOWLIST_PATH="$FIXTURE_ALLOWLIST_PATH" python3 - <<'ALLOWLIST_PY'
import json
import os
import re
import sys

ROOT = os.environ["FIXTURE_ALLOWLIST_ROOT"]
PATH = os.environ["FIXTURE_ALLOWLIST_PATH"]
REL = os.path.relpath(PATH, ROOT).replace(os.sep, "/")


def die(message):
    sys.stderr.write("secret guard: %s: %s\n" % (REL, message))
    sys.exit(1)


try:
    with open(PATH, encoding="utf-8") as handle:
        doc = json.load(handle)
except Exception as exc:  # fail-closed on any parse problem
    die("registry is not valid JSON (%s)" % exc.__class__.__name__)

# 与 check-secrets.sh 的六条字面量规则一一对应。bash 侧开了 nocasematch，
# 所以这里也用 IGNORECASE，保证「登记器认可的形状」==「门禁会匹配的形状」。
SHAPES = [
    r"AKIA[0-9A-Z]{16}",
    r"gh[pousr]_[A-Za-z0-9_]{20,}",
    r"xox[baprs]-[A-Za-z0-9-]{20,}",
    r"AIza[0-9A-Za-z_-]{35}",
    r"sk-[A-Za-z0-9_-]{24,}",
    r"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}",
]
TOP_FIELDS = {"_comment", "version", "maxEntries", "entries"}
ENTRY_FIELDS = ("path", "literal", "owner", "review", "reason")

if not isinstance(doc, dict):
    die("top level must be an object")
unknown_top = sorted(set(doc) - TOP_FIELDS)
if unknown_top:
    die("unknown top-level fields %s (field set is fixed)" % unknown_top)
if doc.get("version") != 1:
    die("version must be 1")
entries = doc.get("entries")
if not isinstance(entries, list):
    die("entries must be an array")
max_entries = doc.get("maxEntries")
if isinstance(max_entries, bool) or not isinstance(max_entries, int) or max_entries < 1:
    die("maxEntries must be a positive integer")
if len(entries) > max_entries:
    die(
        "entry count %d exceeds maxEntries %d (widening the allow surface must raise "
        "maxEntries in the same PR so review sees it)" % (len(entries), max_entries)
    )

seen = set()
rows = []
for index, entry in enumerate(entries):
    if not isinstance(entry, dict):
        die("entries[%d] must be an object" % index)
    unknown = sorted(set(entry) - set(ENTRY_FIELDS))
    if unknown:
        die("entries[%d] has unknown fields %s" % (index, unknown))
    missing = [field for field in ENTRY_FIELDS if field not in entry]
    if missing:
        die("entries[%d] is missing required fields %s" % (index, missing))
    values = {}
    for field in ENTRY_FIELDS:
        value = entry[field]
        if not isinstance(value, str) or not value.strip():
            die("entries[%d].%s must be a non-empty string" % (index, field))
        if value != value.strip():
            die("entries[%d].%s has leading/trailing whitespace" % (index, field))
        values[field] = value
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", values["review"]):
        die("entries[%d].review must be YYYY-MM-DD" % index)

    path = values["path"]
    literal = values["literal"]
    if any(char in path for char in "*?[]\\") or path.startswith("/") or path.endswith("/"):
        die(
            "entries[%d].path must be an exact repo-relative path; glob, absolute and "
            "directory-wide entries are forbidden (ADR-028)" % index
        )
    if ".." in path.split("/"):
        die("entries[%d].path must not contain '..'" % index)
    if re.search(r"\s", literal):
        die(
            "entries[%d].literal must not contain whitespace (private-key blocks and "
            "other whitespace-bearing shapes are not registrable)" % index
        )
    if not any(re.fullmatch(shape, literal, re.IGNORECASE) for shape in SHAPES):
        die(
            "entries[%d].literal is not exactly one of the six literal-rule shapes; "
            "registering it would change nothing (dead entries are forbidden)" % index
        )
    full = os.path.join(ROOT, path)
    if not os.path.isfile(full):
        die("entries[%d].path does not exist in the repo: %s" % (index, path))
    try:
        with open(full, encoding="utf-8", errors="replace") as handle:
            text = handle.read()
    except OSError as exc:
        die("entries[%d].path could not be read: %s" % (index, exc.__class__.__name__))
    if literal not in text:
        die(
            "entries[%d].literal does not occur in its registered path %s (moving a "
            "literal to another path must re-register it)" % (index, path)
        )
    key = (path, literal)
    if key in seen:
        die("entries[%d] duplicates an earlier entry for %s" % (index, path))
    seen.add(key)
    rows.append(path + "\x1f" + literal)

sys.stdout.write("".join(row + "\n" for row in rows))
ALLOWLIST_PY
)" || rc=$?

  if [[ "$rc" -ne 0 ]]; then
    exit 1
  fi

  local entry_path entry_literal
  while IFS=$'\x1f' read -r entry_path entry_literal; do
    [[ -z "$entry_path" ]] && continue
    FIXTURE_ALLOWLIST["${entry_path}"$'\x1f'"${entry_literal}"]=1
    FIXTURE_LITERALS["${entry_literal}"]=1
  done <<< "$payload"
}

is_registered_fixture() {
  local path="$1" literal="$2"
  [[ -n "$literal" ]] || return 1
  if [[ -n "${FIXTURE_ALLOWLIST["${path}"$'\x1f'"${literal}"]:-}" ]]; then
    return 0
  fi
  # 登记簿文件自身：凭据形状字面量必须是已登记 literal 之一（没有路径豁免）。
  if [[ "$path" == "$FIXTURE_ALLOWLIST_RELPATH" && -n "${FIXTURE_LITERALS["${literal}"]:-}" ]]; then
    return 0
  fi
  return 1
}

# 对一行里的**每一处**匹配都判一次：旧实现只看第一处，一行同时含已登记夹具与
# 未登记真凭据时会漏掉后者。第一处未登记即报，保持「每规则每行至多一条」。
scan_literal_rule() {
  local path="$1" line_no="$2" kind="$3" pattern="$4" rest="$5"
  local full boundary literal
  while [[ "$rest" =~ $pattern ]]; do
    full="${BASH_REMATCH[0]}"
    boundary="${BASH_REMATCH[1]-}"
    literal="${full:${#boundary}}"
    if ! is_registered_fixture "$path" "$literal"; then
      report "$path" "$line_no" "$kind"
      return
    fi
    rest="${rest#*"$full"}"
  done
}

load_fixture_allowlist

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

  # 字面量规则统一要求 token 前缀落在**词边界**上（行首或前一个字符不是字母数字）。
  # 这些前缀（AKIA/ghp_/xox?-/AIza/sk-/eyJ）本身就是"凭据 token 的开头"，真凭据在
  # 源码/配置/日志里总是出现在引号、空白、`=`、`:`、`,` 之后；无边界匹配会把良性
  # kebab-case 标识符判成凭据——实测全仓唯一一例：
  # `taskID := "task-backfill-mismatch-conflict"`（ta**sk-**backfill-mismatch-conflict，
  # `sk-` 后 26 个 [A-Za-z0-9_-]）命中 sk- 规则，于是任何搬动这行的重构都被 CI 判红
  # （#2295）。加边界后全树 15 处旧命中里 14 处不变、只少这一处误报；六种 token 形状
  # 各在一种边界位置（行首 / " / = / 空格 / : / ,）由自测覆盖，仍全部判红。
  if [[ "$trimmed" =~ -----BEGIN[[:space:]]+.*PRIVATE[[:space:]]+KEY----- ]]; then
    report "$path" "$line_no" "private key block detected"
  fi

  scan_literal_rule "$path" "$line_no" "possible AWS access key detected" \
    '(^|[^A-Za-z0-9])AKIA[0-9A-Z]{16}' "$trimmed"
  scan_literal_rule "$path" "$line_no" "possible GitHub token detected" \
    '(^|[^A-Za-z0-9])gh[pousr]_[A-Za-z0-9_]{20,}' "$trimmed"
  scan_literal_rule "$path" "$line_no" "possible Slack token detected" \
    '(^|[^A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{20,}' "$trimmed"
  scan_literal_rule "$path" "$line_no" "possible Google API key detected" \
    '(^|[^A-Za-z0-9])AIza[0-9A-Za-z_-]{35}' "$trimmed"
  scan_literal_rule "$path" "$line_no" "possible API key detected" \
    '(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{24,}' "$trimmed"
  scan_literal_rule "$path" "$line_no" "possible JWT detected" \
    '(^|[^A-Za-z0-9])eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}' "$trimmed"

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

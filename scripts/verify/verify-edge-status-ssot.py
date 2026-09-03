#!/usr/bin/env python3
"""verify-edge-status-ssot — edge 错误响应 HTTP status 单源门禁（#2245 阶段 2）。

规则（机器门禁，对应 errcode.Write 文档注释里那句「Edge 错误响应的 status 只有
这一个来源」）：

  1. `edge-server/` 下**非 `_test.go`** 的 `.go` 文件里，`ErrorBody(` 只允许出现
     在白名单里（errcode 包自身的定义 + Write、以及 handlers_events.go 那个
     必须携带冲突 run 标识的富信封）。
  2. 同一批文件里，`writeJSON(w, <status>, …)` / `resputil.WriteJSON(w, <status>, …)`
     的 `<status>` 不允许是 `http.Status*` 字面量，白名单只放过 internal/mcp
     的 3 处 `http.StatusOK`（JSON-RPC 2.0：传输层恒 200，错误在 body 里）。
  3. 白名单里的富信封 builder（activeRunExistsResponse）被调用时，status 参数
     必须逐字等于 `errcode.ErrActiveRunExists.HTTPStatus`，不能是字面量。
  4. `errcode.Write` 自身必须把 `e.HTTPStatus` 传给 resputil.WriteJSON——把
     helper 改成硬编码 500 会同时绕过 1/2/3，所以这条单独钉住。

为什么需要它：#2245 之前 edge 有 167 个调用点各自手抄一遍 status，而 status 的
定义在 errcode 表里。手抄不会报错，只会在某一天与表分岔——已经实证过两批：
delivery_journal 的 503/500 配 bad_request（阶段 1 修掉），以及 PostRuns 的
capability 检查把「Hub identity 在但 HubJWTSecret 空」这条**运维配置错误**
（not_configured，按定义 503）手抄成 403 并在注释里写下「Failures are always
403」，于是服务端配错被当成「你的凭据不对，别重试」告诉客户端（本阶段修掉，
openapi 同步补 POST /v1/runs 的 503）。收敛一次很容易，不再漂回去才是目的。

设计要点：
  * 白名单的键是「文件路径 + 允许命中次数（+ 允许的字面量集合）」，**不是行号**。
    行号会随代码移动腐化，次数不会。
  * 匹配前先剥掉 Go 注释与字符串/反引号字面量。errcode/codes.go 的文档注释里
    就写着 `writeJSON(w, e.HTTPStatus, ErrorBody(e))`（本门禁自己被它引用），
    按原始文本数会把说明文字算成命中。
  * 成功响应（`writeSuccess(w, http.StatusOK, …)`）与 /v1/health 那种「status 由
    健康聚合结果算出来」的站点**不在**本门禁范围内：它们不是错误信封，没有
    errcode 表可对，手写字面量正是它们该有的样子。
  * fail-closed：扫描根不存在、一个 `.go` 都没扫到、文件读不出来、剥注释自检
    不过、白名单条目指向已消失的文件、「白名单期望 N 处却扫到更少」的瞎扫描器，
    一律非 0 退出。绝不「什么都没找到」就报绿。

用法：
  python3 scripts/verify/verify-edge-status-ssot.py                # 真实仓库
  python3 scripts/verify/verify-edge-status-ssot.py --Root <dir>    # 夹具

stdlib only；退出码 0=通过 / 1=失败；机器可读行沿用仓库既有的
`  PASS  ` / `  FAIL  ` 格式。
"""

import argparse
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))

# 扫描根。#2245 是 edge 专属：hub 侧的错误信封早就走 handler.Fail(c, e)，status
# 由 e.HTTPStatus 派生（hub-server/internal/handler/response.go），没有手抄面。
SCAN_ROOT = "edge-server"

# 规则 1 白名单：文件路径（相对仓库根，正斜杠）→ (允许的 ErrorBody( 命中次数, 理由)。
ERRORBODY_ALLOWLIST = {
    "edge-server/internal/errcode/codes.go": (
        2,
        "the single source itself: `func ErrorBody` (the definition) plus the one "
        "sanctioned caller `Write`, which pairs it with e.HTTPStatus",
    ),
    "edge-server/internal/api/handlers_events.go": (
        1,
        "activeRunExistsResponse: the 409 body must carry the conflicting run's "
        "runId/projectId/threadId/status next to the error envelope so the client "
        "can offer to cancel or attach; errcode.Write writes a fixed envelope. The "
        "status is still derived (rule 3 pins it), so this exemption cannot grow a "
        "hand-copied status",
    ),
}

# 规则 2 白名单：文件路径 → (允许的 writeJSON(w, http.Status*, …) 次数, 允许的字面量集合, 理由)。
STATUS_LITERAL_ALLOWLIST = {
    "edge-server/internal/mcp/server.go": (
        3,
        frozenset({"http.StatusOK"}),
        "JSON-RPC 2.0 transport: the HTTP status is always 200 and the error lives "
        "in the body (errorResponse), including for the success/result writes. "
        "This is not an errcode envelope and has no table entry to derive from",
    ),
}

# 规则 3：富信封 builder → 调用点必须逐字传入的 status 表达式。
ENVELOPE_STATUS_PAIRING = {
    "activeRunExistsResponse": "errcode.ErrActiveRunExists.HTTPStatus",
}

# 规则 4：errcode.Write 自身必须把 e.HTTPStatus 交出去。
ERRCODE_CODES_REL = "edge-server/internal/errcode/codes.go"
WRITE_STATUS_EXPR = "e.HTTPStatus"

# --- 正则 ---

# ErrorBody( —— 带任意接收者（errcode.ErrorBody / sharederr.ErrorBody / 包内裸调用），
# 也匹配 `func ErrorBody(`（定义本身算一次命中，白名单按此计数）。
ERRORBODY_RE = re.compile(r"(?<![A-Za-z0-9_$])ErrorBody\s*\(")

# writeJSON(w, http.StatusXxx, …) / resputil.WriteJSON(w, http.StatusXxx, …)。
# 只认第一个实参是 w 的形态，所以 websocket 的 conn.WriteJSON(evt) 与
# `func writeJSON(w http.ResponseWriter, status int, v any)` 定义都不会被匹配。
STATUS_LITERAL_RE = re.compile(
    r"(?<![A-Za-z0-9_$.])(?:resputil\.)?[Ww]riteJSON\s*\(\s*w\s*,\s*(http\.Status[A-Za-z0-9_]+)\s*,"
)

# writeJSON(w, <status>, <builder>( … )) —— 捕获 status 表达式。
def _pairing_re(builder: str) -> re.Pattern:
    return re.compile(
        r"(?<![A-Za-z0-9_$.])(?:resputil\.)?[Ww]riteJSON\s*\(\s*w\s*,\s*([^,]+?)\s*,\s*"
        + re.escape(builder)
        + r"\s*\("
    )


# Write 内部把 status 交给 resputil 的那一行。
WRITE_CALL_RE = re.compile(
    r"(?<![A-Za-z0-9_$.])resputil\.WriteJSON\s*\(\s*w\s*,\s*([^,]+?)\s*,\s*ErrorBody\s*\("
)


class StripError(Exception):
    """剥注释/字符串的扫描器遇到无法解析的输入。fail-closed：不猜，直接红。"""


def strip_go_comments_and_literals(source: str) -> str:
    """把 Go 源码里的注释与字符串/反引号/字符字面量替换成等长空白。

    等长替换（而不是删除）是为了让后续的行号仍然对得上原文，输出才有用。
    识别：`//` 行注释、`/* */` 块注释、`"..."` 解释字符串、`` `...` `` 原始字符串、
    `'...'` rune 字面量。与 verify-safego-convergence.py 同款实现（两个门禁都
    必须自带剥注释器：scripts/verify 下的文件名带连字符，无法互相 import）。
    """
    out = []
    i = 0
    n = len(source)
    while i < n:
        c = source[i]

        if c == "/" and i + 1 < n and source[i + 1] == "/":
            j = source.find("\n", i)
            if j == -1:
                j = n
            out.append(_blank(source[i:j]))
            i = j
            continue

        if c == "/" and i + 1 < n and source[i + 1] == "*":
            j = source.find("*/", i + 2)
            if j == -1:
                raise StripError("unterminated /* block comment")
            j += 2
            out.append(_blank(source[i:j], keep_newlines=True))
            i = j
            continue

        if c == '"':
            j = i + 1
            while j < n:
                if source[j] == "\\":
                    j += 2
                    continue
                if source[j] == '"':
                    j += 1
                    break
                if source[j] == "\n":
                    raise StripError('unterminated " string literal')
                j += 1
            else:
                raise StripError('unterminated " string literal at EOF')
            out.append(_blank(source[i:j], keep_newlines=True))
            i = j
            continue

        if c == "`":
            j = source.find("`", i + 1)
            if j == -1:
                raise StripError("unterminated ` raw string literal")
            j += 1
            out.append(_blank(source[i:j], keep_newlines=True))
            i = j
            continue

        if c == "'":
            j = i + 1
            while j < n:
                if source[j] == "\\":
                    j += 2
                    continue
                if source[j] == "'":
                    j += 1
                    break
                if source[j] == "\n":
                    raise StripError("unterminated ' rune literal")
                j += 1
            else:
                raise StripError("unterminated ' rune literal at EOF")
            out.append(_blank(source[i:j]))
            i = j
            continue

        out.append(c)
        i += 1

    stripped = "".join(out)
    if len(stripped) != n:
        raise StripError(f"stripper changed length {n} -> {len(stripped)}; line numbers would drift")
    return stripped


def _blank(text: str, keep_newlines: bool = False) -> str:
    if keep_newlines:
        return "".join("\n" if ch == "\n" else " " for ch in text)
    return " " * len(text)


def self_check_stripper() -> list:
    """剥注释器的自检。它一旦出错就会「吃掉」真实命中造成假绿，所以开机先验。"""
    cases = [
        ('errcode.Write(w, err)', 0, 0, "a converged site has neither pattern"),
        ('writeJSON(w, http.StatusForbidden, errcode.ErrorBody(err))', 1, 1, "the exact shape #2245 removed"),
        ('// writeJSON(w, http.StatusForbidden, errcode.ErrorBody(err))\n', 0, 0, "line comment must not count"),
        ('/* errcode.ErrorBody(err) */\n', 0, 0, "block comment must not count"),
        ('var s = "errcode.ErrorBody(err)"\n', 0, 0, "interpreted string must not count"),
        ('var s = `writeJSON(w, http.StatusTeapot, ErrorBody(e))`\n', 0, 0, "raw string must not count"),
        ('resputil.WriteJSON(w, http.StatusNotFound, body)', 0, 1, "qualified helper counts for rule 2 only"),
        ('resputil.WriteJSON(w, e.HTTPStatus, ErrorBody(e))', 1, 0, "derived status counts for rule 1 only"),
        ('conn.WriteJSON(evt)', 0, 0, "websocket write is not an HTTP status site"),
        ('func writeJSON(w http.ResponseWriter, status int, v any) {', 0, 0, "the helper definition is not a call"),
        ('writeSuccess(w, http.StatusOK, listResponse(items))', 0, 0, "success envelope is out of scope"),
        ('writeJSON(w, errcode.ErrActiveRunExists.HTTPStatus, activeRunExistsResponse(active))', 0, 0, "derived pairing is clean"),
    ]
    problems = []
    for source, want_body, want_status, label in cases:
        try:
            stripped = strip_go_comments_and_literals(source)
        except StripError as exc:
            problems.append(f"{label}: stripper raised {exc}")
            continue
        got_body = len(ERRORBODY_RE.findall(stripped))
        got_status = len(STATUS_LITERAL_RE.findall(stripped))
        if got_body != want_body:
            problems.append(f"{label}: ErrorBody hits = {got_body}, want {want_body}")
        if got_status != want_status:
            problems.append(f"{label}: status-literal hits = {got_status}, want {want_status}")
    return problems


def line_of_offset(source: str, offset: int) -> int:
    return source.count("\n", 0, offset) + 1


def collect_go_files(root: str) -> list:
    """收集 root 下所有非 _test.go 的 .go 文件（相对仓库根的正斜杠路径）。"""
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in (".git", "vendor", "node_modules"))
        for name in sorted(filenames):
            if not name.endswith(".go") or name.endswith("_test.go"):
                continue
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, ROOT).replace(os.sep, "/")
            found.append((rel, full))
    return found


ROOT = REPO_ROOT  # rebound by scan() from --Root


def scan() -> int:
    global ROOT
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--Root",
        "-Root",
        default=REPO_ROOT,
        help="repository root to scan (default: the real repo; tests pass a fixture)",
    )
    args = parser.parse_args()

    passed = 0
    failed = 0

    def pass_check(text: str) -> None:
        nonlocal passed
        passed += 1
        print(f"  PASS  {text}")

    def fail(text: str) -> None:
        nonlocal failed
        failed += 1
        print(f"  FAIL  {text}")

    ROOT = os.path.realpath(args.Root)
    print("\n=== edge error-status single-source gate (#2245) ===")
    print(f"Repo root: {ROOT}")

    if not os.path.isdir(ROOT):
        fail(f"scan root does not exist or is not a directory: {ROOT}")
        return _summary(passed, failed)

    for problem in self_check_stripper():
        fail(f"comment/literal stripper self-check: {problem}")

    scan_root_full = os.path.join(ROOT, SCAN_ROOT)
    if not os.path.isdir(scan_root_full):
        fail(f"scan root missing: {SCAN_ROOT}/ — refusing to report green on an empty input")
        return _summary(passed, failed)

    for rel in sorted(set(ERRORBODY_ALLOWLIST) | set(STATUS_LITERAL_ALLOWLIST) | {ERRCODE_CODES_REL}):
        if not os.path.isfile(os.path.join(ROOT, rel)):
            fail(
                f"required file missing: {rel} — fix the path or remove the exemption "
                "(a stale allow-list entry is how gates rot)"
            )

    go_files = collect_go_files(scan_root_full)
    if not go_files:
        fail(f"scanned 0 non-test .go files under {SCAN_ROOT}/ — empty input must not pass")
        return _summary(passed, failed)

    body_hits = {}      # rel -> [(line, snippet)]
    status_hits = {}    # rel -> [(line, snippet, literal)]
    pairing_hits = {}   # builder -> [(rel, line, status_expr)]
    write_calls = []    # (line, status_expr)
    parse_failures = 0
    sources = {}

    for rel, full in go_files:
        try:
            with open(full, encoding="utf-8-sig", errors="strict") as handle:
                source = handle.read()
        except (OSError, UnicodeDecodeError) as exc:
            fail(f"cannot read {rel}: {exc} (fail-closed: an unreadable file is not a clean file)")
            parse_failures += 1
            continue
        try:
            stripped = strip_go_comments_and_literals(source)
        except StripError as exc:
            fail(f"cannot parse {rel}: {exc} (fail-closed: refusing to guess)")
            parse_failures += 1
            continue

        sources[rel] = source
        lines = source.splitlines()

        def snippet_at(line: int) -> str:
            return lines[line - 1].strip() if 0 < line <= len(lines) else ""

        found = []
        for m in ERRORBODY_RE.finditer(stripped):
            line = line_of_offset(stripped, m.start())
            found.append((line, snippet_at(line)))
        if found:
            body_hits[rel] = found

        found_status = []
        for m in STATUS_LITERAL_RE.finditer(stripped):
            line = line_of_offset(stripped, m.start())
            found_status.append((line, snippet_at(line), m.group(1)))
        if found_status:
            status_hits[rel] = found_status

        for builder in ENVELOPE_STATUS_PAIRING:
            for m in _pairing_re(builder).finditer(stripped):
                line = line_of_offset(stripped, m.start())
                pairing_hits.setdefault(builder, []).append((rel, line, m.group(1).strip()))

        if rel == ERRCODE_CODES_REL:
            for m in WRITE_CALL_RE.finditer(stripped):
                write_calls.append((line_of_offset(stripped, m.start()), m.group(1).strip()))

    total_files = len(go_files)
    print(
        f"Scanned {total_files} non-test .go file(s) under {SCAN_ROOT}/; "
        f"{sum(len(v) for v in body_hits.values())} ErrorBody( hit(s), "
        f"{sum(len(v) for v in status_hits.values())} hand-copied status literal(s)."
    )

    # ---- 规则 1：ErrorBody 调用点白名单 ----
    unexpected_body = []
    for rel in sorted(body_hits):
        count = len(body_hits[rel])
        if rel not in ERRORBODY_ALLOWLIST:
            unexpected_body.append((rel, count, None))
            continue
        allowed, _reason = ERRORBODY_ALLOWLIST[rel]
        if count > allowed:
            unexpected_body.append((rel, count, allowed))

    if unexpected_body:
        for rel, count, allowed in unexpected_body:
            if allowed is None:
                fail(
                    f"{rel}: {count} errcode.ErrorBody( call(s) outside the allow-list — the HTTP "
                    "status is being hand-copied at this call site. Use `errcode.Write(w, err)` so "
                    "the status comes from the error's own table entry; if this site genuinely "
                    "needs a richer envelope, add it to ERRORBODY_ALLOWLIST with a reason AND make "
                    "the status derive from `<err>.HTTPStatus` (see handlers_events.go)"
                )
            else:
                fail(
                    f"{rel}: {count} errcode.ErrorBody( call(s) but the allow-list permits {allowed} — "
                    f"{count - allowed} new hand-copied status site(s) since #2245"
                )
            for line, snip in body_hits[rel]:
                print(f"          {rel}:{line}: {snip}")
    else:
        total = sum(len(v) for v in body_hits.values())
        pass_check(
            f"rule 1: every errcode.ErrorBody( is allow-listed ({total} hit(s) across "
            f"{len(body_hits)} file(s), 0 outside the allow-list)"
        )

    # ---- 规则 2：writeJSON 的 status 不许是字面量 ----
    unexpected_status = []
    for rel in sorted(status_hits):
        hits = status_hits[rel]
        if rel not in STATUS_LITERAL_ALLOWLIST:
            unexpected_status.append((rel, hits, None, None))
            continue
        allowed, permitted, _reason = STATUS_LITERAL_ALLOWLIST[rel]
        if len(hits) > allowed:
            unexpected_status.append((rel, hits, allowed, permitted))
            continue
        bad_literals = sorted({lit for _l, _s, lit in hits if lit not in permitted})
        if bad_literals:
            unexpected_status.append((rel, hits, allowed, permitted))

    if unexpected_status:
        for rel, hits, allowed, permitted in unexpected_status:
            if allowed is None:
                fail(
                    f"{rel}: {len(hits)} writeJSON(w, http.Status*, …) site(s) outside the allow-list — "
                    "an HTTP status literal on a response write is exactly the hand-copy #2245 removed. "
                    "Error envelopes must go through `errcode.Write(w, err)`; success envelopes through "
                    "`writeSuccess(w, http.Status*, …)` (out of scope for this gate)"
                )
            else:
                fail(
                    f"{rel}: {len(hits)} status literal(s) but the allow-list permits {allowed} "
                    f"and only {', '.join(sorted(permitted))}"
                )
            for line, snip, lit in hits:
                print(f"          {rel}:{line}: [{lit}] {snip}")
    else:
        total = sum(len(v) for v in status_hits.values())
        pass_check(
            f"rule 2: no hand-copied http.Status* literal on any writeJSON/WriteJSON error write "
            f"({total} allow-listed hit(s), all JSON-RPC transport-200)"
        )

    # ---- 规则 3：富信封 builder 的 status 必须派生 ----
    for builder, want_expr in sorted(ENVELOPE_STATUS_PAIRING.items()):
        hits = pairing_hits.get(builder, [])
        if not hits:
            fail(
                f"rule 3: found 0 call site(s) of the allow-listed envelope builder {builder}() — "
                "either the exemption in ERRORBODY_ALLOWLIST is stale (remove it) or the scanner "
                "missed the call"
            )
            continue
        bad = [h for h in hits if h[2] != want_expr]
        if bad:
            for rel, line, expr in bad:
                fail(
                    f"rule 3: {rel}:{line} calls {builder}() with status `{expr}`, want `{want_expr}` — "
                    "the richer envelope is allow-listed precisely because its status still derives "
                    "from the error table"
                )
        else:
            pass_check(
                f"rule 3: {builder}() is called with {want_expr} at all {len(hits)} site(s)"
            )

    # ---- 规则 4：errcode.Write 自身必须派生 status ----
    if not write_calls:
        fail(
            "rule 4: no `resputil.WriteJSON(w, …, ErrorBody(e))` call found in "
            f"{ERRCODE_CODES_REL} — errcode.Write is the single source this gate protects; "
            "if its shape changed, update WRITE_CALL_RE rather than let the check go quiet"
        )
    else:
        bad_writes = [(line, expr) for line, expr in write_calls if expr != WRITE_STATUS_EXPR]
        for line, expr in bad_writes:
            fail(
                f"rule 4: {ERRCODE_CODES_REL}:{line} passes `{expr}` as the status to "
                f"resputil.WriteJSON inside errcode.Write, want `{WRITE_STATUS_EXPR}` — the helper "
                "itself must not hand-copy a status"
            )
        if not bad_writes:
            pass_check(
                f"rule 4: errcode.Write passes {WRITE_STATUS_EXPR} to resputil.WriteJSON "
                f"({len(write_calls)} call(s))"
            )

    # ---- 反向哨兵：白名单期望的命中必须真扫到，否则扫描器瞎了（假绿）----
    if parse_failures == 0:
        expected_body = sum(allowed for allowed, _ in ERRORBODY_ALLOWLIST.values())
        actual_body = sum(len(v) for v in body_hits.values())
        if expected_body > 0 and actual_body == 0:
            fail(
                f"scanner found 0 ErrorBody( anywhere but the allow-list expects {expected_body} — "
                "the scanner is blind, refusing to report green"
            )
        elif actual_body < expected_body:
            missing = sorted(
                rel for rel, (allowed, _) in ERRORBODY_ALLOWLIST.items()
                if len(body_hits.get(rel, [])) < allowed
            )
            fail(
                f"allow-list expects {expected_body} ErrorBody( site(s) but the scan found "
                f"{actual_body}; under-count in: {', '.join(missing)} — either the exemption is "
                "stale (remove it) or the scanner missed a hit"
            )

        expected_status = sum(allowed for allowed, _p, _r in STATUS_LITERAL_ALLOWLIST.values())
        actual_status = sum(len(v) for v in status_hits.values())
        if expected_status > actual_status:
            missing = sorted(
                rel for rel, (allowed, _p, _r) in STATUS_LITERAL_ALLOWLIST.items()
                if len(status_hits.get(rel, [])) < allowed
            )
            fail(
                f"allow-list expects {expected_status} JSON-RPC transport-200 write(s) but the scan "
                f"found {actual_status}; under-count in: {', '.join(missing)} — stale exemption or "
                "blind scanner"
            )

    return _summary(passed, failed)


def _summary(passed: int, failed: int) -> int:
    print("\n========================================")
    print(f"  Passed: {passed}  |  Failed: {failed}")
    print("========================================")
    if failed:
        print("edge error-status SSOT gate FAILED")
        return 1
    print("edge error-status SSOT gate ok")
    return 0


def main() -> int:
    return scan()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，任何意外都必须红，绝不假绿
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

#!/usr/bin/env python3
"""verify-safego-convergence — pkg/safego 单一恢复路径门禁（#2246 切片 1）。

规则（机器门禁，对应 pkg/safego 包注释里那句「两台服务都从这里恢复」）：

  hub-server/、edge-server/、pkg/ 下**非 `_test.go`** 的 `.go` 文件里，
  不允许出现白名单之外的裸 `recover()`。

为什么需要它：#2246 之前有 4 处手写 `recover()`，其中 3 处既不记 stack、也不
计数、也不走 PanicObserver —— 正好复现 pkg/safego 包注释自己描述的那个故障模式
（panic 对所有 dashboard 不可见）。收敛一次很容易，不再漂回去才是这条门禁的
目的。

设计要点：
  * 白名单的键是「文件路径 + 该文件允许的命中次数」，**不是行号**。行号会随
    代码移动而腐化，次数不会：文件里多一处裸 recover() 就红。
  * 匹配前先剥掉 Go 注释与字符串/反引号字面量。pkg/safego/safego.go 的文档
    注释里就写着 `recover()`（本门禁自己被它引用），按原始文本数会把这些说明
    文字算成命中，于是每次改注释都要同步改白名单——那正是腐化的开始。
  * fail-closed：扫描根不存在、一个 `.go` 都没扫到、文件读不出来、剥注释自检
    不过，一律非 0 退出。绝不「什么都没找到」就报绿。

用法：
  python3 scripts/verify/verify-safego-convergence.py                # 真实仓库
  python3 scripts/verify/verify-safego-convergence.py --Root <dir>    # 夹具

stdlib only；退出码 0=通过 / 1=失败；机器可读行沿用仓库既有的
`  PASS  ` / `  FAIL  ` 格式。
"""

import argparse
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))

# 扫描根。三个都必须存在——少一个说明 --Root 指错了地方或仓库结构变了，
# 这时「扫不到违规」毫无意义，必须红。
SCAN_ROOTS = ("hub-server", "edge-server", "pkg")

# 白名单：文件路径（相对仓库根，正斜杠）→ (该文件允许的裸 recover() 次数, 理由)。
#
# 键是「路径 + 次数」而不是行号：行号会随代码移动腐化，次数不会。次数**用满**
# 才算正常，多一处即红；文件本身消失也红（见 check_allowlist_files_present），
# 否则豁免会悄悄变成死条目。
ALLOWLIST = {
    # ── HTTP 请求面兜底：必须把 panic 变成写回本次请求 ResponseWriter 的 500，
    #    pkg/safego 的 fire-and-forget 语义做不到这件事。
    "hub-server/internal/middleware/recovery.go": (
        2,
        "Gin CustomRecovery + admin net/http RecoveryHTTPHandler: must write the "
        "HTTP 500 onto the request's own ResponseWriter",
    ),
    "edge-server/internal/httpserver/server_middleware.go": (
        1,
        "Edge net/http recoveryHTTPHandler (outermost wrapper): must write the "
        "HTTP 500 onto the request's own ResponseWriter",
    ),
    "hub-server/internal/middleware/timeout.go": (
        1,
        "timeout middleware's handler goroutine: owns the buffered response and "
        "must flush a 500 into it before signalling done",
    ),
    # ── 需要给调用方一个「有类型的拒绝」：panic 时必须赋命名返回值
    #    (memberIDs=nil, ok=false)，Recover 的 log-and-move-on 语义表达不了。
    #    同文件的 writeLoop 原先也挂在这条下面（次数 2），它不是这个理由——
    #    已按 #2246 追加批收敛到 safego.RecoverInto，次数因此降到 1。
    "hub-server/internal/handler/ws.go": (
        1,
        "canTypeInSession must assign named results (memberIDs=nil, ok=false) so "
        "the caller sees a typed denial, which safego's fire-and-forget Recover "
        "cannot express; writeLoop, the file's other former recovery site, is no "
        "longer allow-listed — it converged to safego.RecoverInto (#2246 "
        "follow-up)",
    ),
    # ── 单一恢复路径自身的实现：Recover / RecoverInto 各一次。
    "pkg/safego/safego.go": (
        2,
        "the single recovery path itself: Recover() and RecoverInto() each call "
        "recover() once, and that is the whole point of the package",
    ),
}

# 剥掉注释与字符串后，裸 recover() 的形态。允许括号内空白（gofmt 不会留，但
# 夹具/手写代码可能有）。
RECOVER_CALL_RE = re.compile(r"(?<![A-Za-z0-9_$.])recover\s*\(\s*\)")


class StripError(Exception):
    """剥注释/字符串的扫描器遇到无法解析的输入。fail-closed：不猜，直接红。"""


def strip_go_comments_and_literals(source: str) -> str:
    """把 Go 源码里的注释与字符串/反引号/字符字面量替换成等长空白。

    等长替换（而不是删除）是为了让后续的行号仍然对得上原文，输出才有用。
    识别：`//` 行注释、`/* */` 块注释、`"..."` 解释字符串（含反斜杠转义）、
    `` `...` `` 原始字符串、`'...'` 字符字面量（含转义）。
    """
    out = []
    i = 0
    n = len(source)
    while i < n:
        c = source[i]
        nxt = source[i + 1] if i + 1 < n else ""

        if c == "/" and nxt == "/":
            j = source.find("\n", i)
            j = n if j == -1 else j
            out.append(_blank(source[i:j]))
            i = j
            continue

        if c == "/" and nxt == "*":
            j = source.find("*/", i + 2)
            if j == -1:
                raise StripError("unterminated /* block comment")
            j += 2
            out.append(_blank(source[i:j]))
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
                    raise StripError("unterminated \" string literal")
                j += 1
            else:
                raise StripError("unterminated \" string literal at EOF")
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
    """剥注释器的自检。它一旦出错就会「吃掉」真实命中造成假绿，所以开机先验。

    返回失败原因列表（空 = 通过）。
    """
    cases = [
        # (输入, 期望命中数, 说明)
        ('func f() { if r := recover(); r != nil {} }', 1, "plain bare recover"),
        ('// recover() in a doc comment\nfunc f() {}\n', 0, "line comment must not count"),
        ('/* recover() recover() */\nfunc f() {}\n', 0, "block comment must not count"),
        ('var s = "recover()"\nfunc f() {}\n', 0, "interpreted string must not count"),
        ('var s = `recover()`\nfunc f() {}\n', 0, "raw string must not count"),
        ('func f() {\n\tdefer recover()\n}\n', 1, "deferred recover"),
        ('func f() { _ = recover( ) }', 1, "whitespace inside parens"),
        ('func f() { p.recover() }', 0, "a method named recover is not the builtin"),
        ('func myrecover() {}\nfunc f() { myrecover() }\n', 0, "identifier suffix must not match"),
        ('func f() {\n\tdefer func() {\n\t\tif r := recover(); r != nil {\n\t\t\t_ = r\n\t\t}\n\t}()\n}\n', 1, "the classic hand-written guard"),
    ]
    problems = []
    for source, want, label in cases:
        try:
            got = len(RECOVER_CALL_RE.findall(strip_go_comments_and_literals(source)))
        except StripError as exc:
            problems.append(f"{label}: stripper raised {exc}")
            continue
        if got != want:
            problems.append(f"{label}: found {got} recover() hit(s), want {want}")
    return problems


def line_of_offset(source: str, offset: int) -> int:
    return source.count("\n", 0, offset) + 1


def collect_go_files(root: str, fail) -> list:
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


ROOT = REPO_ROOT  # rebound by main() from --Root


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
    print("\n=== pkg/safego single-recovery-path gate (#2246) ===")
    print(f"Repo root: {ROOT}")

    if not os.path.isdir(ROOT):
        fail(f"scan root does not exist or is not a directory: {ROOT}")
        return _summary(passed, failed)

    # 剥注释器自检：它错了就是假绿，所以先验它。
    for problem in self_check_stripper():
        fail(f"comment/literal stripper self-check: {problem}")

    # 三个扫描根都必须在。少一个 = 指错地方，「没扫到违规」不能当绿。
    present_roots = []
    for rel in SCAN_ROOTS:
        full = os.path.join(ROOT, rel)
        if not os.path.isdir(full):
            fail(f"required scan root missing: {rel}/ (fail-closed: refusing to report green on a partial tree)")
            continue
        present_roots.append(full)
    if not present_roots:
        return _summary(passed, failed)

    # 白名单条目指向的文件必须真实存在，否则豁免会变成无人认领的死条目。
    for rel in sorted(ALLOWLIST):
        if not os.path.isfile(os.path.join(ROOT, rel)):
            fail(
                f"allow-list entry points at a missing file: {rel} — "
                "remove the exemption or fix the path (a stale allow-list entry is how gates rot)"
            )

    go_files = []
    for full_root in present_roots:
        go_files.extend(collect_go_files(full_root, fail))

    if not go_files:
        fail(f"scanned 0 non-test .go files under {', '.join(SCAN_ROOTS)}/ — empty input must not pass")
        return _summary(passed, failed)

    # 逐文件计数。
    hits = {}          # rel -> [(line, snippet)]
    parse_failures = 0
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
        found = []
        for m in RECOVER_CALL_RE.finditer(stripped):
            line = line_of_offset(stripped, m.start())
            original = source.splitlines()[line - 1].strip() if line - 1 < len(source.splitlines()) else ""
            found.append((line, original))
        if found:
            hits[rel] = found

    print(f"Scanned {len(go_files)} non-test .go file(s); {len(hits)} file(s) contain recover().")

    # 命中 vs 白名单。
    unexpected = []
    for rel in sorted(hits):
        count = len(hits[rel])
        if rel not in ALLOWLIST:
            unexpected.append((rel, count, None))
            continue
        allowed, _reason = ALLOWLIST[rel]
        if count > allowed:
            unexpected.append((rel, count, allowed))

    if unexpected:
        for rel, count, allowed in unexpected:
            if allowed is None:
                fail(
                    f"{rel}: {count} bare recover() outside the allow-list — "
                    "converge it to `defer safego.Recover(\"<stable.name>\")` (pkg/safego), "
                    "or, if it genuinely must stay, add the file to ALLOWLIST with a reason"
                )
            else:
                fail(
                    f"{rel}: {count} bare recover() but the allow-list permits {allowed} — "
                    f"{count - allowed} new hand-written recover() site(s) since #2246"
                )
            for line, snippet in hits[rel]:
                print(f"          {rel}:{line}: {snippet}")
    else:
        total = sum(len(v) for v in hits.values())
        pass_check(
            f"every bare recover() is allow-listed ({total} hit(s) across {len(hits)} file(s), "
            "0 outside the allow-list)"
        )

    # 反向哨兵：白名单说有 N 处，实际一处都没扫到 => 扫描器瞎了（假绿）。
    # 只在扫描根齐全、且没有解析失败时判定，避免与上面的 fail 重复噪音。
    if parse_failures == 0 and len(present_roots) == len(SCAN_ROOTS):
        expected_total = sum(allowed for allowed, _ in ALLOWLIST.values())
        actual_total = sum(len(v) for v in hits.values())
        if expected_total > 0 and actual_total == 0:
            fail(
                f"scanner found 0 recover() anywhere but the allow-list expects {expected_total} — "
                "the scanner is blind, refusing to report green"
            )
        elif actual_total < expected_total:
            missing = sorted(
                rel for rel, (allowed, _) in ALLOWLIST.items() if len(hits.get(rel, [])) < allowed
            )
            fail(
                f"allow-list expects {expected_total} recover() site(s) but the scan found {actual_total}; "
                f"under-count in: {', '.join(missing)} — either the exemption is stale (remove it) "
                "or the scanner missed a hit"
            )

    return _summary(passed, failed)


def _summary(passed: int, failed: int) -> int:
    print("\n========================================")
    print(f"  Passed: {passed}  |  Failed: {failed}")
    print("========================================")
    if failed:
        print("safego convergence gate FAILED")
        return 1
    print("safego convergence gate ok")
    return 0


def main() -> int:
    return scan()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，任何意外都必须红，绝不假绿
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

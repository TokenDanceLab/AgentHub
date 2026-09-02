#!/usr/bin/env python3
"""verify-fixture-connection-pinning — sqlite :memory: 夹具连接数钉住门禁（#2154 F-e）。

为什么需要这个门禁
------------------
`agentteam.GetTeamRunState` 的六个独立读通过两层 errgroup 并行发出（#2154 P2-11，
并发上限 `teamRunStateReadConcurrency = 4`）。并行读每条各占一个池连接，前提是
**池里每条连接看到同一个 catalog**。

私有 `":memory:"` DSN 不满足这个前提：`database/sql` 给**每条新连接一个独立的空库**，
所以未钉连接数的私有 `":memory:"` 夹具会让 fan-out 读落到 `no such table` 而不是夹具数据。

更糟的是这个失败**可能是非确定性的**：低竞争时第一个读可能在第二个 goroutine 取连接
之前就完成、从而复用了同一条连接而侥幸通过。也就是说它会以「偶发红」的形态出现，
而不是稳定失败——正是最难查的一类。

`file::memory:?cache=shared` 是**共享缓存**形态，多连接看同一个库，安全，不算违规。

#2227（3f1129b）删除了生产代码里按数据库方言/连接数决定是否扇出的闸门——在生产代码
里 sniff 数据库方言来迁就测试夹具是架构瑕疵——改为把夹具钉到 `SetMaxOpenConns(1)`：
钉到 1 连接后所有读共享这一条连接、因此共享同一个 catalog，**Go 侧仍然并行**，
只是在驱动内排队。本门禁守住这个性质不被后来的新夹具破坏。

判据
----
file-level（**硬门禁，FAIL**）：一个 `*_test.go` 同时满足
  (a) 去掉注释后出现私有 `":memory:"` DSN；
  (b) 出现 fan-out 读路径符号 `GetTeamRunState` 或 `GetRunState`；
就必须是「已钉」的，否则 FAIL 并打印 `文件:行号`。「已钉」认两种形态：

  形态 1（直接钉）：本文件出现 `SetMaxOpenConns(1)`。
  形态 2（参数化 helper 钉）：本文件把私有 `":memory:"` 与字面连接数 `1` 一起传给
    helper（形如 `setupXxxDSN(t, ":memory:", 1)`），且 `SetMaxOpenConns(` 的调用
    存在于本文件**或同包任一文件**（helper 可能定义在别处）。仓内实例：
    `agentteam/agent_team_test.go` 的 `setupAgentTeamStateSQLite` →
    `setupAgentTeamStateSQLiteDSN(t, ":memory:", 1)` → `SetMaxOpenConns(maxOpenConns)`。

判定需要包级信息，所以实现是**两遍扫描**：先收集每个文件的事实，再按包判定。

package-level（**仅信息性输出，不 FAIL**）：同一个包内 (a) 与 (b) 分居不同文件时
（helper 夹具形态：DB 在 `helpers_test.go` 里建、调用在 `foo_test.go` 里发），
file-level 判据无法归因——单个文件看起来既没有 DSN 也没有钉法。这类包会被列出来
供人工复核。这是本门禁的**已知盲区**，不要把它读成「已覆盖」。

fail-closed：scope 目录不存在、或扫描到 0 个 `_test.go` 文件时 FAIL（不静默通过）。

已知盲区（**不要把这个门禁读成全覆盖**）
--------------------------------------
1. **同一文件里有多处私有 `":memory:"` 夹具时，任意一处钉了就算整个文件已钉**：把 pin
   归因到具体某个 DSN 需要真正的 Go 解析，本门禁不做。若一个文件同时有「已钉的夹具 A」
   和「未钉的夹具 B」，且 B 也走 fan-out 读路径，本门禁**不会**报。
2. **跨文件 helper 归因只是 INFO，不是 FAIL**：DSN 在 `helpers_test.go`、fan-out 调用在
   `foo_test.go` 时，file-level 的两个条件不在同一文件，硬门禁不触发；这类包会被列进
   package-level INFO 供人工复核。
3. **判据锚在符号名 `GetTeamRunState` / `GetRunState` 上**：若这条读路径被改名，或将来
   **新增另一条**并行扇出读路径，本门禁不会自动知道——加新 fan-out 读路径时必须同步更新
   `FANOUT_SYMBOL`。
4. **任何字符串字面量 `":memory:"` 都被当成私有 DSN**（注释已剥掉，但表驱动测试的用例名、
   日志字符串等非 DSN 场景也会被算进去）。方向偏严（可能多要求一次钉），不是偏松。
5. 只扫 `--scope`（默认 `hub-server`）下的 `*_test.go`。`edge-server` 目前不走这条读路径；
   若将来 edge 也引入 fan-out 读 + sqlite 夹具，需要把它加进 scope。

CLI：`--root`（默认仓库根，隔离 fixture 自测用）、`--scope`（可重复，默认 `hub-server`）。
"""

import argparse
import os
import re
import sys

DEFAULT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_SCOPES = ("hub-server",)

# 私有 :memory:（每条新连接一个独立空库）——必须是**去注释后**的代码文本，
# 因为仓内注释里也出现带双引号的 ":memory:"（例如解释这个坑的说明文字），
# 直接匹配会把注释当成违规，毁掉门禁信誉。
PRIVATE_MEMORY = re.compile(r'":memory:"')
# 共享缓存形态：多连接看同一 catalog，安全。只用于信息性统计。
SHARED_MEMORY = re.compile(r'"file::memory:\?cache=shared')
# fan-out 读路径符号。
FANOUT_SYMBOL = re.compile(r"\b(?:GetTeamRunState|GetRunState)\b")
# 钉法形态 1：直接把池锁到单连接。
PIN_DIRECT = re.compile(r"SetMaxOpenConns\(\s*1\s*\)")
# 钉法形态 2 的前半：私有 ":memory:" 与字面连接数 1 一起传给 helper。
PIN_VIA_HELPER = re.compile(r'":memory:"\s*,\s*1\s*\)')
# 钉法形态 2 的后半：连接数确实被应用到池上（参数名任意）。
PIN_APPLY = re.compile(r"SetMaxOpenConns\(")
TEST_FILE = re.compile(r"_test\.go$")


def strip_go_comments(text: str) -> str:
    """把 Go 注释替换成等长空格，保留行号与列号以便给出 file:line 证据。

    手写状态机而不是正则：需要区分字符串字面量/字符字面量里的 `//` 与 `/*`
    （例如 "http://x" 不该被当成行注释起点），以及注释里的引号不该开启字符串态。
    """
    out = []
    i = 0
    n = len(text)
    state = "code"  # code | line | block | str | rune
    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if state == "code":
            if ch == "/" and nxt == "/":
                state = "line"
                out.append("  ")
                i += 2
                continue
            if ch == "/" and nxt == "*":
                state = "block"
                out.append("  ")
                i += 2
                continue
            if ch == '"':
                state = "str"
            elif ch == "'":
                state = "rune"
            out.append(ch)
            i += 1
        elif state == "line":
            if ch == "\n":
                state = "code"
                out.append(ch)
            else:
                out.append(" ")
            i += 1
        elif state == "block":
            if ch == "*" and nxt == "/":
                state = "code"
                out.append("  ")
                i += 2
                continue
            # 保留换行以维持行号
            out.append(ch if ch == "\n" else " ")
            i += 1
        elif state == "str":
            out.append(ch)
            if ch == "\\":
                if nxt:
                    out.append(nxt)
                    i += 2
                    continue
            elif ch == '"' or ch == "\n":
                state = "code"
            i += 1
        elif state == "rune":
            out.append(ch)
            if ch == "\\":
                if nxt:
                    out.append(nxt)
                    i += 2
                    continue
            elif ch == "'" or ch == "\n":
                state = "code"
            i += 1
    return "".join(out)


def walk_sorted(root: str):
    """深度优先 + 每层按名称排序，保证输出顺序稳定（门禁输出必须可 diff）。"""
    for entry in sorted(os.listdir(root)):
        full = os.path.join(root, entry)
        if os.path.isfile(full):
            yield full
        elif os.path.isdir(full):
            yield from walk_sorted(full)


def first_line_of(pattern, text: str):
    """返回 pattern 首次命中的 1-based 行号（text 已保留原始行结构）。"""
    match = pattern.search(text)
    if not match:
        return None
    return text.count("\n", 0, match.start()) + 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Gate: private sqlite :memory: fixtures that can reach the "
                    "GetTeamRunState fan-out read path must pin the pool to one connection (#2154 F-e).",
    )
    parser.add_argument("--root", default=DEFAULT_ROOT, help="repo root to scan (default: this repo)")
    parser.add_argument(
        "--scope",
        action="append",
        default=None,
        help="directory to scan, relative to --root (repeatable; default: hub-server)",
    )
    args = parser.parse_args()
    scopes = tuple(args.scope) if args.scope else DEFAULT_SCOPES

    passed = 0
    failed = 0

    def pass_line(text: str) -> None:
        nonlocal passed
        passed += 1
        print(f"  PASS  {text}")

    def fail_line(text: str) -> None:
        nonlocal failed
        failed += 1
        print(f"  FAIL  {text}")

    # ---- 第一遍：收集每个测试文件的事实（判定需要包级信息，故分两遍） ----
    records = []
    scanned_files = 0

    for scope in scopes:
        scope_root = os.path.join(args.root, *scope.split("/"))
        if not os.path.isdir(scope_root):
            # fail-closed：扫描面不存在绝不能静默通过（否则改个目录名就能废掉门禁）
            fail_line(f"scan scope does not exist: {scope}")
            continue

        for path in walk_sorted(scope_root):
            if not TEST_FILE.search(path):
                continue
            scanned_files += 1
            rel = os.path.relpath(path, args.root).replace(os.sep, "/")
            try:
                with open(path, "r", encoding="utf-8") as handle:
                    raw = handle.read()
            except (OSError, UnicodeDecodeError) as exc:
                fail_line(f"cannot read test file {rel}: {exc}")
                continue

            code = strip_go_comments(raw)
            records.append({
                "rel": rel,
                "pkg": os.path.dirname(rel),
                "private": bool(PRIVATE_MEMORY.search(code)),
                "shared": bool(SHARED_MEMORY.search(code)),
                "fanout": bool(FANOUT_SYMBOL.search(code)),
                "private_line": first_line_of(PRIVATE_MEMORY, code),
                "fanout_line": first_line_of(FANOUT_SYMBOL, code),
                "pin_direct_line": first_line_of(PIN_DIRECT, code),
                "pin_helper_line": first_line_of(PIN_VIA_HELPER, code),
                "pin_apply": bool(PIN_APPLY.search(code)),
            })

    if scanned_files == 0:
        # fail-closed：空扫描绝不通过
        fail_line("no *_test.go files found in the scan scope — refusing to pass on an empty scan")

    # 形态 2 允许 helper 定义在同包的另一个文件里，所以先算出「哪些包确实把连接数应用到池上」
    pkg_applies_pin = {
        pkg for pkg in {rec["pkg"] for rec in records}
        if any(rec["pin_apply"] for rec in records if rec["pkg"] == pkg)
    }

    # ---- 第二遍：先定「已钉」形态，再跑硬门禁 ----
    for rec in records:
        if rec["pin_direct_line"] is not None:
            rec["pinned"], rec["pin_form"] = True, "direct SetMaxOpenConns(1)"
        elif rec["pin_helper_line"] is not None and (rec["pin_apply"] or rec["pkg"] in pkg_applies_pin):
            where = "this file" if rec["pin_apply"] else "another file in the same package"
            rec["pinned"] = True
            rec["pin_form"] = (
                "parameterized helper (connection-count literal 1; SetMaxOpenConns applied in "
                + where + ")"
            )
        else:
            rec["pinned"], rec["pin_form"] = False, ""

    for rec in records:
        if not (rec["private"] and rec["fanout"]):
            continue
        if rec["pinned"]:
            line = rec["pin_direct_line"] if rec["pin_direct_line"] is not None else rec["pin_helper_line"]
            pass_line(
                f"{rec['rel']}:{line} — private :memory: fixture reaching the fan-out read path "
                f"is pinned to one connection via {rec['pin_form']}"
            )
            continue
        fail_line(
            f"{rec['rel']}:{rec['private_line']} — private \":memory:\" DSN (fan-out symbol at "
            f":{rec['fanout_line']}) but the pool is not pinned to one connection: every NEW pooled "
            f"connection gets its own empty database, so GetTeamRunState's parallel reads land on "
            f"\"no such table\". The failure can be non-deterministic (a fast first read may reuse "
            f"the same connection and pass). Pin it with sqlDB.SetMaxOpenConns(1), pass a literal "
            f"connection count of 1 to the shared fixture helper, or use a "
            f"\"file::memory:?cache=shared\" DSN so every connection shares one catalog."
        )

    # package-level 信息性输出（不 FAIL）：file-level 判据的已知盲区——helper 夹具形态下
    # (a) 与 (b) 分居不同文件，单看任何一个文件都不构成违规，只能列出来供人工复核。
    packages = {}
    for rec in records:
        bucket = packages.setdefault(
            rec["pkg"],
            {"private_unpinned": [], "fanout": [], "shared": [], "colocated_unpinned": []},
        )
        if rec["private"] and not rec["pinned"]:
            bucket["private_unpinned"].append(rec["rel"])
        if rec["fanout"]:
            bucket["fanout"].append(rec["rel"])
        if rec["shared"]:
            bucket["shared"].append(rec["rel"])
        if rec["private"] and rec["fanout"] and not rec["pinned"]:
            # 已被 file-level 硬门禁 FAIL，package-level 不再重复报告
            bucket["colocated_unpinned"].append(rec["rel"])

    cross_file = []
    for pkg in sorted(packages):
        info = packages[pkg]
        if not info["fanout"] or not info["private_unpinned"] or info["colocated_unpinned"]:
            continue
        cross_file.append((pkg, info))

    if cross_file:
        print()
        print("  INFO  package-level review candidates (the file-level gate cannot attribute these):")
        for pkg, info in cross_file:
            fanout_files = ", ".join(os.path.basename(f) for f in info["fanout"])
            unpinned = ", ".join(os.path.basename(f) for f in info["private_unpinned"])
            print(
                f"        {pkg}: fan-out symbol in [{fanout_files}] while unpinned private "
                f'":memory:" fixtures live in [{unpinned}]. If any of those fixtures builds the DB '
                "that the fan-out call actually reads, pin it. This gate does NOT fail here: with the "
                "DSN and the call in different files it cannot prove attribution (helper-fixture "
                "shape) — see the blind-spot list in the PR/issue."
            )
        print()

    shared_count = sum(len(info["shared"]) for info in packages.values())
    print()
    if failed > 0:
        print(f"Fixture connection pinning: {failed} FAIL, {passed} pass ({scanned_files} test files scanned, {shared_count} shared-cache fixtures exempt)")
        return 1
    print(
        f"fixture connection pinning ok ({passed} pinned fan-out fixtures, "
        f"{scanned_files} test files scanned, {shared_count} shared-cache fixtures exempt)"
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，fail-closed
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

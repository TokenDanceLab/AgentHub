#!/usr/bin/env python3
"""verify-i18n-terminology — zh 用户可见文案术语收敛门禁（fail-closed）。

背景（#2154 术语漂移收敛，round-38）：产品可见面曾混用「对话」与「会话」，
收敛结论是 zh 可见文案统一「会话」；代码标识符保留领域语义
（Thread=后端线程实体、Conversation=UI 会话、chat=功能域名）。

本门禁扫描 i18n 资源定义面（zh locale 文件与内嵌 zh 资源字面量），
禁止出现术语「对话」（豁免「对话框」——指 dialog，属不同概念）。
硬编码残留与 demo/fixture 数据域不在本门禁范围（由既有清理轮与
callsite/dead-key 门禁分治）；新增用户可见文案一律走资源定义面，
因此收敛在定义面棘轮即可防止回漂。
"""

import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
for _ in range(4):
    if os.path.isfile(os.path.join(ROOT, "AGENTS.md")):
        break
    ROOT = os.path.dirname(ROOT)
else:
    raise RuntimeError("cannot locate AgentHub repository root")

# zh 资源定义面：用户可见中文文案的 SSOT 入口。
ZH_DEFINITION_SOURCES = [
    "app/web/src/i18n/locales/zh/**/*.json",
    "app/desktop/src/i18n/locales/zh*.json",
    "app/shared/src/chatview/i18n/resources.ts",
    "app/shared/src/i18n/workbench.ts",
    "app/mobile-rn/src/i18n/strings.ts",
]

# 「对话」后紧跟「框」= 对话框（dialog），豁免。
TERM_RE = re.compile(r"对话(?!框)")


def candidate_files() -> list:
    files = []
    for pattern in ZH_DEFINITION_SOURCES:
        files.extend(sorted(glob.glob(os.path.join(ROOT, pattern), recursive=True)))
    return files


def main() -> int:
    violations = []
    scanned = 0
    for path in candidate_files():
        rel = os.path.relpath(path, ROOT)
        scanned += 1
        with open(path, encoding="utf-8") as handle:
            for lineno, line in enumerate(handle, 1):
                if TERM_RE.search(line):
                    violations.append(f"{rel}:{lineno}: {line.strip()}")

    if violations:
        print("i18n terminology gate failed: zh 定义面出现术语「对话」（应统一为「会话」；「对话框」豁免）")
        for item in violations:
            print(f"  {item}")
        return 1

    print(f"i18n terminology gate ok (zh definition surfaces scanned: {scanned})")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""verify-v4-old-ui-active-paths — v4 旧 UI 活动路径边界门禁（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

Desktop/Web v4 不得再路由到已退役的主 workbench UI。

旧工具组件可能暂时仍作为迁移材料、测试或类型 fixture 存在。已退役的
Chat/Prompt/Thread/IM hook 文件必须保持删除，活动 app 源码不得 import 旧 workbench 路径。

用法：
  python scripts/verify/verify-v4-old-ui-active-paths.py
"""

import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PASSED = 0
FAILED = 0

REMOVED_ACTIVE_FILES = (
    "app/desktop/src/config/viewRegistry.ts",
    "app/desktop/src/views/viewRegistry.tsx",
    "app/desktop/src/views/MainView.tsx",
    "app/desktop/src/views/IMView.tsx",
    "app/web/src/viewRegistryConfig.ts",
    "app/web/src/views/viewRegistry.tsx",
    "app/web/src/views/MainView.tsx",
    "app/web/src/views/IMView.tsx",
    "app/desktop/src/components/ChatView.tsx",
    "app/desktop/src/components/ChatView.module.css",
    "app/desktop/src/components/ChatView.types.ts",
    "app/desktop/src/components/PromptInput.tsx",
    "app/desktop/src/components/PromptInput.module.css",
    "app/desktop/src/components/ThreadPanel.tsx",
    "app/desktop/src/components/ThreadPanel.module.css",
    "app/desktop/src/hooks/useChatMessages.ts",
    "app/desktop/src/hooks/useIMChat.ts",
    "app/desktop/src/components/IM/IMBlockRenderer.tsx",
    "app/desktop/src/components/IM/IMBlockRenderer.module.css",
    "app/desktop/src/components/IM/IMMessageView.tsx",
    "app/desktop/src/components/IM/IMMessageView.module.css",
    "app/web/src/components/ChatView.tsx",
    "app/web/src/components/ChatView.module.css",
    "app/web/src/components/ChatView.types.ts",
    "app/web/src/components/PromptInput.tsx",
    "app/web/src/components/PromptInput.module.css",
    "app/web/src/components/ThreadPanel.tsx",
    "app/web/src/components/ThreadPanel.module.css",
    "app/web/src/components/RunDetail.tsx",
    "app/web/src/components/RunDetail.module.css",
    "app/web/src/components/ReplyPreviewBar.tsx",
    "app/web/src/components/ReplyPreviewBar.module.css",
    "app/web/src/hooks/useIMChat.ts",
    "app/web/src/components/IM/IMMessageView.tsx",
    "app/web/src/components/IM/IMMessageView.module.css",
)

# Select-String 默认大小写不敏感，py 侧用 re.IGNORECASE 对齐
FORBIDDEN_IMPORTS = (
    (r"""from ['"]@/components/ChatView['"]|import\(['"]@/components/ChatView['"]\)""", "old ChatView import"),
    (r"""from ['"]@/components/PromptInput['"]|import\(['"]@/components/PromptInput['"]\)""", "old PromptInput import"),
    (r"""from ['"]@/components/RunDetail['"]|import\(['"]@/components/RunDetail['"]\)""", "old RunDetail import"),
    (r"""from ['"]@/components/ThreadPanel['"]|import\(['"]@/components/ThreadPanel['"]\)""", "old ThreadPanel import"),
    (r"""from ['"]@/components/IM/IMBlockRenderer['"]|import\(['"]@/components/IM/IMBlockRenderer['"]\)""", "old IMBlockRenderer import"),
    (r"""from ['"]@/hooks/useChatMessages['"]|import\(['"]@/hooks/useChatMessages['"]\)""", "old useChatMessages import"),
    (r"""from ['"]@/hooks/useIMChat['"]|import\(['"]@/hooks/useIMChat['"]\)""", "old useIMChat import"),
    (r"""from ['"](@/components/ChatView\.types|\./ChatView\.types|\.\./ChatView\.types)['"]|import\(['"](@/components/ChatView\.types|\./ChatView\.types|\.\./ChatView\.types)['"]\)""", "old ChatView.types import"),
    (r"""from ['"]@/(config/viewRegistry|viewRegistryConfig|views/viewRegistry)['"]|import\(['"]@/(config/viewRegistry|viewRegistryConfig|views/viewRegistry)['"]\)""", "old viewRegistry import"),
)

# 活动源码排除：__tests__/__e2e__ 目录与 .test./.spec./.stories. 命名
ACTIVE_EXCLUDE_RE = re.compile(r"\\(__tests__|__e2e__)\\|(\.test|\.spec|\.stories)\.", re.IGNORECASE)

SOURCE_ROOTS = (
    "app/desktop/src",
    "app/web/src",
)


def pass_check(text: str) -> None:
    global PASSED
    PASSED += 1
    print(f"  PASS  {text}")


def fail_check(text: str) -> None:
    global FAILED
    FAILED += 1
    print(f"  FAIL  {text}")


def get_active_source_files() -> list:
    files = []
    for source_root in SOURCE_ROOTS:
        full = os.path.join(ROOT, source_root.replace("/", os.sep))
        for dirpath, dirnames, filenames in os.walk(full):
            dirnames.sort()
            for name in sorted(filenames):
                if not name.endswith((".ts", ".tsx", ".js", ".jsx")):
                    continue
                full_path = os.path.join(dirpath, name)
                if ACTIVE_EXCLUDE_RE.search(full_path):
                    continue
                files.append(full_path)
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description="v4 old UI active path boundary verifier")
    parser.parse_args()

    print("\n=== v4 old UI active path boundary ===")

    for relative_path in REMOVED_ACTIVE_FILES:
        path = os.path.join(ROOT, relative_path.replace("/", os.sep))
        if os.path.isfile(path):
            fail_check(f"{relative_path} should not exist as an active v4 route entry")
        else:
            pass_check(f"{relative_path} remains removed")

    source_files = get_active_source_files()

    for pattern, label in FORBIDDEN_IMPORTS:
        regex = re.compile(pattern, re.IGNORECASE)
        matches = []
        for file_path in source_files:
            with open(file_path, encoding="utf-8", errors="replace") as handle:
                for line_no, line in enumerate(handle, start=1):
                    if regex.search(line):
                        matches.append((file_path, line_no))
        if matches:
            for file_path, line_no in matches:
                rel = os.path.relpath(file_path, ROOT).replace(os.sep, "/")
                fail_check(f"{label} found in {rel}:{line_no}")
        else:
            pass_check(f"{label} absent from active Desktop/Web source")

    print("\n========================================")
    print(f"  Passed: {PASSED}  |  Failed: {FAILED}")
    print("========================================")

    return 1 if FAILED != 0 else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

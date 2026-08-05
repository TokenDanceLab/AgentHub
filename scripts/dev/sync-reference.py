#!/usr/bin/env python3
"""sync-reference — 克隆或更新 public reference 仓库（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

reference 仓库被 git 忽略；只有 reference/INDEX.md 被跟踪。core tier 6 个
仓库，all tier 全部。已存在 .git 的仓库执行 pull --ff-only，存在但非 git
仓库的跳过并告警，其余 clone --depth 1。

契约：stdlib only；参数（-Tier core|all）/输出行（`Updating reference/<name>` /
`Cloning reference/<name>` / `Skipping reference/<name>: directory exists but
is not a git repository` / `Reference sync complete. See reference/INDEX.md
for the full reading map.`）与 ps1 一致；退出码 0=通过。
"""

import argparse
import os
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))

REPOS = [
    {"Tier": "core", "Name": "multica", "Url": "https://github.com/multica-ai/multica.git"},
    {"Tier": "core", "Name": "codex", "Url": "https://github.com/openai/codex.git"},
    {"Tier": "core", "Name": "opencode", "Url": "https://github.com/anomalyco/opencode.git"},
    {"Tier": "core", "Name": "OpenHands", "Url": "https://github.com/All-Hands-AI/OpenHands.git"},
    {"Tier": "core", "Name": "claudecodeui", "Url": "https://github.com/siteboon/claudecodeui.git"},
    {"Tier": "core", "Name": "opcode", "Url": "https://github.com/winfunc/opcode.git"},
    {"Tier": "all", "Name": "aider", "Url": "https://github.com/Aider-AI/aider.git"},
    {"Tier": "all", "Name": "ChatDev", "Url": "https://github.com/OpenBMB/ChatDev.git"},
    {"Tier": "all", "Name": "claude-code-viewer", "Url": "https://github.com/d-kimuson/claude-code-viewer.git"},
    {"Tier": "all", "Name": "claude-code-webui", "Url": "https://github.com/sugyan/claude-code-webui.git"},
    {"Tier": "all", "Name": "cline", "Url": "https://github.com/cline/cline.git"},
    {"Tier": "all", "Name": "continue", "Url": "https://github.com/continuedev/continue.git"},
    {"Tier": "all", "Name": "crush", "Url": "https://github.com/charmbracelet/crush.git"},
    {"Tier": "all", "Name": "dify", "Url": "https://github.com/langgenius/dify.git"},
    {"Tier": "all", "Name": "eca", "Url": "https://github.com/editor-code-assistant/eca.git"},
    {"Tier": "all", "Name": "emdash", "Url": "https://github.com/generalaction/emdash.git"},
    {"Tier": "all", "Name": "Flowise", "Url": "https://github.com/FlowiseAI/Flowise.git"},
    {"Tier": "all", "Name": "goose", "Url": "https://github.com/aaif-goose/goose.git"},
    {"Tier": "all", "Name": "jean", "Url": "https://github.com/coollabsio/jean.git"},
    {"Tier": "all", "Name": "kanna", "Url": "https://github.com/jakemor/kanna.git"},
    {"Tier": "all", "Name": "langflow", "Url": "https://github.com/langflow-ai/langflow.git"},
    {"Tier": "all", "Name": "LibreChat", "Url": "https://github.com/danny-avila/LibreChat.git"},
    {"Tier": "all", "Name": "orca", "Url": "https://github.com/stablyai/orca.git"},
    {"Tier": "all", "Name": "picoclaw", "Url": "https://github.com/sipeed/picoclaw.git"},
    {"Tier": "all", "Name": "Roo-Code", "Url": "https://github.com/RooCodeInc/Roo-Code.git"},
    {"Tier": "all", "Name": "ruflo", "Url": "https://github.com/ruvnet/ruflo.git"},
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--Tier", "-Tier", default="core", choices=["core", "all"])
    args = parser.parse_args()

    repo_root = os.path.realpath(REPO_ROOT)
    reference_root = os.path.join(repo_root, "reference")

    selected = [repo for repo in REPOS if args.Tier == "all" or repo["Tier"] == "core"]

    os.makedirs(reference_root, exist_ok=True)

    for repo in selected:
        target = os.path.join(reference_root, repo["Name"])
        if os.path.isdir(os.path.join(target, ".git")):
            print(f"Updating reference/{repo['Name']}")
            run = subprocess.run(["git", "-C", target, "pull", "--ff-only"])
            if run.returncode != 0:
                raise RuntimeError(f"git pull failed for reference/{repo['Name']} with exit code {run.returncode}")
        elif os.path.exists(target):
            print(f"WARNING: Skipping reference/{repo['Name']}: directory exists but is not a git repository")
        else:
            print(f"Cloning reference/{repo['Name']}")
            run = subprocess.run(["git", "clone", "--depth", "1", repo["Url"], target])
            if run.returncode != 0:
                raise RuntimeError(f"git clone failed for reference/{repo['Name']} with exit code {run.returncode}")

    print("Reference sync complete. See reference/INDEX.md for the full reading map.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'，禁止静默吞错
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

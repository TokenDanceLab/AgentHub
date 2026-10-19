#!/usr/bin/env python3
"""AgentHub WSL 全栈 E2E 编排（stdlib only）。

在 WSL 内以容器形态部署完整栈（tokendance-id + hub-server + PG16 + Redis7），
执行真实 OIDC Authorization Code + PKCE 登录流断言，输出证据 manifest。

本脚本只负责编排（前置检查、WSL 调用、输出解析、证据收集），栈逻辑在
wsl-full-stack-e2e.sh（WSL 侧执行体）。

用法：
  python scripts/e2e/verify-wsl-full-stack-e2e.py
  python scripts/e2e/verify-wsl-full-stack-e2e.py -Keep            # 保留栈便于手动复查
  python scripts/e2e/verify-wsl-full-stack-e2e.py -EvidenceDir .tmp/e2e-evidence
  python scripts/e2e/verify-wsl-full-stack-e2e.py -SrcRoot <parent-checkout> -IdSrc <tokendance-id-checkout>

退出码：0 = 全部断言通过；1 = 任一断言失败或编排失败。
证据：manifest 写入 -EvidenceDir/evidence.json；默认保留 .tmp/e2e-evidence。
"""

import argparse
import os
import shutil
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPT_NAME = "wsl-full-stack-e2e.sh"



def windows_to_wsl_path(win_path: str) -> str:
    """<drive>:/... → /mnt/<drive>/...（脚本与源码根目录透传用）。"""
    win_path = win_path.replace("\\", "/")
    drive = win_path[0].lower()
    return f"/mnt/{drive}{win_path[2:]}"


def to_wsl_path(path: str) -> str:
    """Windows 路径转 WSL 路径；已是 WSL 路径时原样返回。"""
    return windows_to_wsl_path(path) if len(path) >= 2 and path[1] == ":" else path


def detect_wsl_distro() -> str:
    try:
        out = subprocess.run(
            ["wsl", "-l", "-v"], capture_output=True, timeout=30
        ).stdout
    except (subprocess.SubprocessError, FileNotFoundError) as exc:
        print(f"ERROR: cannot query WSL distros: {exc}", file=sys.stderr)
        sys.exit(1)
    # wsl -l -v 输出为 UTF-16LE（带 BOM），先按 utf-16 解码，失败再按 utf-8。
    for encoding in ("utf-16", "utf-8"):
        try:
            text = out.decode(encoding)
            break
        except (UnicodeDecodeError, LookupError):
            continue
    else:
        text = out.decode("utf-8", errors="replace")
    distro = "Ubuntu-24.04"
    for line in text.splitlines():
        if "*" in line:
            parts = line.split()
            # wsl -l -v 行形如 "* Ubuntu-24.04 Running 2"，distro 是第 2 个 token
            if len(parts) >= 2:
                distro = parts[1]
            break
    return distro


def run(script_wsl_path: str, project_name: str, keep: bool, evidence_wsl_dir: str,
        src_root_wsl: str, id_src_wsl: str, distro: str) -> int:
    # Windows 进程的环境变量不会自动传入 WSL；用 distro 内的 env 显式传递。
    cmd = [
        "wsl", "-d", distro, "-e", "env",
        f"AGENTHUB_E2E_SRC_ROOT={src_root_wsl}",
        f"AGENTHUB_E2E_ID_SRC={id_src_wsl}",
        "bash", script_wsl_path, project_name, "1" if keep else "0",
        evidence_wsl_dir,
    ]
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace",
    )
    passed = failed = 0
    result = None
    for line in proc.stdout:
        line = line.rstrip("\n")
        if line.startswith("E2E-PASS:"):
            passed += 1
            print(f"  PASS  {line[len('E2E-PASS: '):]}")
        elif line.startswith("E2E-FAIL:"):
            failed += 1
            print(f"  FAIL  {line[len('E2E-FAIL: '):]}")
        elif line.startswith("E2E-INFO:"):
            print(f"  ...   {line[len('E2E-INFO: '):]}")
        elif line.startswith("E2E-RESULT:"):
            result = line.split(":", 1)[1].strip()
        else:
            # 执行体未结构化的原始输出（例如 docker build 进度）静默降噪
            if line.strip():
                print(f"  [exec] {line}")
    proc.wait()
    print(f"\nE2E summary: passed={passed} failed={failed} result={result or 'N/A'}")
    if failed:
        return 1
    if result == "FAIL":
        return 1
    return 0 if proc.returncode == 0 else 1


def collect_evidence(wsl_evidence_dir: str, local_evidence_dir: str, distro: str) -> None:
    """在 WSL 内把证据复制到 Windows 可见目录（drvfs 跨进程句柄锁
    会导致 Windows 直接读失败，WSL 内 cp 无此问题）。"""
    os.makedirs(local_evidence_dir, exist_ok=True)
    local_wsl = windows_to_wsl_path(os.path.abspath(local_evidence_dir))
    proc = subprocess.run(
        ["wsl", "-d", distro, "-e", "bash", "-c",
         f"cp -f '{wsl_evidence_dir}/evidence.json' '{local_wsl}/' 2>/dev/null; ls '{local_wsl}/'"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=30,
    )
    for name in proc.stdout.split():
        if name:
            print(f"evidence: {name} -> {os.path.join(local_evidence_dir, name)}")
    if proc.returncode != 0:
        print(f"WARN: evidence copy failed: {proc.stderr.strip()}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("-WslDistro", "--WslDistro", default="",
                        help="WSL distro（默认自动探测当前默认发行版）")
    parser.add_argument("-Keep", "--Keep", action="store_true",
                        help="跑完后保留 WSL 栈与源码（默认清理）")
    parser.add_argument("-EvidenceDir", "--EvidenceDir", default=".tmp/e2e-evidence",
                        help="证据输出目录（Windows 路径）")
    parser.add_argument("-SrcRoot", "--SrcRoot", default="/workspace",
                        help="源码根目录（含 AgentHub 子目录；Windows 或 WSL 路径）")
    parser.add_argument("-IdSrc", "--IdSrc", default="",
                        help="tokendance-id 源码目录（Windows 或 WSL 路径；默认 <SrcRoot>/tokendance-id）")
    args = parser.parse_args()

    script_wsl_path = windows_to_wsl_path(os.path.join(SCRIPT_DIR, SCRIPT_NAME))
    if not os.path.isfile(os.path.join(SCRIPT_DIR, SCRIPT_NAME)):
        print(f"ERROR: missing {SCRIPT_NAME} next to this script", file=sys.stderr)
        return 1
    if shutil.which("wsl") is None:
        print("ERROR: wsl executable not found on PATH", file=sys.stderr)
        return 1

    distro = args.WslDistro or detect_wsl_distro()
    print(f"WSL distro: {distro}")
    print(f"harness:    {script_wsl_path}")

    # 证据目录直接用 Windows 路径的 WSL 视图，bash 侧落盘后 python 侧可直接复制
    wsl_evidence_dir = windows_to_wsl_path(os.path.abspath(args.EvidenceDir))
    src_root_wsl = to_wsl_path(args.SrcRoot)
    id_src_wsl = to_wsl_path(args.IdSrc) if args.IdSrc else f"{src_root_wsl.rstrip('/')}/tokendance-id"
    rc = run(script_wsl_path, "agenthub-e2e", args.Keep, wsl_evidence_dir,
             src_root_wsl, id_src_wsl, distro)
    collect_evidence(wsl_evidence_dir, args.EvidenceDir, distro)
    return rc


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\ninterrupted", file=sys.stderr)
        sys.exit(130)

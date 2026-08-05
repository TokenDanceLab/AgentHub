#!/usr/bin/env python3
"""package-android — 打包 AgentHub Mobile Android APK（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

短路径 junction + pnpm virtual store 下安装依赖、expo prebuild 生成原生工程、
gradlew 构建 Debug/Release APK、拷贝产物并写 android-package-manifest.json；
可选 adb 安装/启动。涉及真实 Android 工具链，失败即 exit 1（对齐 ps1 Fail）。

契约：stdlib only；参数名/退出码与 ps1 一致；输出行（`>>> ` / `PASS: `/`FAIL: `）
与原 ps1 一致；manifest JSON 用 ConvertTo-Json 等价格式（2-space indent）。
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT_DIR)))


def step(message: str) -> None:
    print(f"\n>>> {message}")


def fail_check(message: str) -> int:
    print(f"FAIL: {message}")
    return 1


def pass_check(message: str) -> None:
    print(f"PASS: {message}")


def resolve_repo_root(repo_root_arg: str) -> str:
    if repo_root_arg.strip():
        return os.path.realpath(repo_root_arg)
    return os.path.realpath(REPO_ROOT)


def assert_under_repo(path: str, label: str, repo_root: str) -> str:
    full = os.path.abspath(path).rstrip("\\/")
    repo_full = os.path.abspath(repo_root).rstrip("\\/")
    repo_child_prefix = repo_full + os.sep
    if not (full.lower() == repo_full.lower() or full.lower().startswith(repo_child_prefix.lower())):
        raise RuntimeError(f"{label} must stay inside repo worktree: {full}")
    return full


def invoke_cmd_checked(label: str, working_directory: str, command: str) -> int:
    step(label)
    escaped_working_directory = working_directory.rstrip("\\")
    full_command = f'cd /d "{escaped_working_directory}" && {command}'
    run = subprocess.run(["cmd.exe", "/d", "/s", "/c", full_command])
    if run.returncode != 0:
        raise RuntimeError(f"{label} failed with exit code {run.returncode}")
    pass_check(label)
    return 0


def junction_target(path: str):
    try:
        return os.readlink(path)
    except OSError:
        return None


def ensure_short_repo_root(path: str, target: str) -> str:
    short_full = os.path.abspath(path).rstrip("\\")
    target_full = os.path.abspath(target).rstrip("\\")
    if os.path.exists(short_full):
        existing_target = junction_target(short_full)
        existing_full = os.path.abspath(existing_target).rstrip("\\") if existing_target else ""
        target_full = os.path.abspath(target).rstrip("\\")
        if existing_target is None or not existing_full.lower() == target_full.lower():
            raise RuntimeError(f"{short_full} exists and is not the expected junction to {target_full}")

        pass_check(f"{short_full} already points to repo worktree")
        return short_full

    step("Create short repo junction")
    os.makedirs(os.path.dirname(short_full), exist_ok=True)
    # os.system 直传 cmd /c 字符串（subprocess list2cmdline 会把内嵌引号转义成
    # \"，导致 mklink 语法错误；ps1 同样以整串传给 cmd.exe）
    return_code = os.system(f'mklink /J "{short_full}" "{target_full}"')
    if return_code != 0:
        raise RuntimeError(f"mklink /J failed for {short_full} => {target_full}")
    pass_check(f"{short_full} points to {target_full}")
    return short_full


def read_package_version(mobile_root: str) -> str:
    with open(os.path.join(mobile_root, "package.json"), encoding="utf-8-sig") as handle:
        package = json.load(handle)
    return str(package.get("version") or "")


def get_sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except (AttributeError, ValueError):
        pass
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--RepoRoot", "-RepoRoot", default="")
    parser.add_argument("--BuildType", "-BuildType", default="Release", choices=["Release", "Debug"])
    parser.add_argument("--Version", "-Version", default="")
    parser.add_argument("--ShortRepoRoot", "-ShortRepoRoot", default=r"D:\ah\agenthub-mobile")
    parser.add_argument("--VirtualStoreDir", "-VirtualStoreDir", default=r"D:\p\agenthub-mobile")
    parser.add_argument("--ArtifactsRoot", "-ArtifactsRoot", default=r".tmp\android-package")
    parser.add_argument("--InstallSerial", "-InstallSerial", default="")
    parser.add_argument("--SkipInstall", "-SkipInstall", action="store_true")
    parser.add_argument("--SkipPrebuild", "-SkipPrebuild", action="store_true")
    parser.add_argument("--Launch", "-Launch", action="store_true")
    args = parser.parse_args()

    repo_root_resolved = resolve_repo_root(args.RepoRoot)
    mobile_root = os.path.join(repo_root_resolved, "app", "mobile-rn")
    android_root = os.path.join(mobile_root, "android")

    if not os.path.isfile(os.path.join(mobile_root, "package.json")):
        return fail_check(f"AgentHub Mobile package.json not found under {mobile_root}")

    if os.path.isabs(args.ArtifactsRoot):
        resolved_artifacts_root = args.ArtifactsRoot
    else:
        resolved_artifacts_root = os.path.join(repo_root_resolved, args.ArtifactsRoot)
    try:
        resolved_artifacts_root = assert_under_repo(resolved_artifacts_root, "Android artifact root", repo_root_resolved)
    except RuntimeError as exc:
        return fail_check(str(exc))

    if os.path.exists(resolved_artifacts_root):
        import shutil

        shutil.rmtree(resolved_artifacts_root, ignore_errors=True)
    os.makedirs(resolved_artifacts_root, exist_ok=True)

    package_version = read_package_version(mobile_root)
    version = args.Version or package_version

    short_repo_root = ensure_short_repo_root(args.ShortRepoRoot, repo_root_resolved)
    short_app_root = os.path.join(short_repo_root, "app")
    short_mobile_root = os.path.join(short_repo_root, "app", "mobile-rn")
    short_android_root = os.path.join(short_repo_root, "app", "mobile-rn", "android")

    if not os.path.isabs(args.VirtualStoreDir):
        virtual_store_dir = os.path.join(os.path.splitdrive(short_repo_root)[0] or os.sep, args.VirtualStoreDir)
    else:
        virtual_store_dir = args.VirtualStoreDir

    virtual_store_root = os.path.splitdrive(os.path.abspath(virtual_store_dir))[0].rstrip("\\") + "\\"
    short_repo_root_drive = os.path.splitdrive(short_repo_root)[0].rstrip("\\") + "\\"
    if args.BuildType == "Release" and not virtual_store_root.lower() == short_repo_root_drive.lower():
        return fail_check(
            f"Release bundling requires pnpm virtual store and short repo root on the same drive. Got repo={short_repo_root} store={virtual_store_dir}"
        )
    os.makedirs(virtual_store_dir, exist_ok=True)

    gradle_task = "assembleRelease" if args.BuildType == "Release" else "assembleDebug"
    apk_relative = (
        os.path.join("app", "build", "outputs", "apk", "release", "app-release.apk")
        if args.BuildType == "Release"
        else os.path.join("app", "build", "outputs", "apk", "debug", "app-debug.apk")
    )

    step("Android package settings")
    print(f"RepoRoot: {repo_root_resolved}")
    print(f"ShortRepoRoot: {short_repo_root} => {repo_root_resolved}")
    print(f"VirtualStoreDir: {virtual_store_dir}")
    print(f"BuildType: {args.BuildType}")
    print(f"ArtifactsRoot: {resolved_artifacts_root}")

    if not args.SkipInstall:
        invoke_cmd_checked(
            "Install app dependencies with short pnpm virtual store",
            short_app_root,
            f'set CI=true&& corepack.cmd pnpm install --frozen-lockfile --config.virtual-store-dir="{virtual_store_dir}"',
        )

    if not args.SkipPrebuild:
        invoke_cmd_checked(
            "Regenerate Android native project from Expo config",
            short_mobile_root,
            "set NODE_ENV=production&& corepack.cmd pnpm exec expo prebuild --platform android --clean",
        )

    if not os.path.isdir(android_root):
        return fail_check(f"Android native project is missing after prebuild: {android_root}")

    invoke_cmd_checked(
        f"Build Android {args.BuildType} APK with embedded JS bundle",
        short_android_root,
        f"set NODE_ENV=production&& gradlew.bat {gradle_task} --stacktrace --no-daemon",
    )

    apk_path = os.path.join(android_root, apk_relative)
    if not os.path.isfile(apk_path):
        return fail_check(f"APK was not produced: {apk_path}")

    safe_build_type = args.BuildType.lower()
    asset_name = f"AgentHub-Mobile_{version}_android-{safe_build_type}.apk"
    artifact_apk = os.path.join(resolved_artifacts_root, asset_name)
    import shutil

    shutil.copy2(apk_path, artifact_apk)
    apk_hash = get_sha256(artifact_apk)
    apk_size = os.path.getsize(artifact_apk)

    manifest = {
        "mode": "android-mobile-package",
        "package": "tech.vectorcontrol.agenthub.mobile",
        "appLabel": "AgentHub",
        "version": version,
        "packageVersion": package_version,
        "buildType": args.BuildType,
        "repoRoot": repo_root_resolved,
        "shortRepoRoot": short_repo_root,
        "virtualStoreDir": virtual_store_dir,
        "sourceApk": apk_path,
        "artifact": {
            "name": os.path.basename(artifact_apk),
            "path": os.path.abspath(artifact_apk),
            "bytes": apk_size,
            "sha256": apk_hash,
        },
        "stages": {
            "install": "skipped" if args.SkipInstall else "passed",
            "prebuild": "skipped" if args.SkipPrebuild else "passed",
            "gradle": "passed",
        },
        "device": None,
    }

    if args.InstallSerial:
        step(f"Install APK on Android device {args.InstallSerial}")
        install_run = subprocess.run(["adb.exe", "-s", args.InstallSerial, "install", "-r", "-d", "-g", artifact_apk])
        if install_run.returncode != 0:
            raise RuntimeError(f"adb install failed with exit code {install_run.returncode}")
        pass_check("adb install completed")
        model_run = subprocess.run(
            ["adb.exe", "-s", args.InstallSerial, "shell", "getprop", "ro.product.model"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        device_model = model_run.stdout.splitlines()[0] if model_run.stdout.strip() else ""
        manifest["device"] = {
            "serial": args.InstallSerial,
            "model": device_model,
            "installed": True,
            "launched": False,
            "pid": None,
            "focus": None,
        }

        if args.Launch:
            step("Launch AgentHub on Android device")
            launch_run = subprocess.run(
                ["adb.exe", "-s", args.InstallSerial, "shell", "monkey", "-p", "tech.vectorcontrol.agenthub.mobile", "-c", "android.intent.category.LAUNCHER", "1"]
            )
            if launch_run.returncode != 0:
                raise RuntimeError(f"adb launch failed with exit code {launch_run.returncode}")
            import time

            time.sleep(3)
            pid_run = subprocess.run(
                ["adb.exe", "-s", args.InstallSerial, "shell", "pidof", "tech.vectorcontrol.agenthub.mobile"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            focus_run = subprocess.run(
                ["adb.exe", "-s", args.InstallSerial, "shell", "dumpsys", "window"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            focus_lines = [line for line in focus_run.stdout.splitlines() if "mCurrentFocus" in line or "mFocusedApp" in line]
            manifest["device"]["launched"] = True
            manifest["device"]["pid"] = pid_run.stdout.splitlines()[0] if pid_run.stdout.strip() else None
            manifest["device"]["focus"] = focus_lines
            pass_check("AgentHub launch command completed")

    manifest_path = os.path.join(resolved_artifacts_root, "android-package-manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)

    step("Android package complete")
    for name in sorted(os.listdir(resolved_artifacts_root)):
        item_path = os.path.join(resolved_artifacts_root, name)
        if not os.path.isfile(item_path):
            continue
        size_mb = round(os.path.getsize(item_path) / (1024 * 1024), 2)
        print(f"  {name} ({size_mb} MB)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'，禁止静默吞错
        print(f"FAIL: {exc}")
        sys.exit(1)

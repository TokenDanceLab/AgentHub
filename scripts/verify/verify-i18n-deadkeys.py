#!/usr/bin/env python3
"""verify-i18n-deadkeys — web/desktop locale bundles must not carry dead keys.

Fail-closed ratchet: a key is "dead" only when its literal never appears
anywhere in the app sources (including tests/e2e — the safest conservative
criterion) AND it is not covered by a dynamic prefix such as
t(`auth.error.oidc.${code}`) or t('auth.preset.' + preset).

Historical cleanups: web common.json 391→95 (#2164-round), desktop 1131→165.
New dead keys (re-added legacy copy) fail the gate; deliberate exceptions go
in i18n-deadkeys-baseline.json.
"""

import argparse
import json
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

APP = os.path.join(ROOT, "app")
BUNDLES = [
    os.path.join(APP, "web", "src", "i18n", "locales", "en", "common.json"),
    os.path.join(APP, "desktop", "src", "i18n", "locales", "en.json"),
]
BASELINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "i18n-deadkeys-baseline.json")

SRC_DIRS = [
    os.path.join(APP, "web", "src"),
    os.path.join(APP, "desktop", "src"),
    os.path.join(APP, "workbench", "src"),
    os.path.join(APP, "shared", "src"),
    os.path.join(APP, "mobile-rn", "src"),
]


def collect_blob() -> str:
    parts = []
    for src in SRC_DIRS:
        for root, _dirs, files in os.walk(src):
            for name in files:
                if not (name.endswith(".ts") or name.endswith(".tsx")):
                    continue
                path = os.path.join(root, name)
                if "/locales/" in path or name == "strings.ts":
                    continue
                try:
                    parts.append(open(path, encoding="utf-8", errors="ignore").read())
                except OSError:
                    continue
    return "\n".join(parts)


def collect_dynamic_prefixes(blob: str) -> set:
    prefixes = set()
    for m in re.finditer(r"\bt\(\s*`([^`]*)`", blob):
        seg = m.group(1)
        if "${" in seg:
            prefix = seg.split("${", 1)[0]
            if prefix:
                prefixes.add(prefix)
    for m in re.finditer(r"\bt\(\s*['\"]([^'\"]*)['\"]", blob):
        seg = m.group(1)
        if seg.endswith(".") and len(seg) > 1:
            prefixes.add(seg)
    return prefixes


def dead_keys(bundle: dict, blob: str, prefixes: set) -> list:
    return [
        key for key in bundle
        if key not in blob and not any(key.startswith(p) for p in prefixes)
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="Web/desktop i18n dead-key gate")
    args = parser.parse_args()

    baseline: dict = {}
    if os.path.exists(BASELINE):
        with open(BASELINE, encoding="utf-8") as handle:
            baseline = json.load(handle)

    blob = collect_blob()
    prefixes = collect_dynamic_prefixes(blob)

    new_dead = {}
    for bundle_path in BUNDLES:
        with open(bundle_path, encoding="utf-8") as handle:
            bundle = json.load(handle)
        dead = dead_keys(bundle, blob, prefixes)
        rel = os.path.relpath(bundle_path, ROOT)
        allowed = set(baseline.get(rel, []))
        extra = [k for k in dead if k not in allowed]
        if extra:
            new_dead[rel] = sorted(extra)

    if new_dead:
        print("i18n dead keys detected (fail-closed):")
        for rel, keys in sorted(new_dead.items()):
            for key in keys:
                print(f"  + {rel}: {key}")
        print()
        print(
            "Fix: remove the key from both en/zh bundles, or (for genuinely dynamic "
            "keys) register it in scripts/verify/i18n-deadkeys-baseline.json."
        )
        return 1

    print(f"i18n dead-key gate ok (bundles: {len(BUNDLES)}, dynamic prefixes: {len(prefixes)})")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

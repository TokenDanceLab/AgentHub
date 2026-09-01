#!/usr/bin/env python3
"""verify-migration-idempotency — hub-server migrations must not introduce new
non-idempotent DDL (bare CREATE TABLE / ADD COLUMN / CREATE INDEX without
IF NOT EXISTS).

Ratchet gate (#2125 follow-up): historical violations are baselined in
migration-idempotency-baseline.json; NEW violations fail the gate (exit 1),
stale baseline entries (fixed migrations) print a prune note. Base-migration
tables (0001-0015 CREATE TABLE) remain baselined on purpose: re-running an
already-applied base migration is not supported; only post-baseline
migrations are expected to be idempotent.
"""

import argparse
import glob
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

BASELINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "migration-idempotency-baseline.json")

TABLE_RE = re.compile(r"CREATE\s+(?:UNIQUE\s+)?TABLE\s+(?!IF\s+NOT\s+EXISTS)([A-Za-z0-9_]+)", re.I)
COLUMN_RE = re.compile(r"ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)([A-Za-z0-9_]+)", re.I)
INDEX_RE = re.compile(r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)([A-Za-z0-9_]+)", re.I)


def scan(migrations_dir: str) -> dict:
    found: dict = {}
    for path in sorted(glob.glob(os.path.join(migrations_dir, "*.up.sql"))):
        src = open(path, encoding="utf-8").read()
        items = []
        for m in TABLE_RE.finditer(src):
            items.append(f"table:{m.group(1)}")
        for m in COLUMN_RE.finditer(src):
            items.append(f"column:{m.group(1)}")
        for m in INDEX_RE.finditer(src):
            items.append(f"index:{m.group(1)}")
        if items:
            found[os.path.basename(path)] = sorted(set(items))
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description="Migration DDL idempotency ratchet")
    parser.add_argument("--migrations-dir", default=os.path.join(ROOT, "hub-server", "migrations"))
    args = parser.parse_args()

    baseline: dict = {}
    if os.path.exists(BASELINE):
        with open(BASELINE, encoding="utf-8") as handle:
            baseline = json.load(handle)

    current = scan(args.migrations_dir)

    new_violations: dict = {}
    stale: dict = {}
    for fname, items in current.items():
        allowed = set(baseline.get(fname, []))
        extra = [i for i in items if i not in allowed]
        if extra:
            new_violations[fname] = extra
    for fname, items in baseline.items():
        if fname not in current:
            continue
        removed = [i for i in items if i not in current[fname]]
        if removed:
            stale[fname] = removed

    if new_violations:
        print("migration idempotency drift detected (fail-closed):")
        for fname, items in sorted(new_violations.items()):
            for item in items:
                print(f"  + {fname}: {item}")
        print()
        print(
            "Fix: use IF NOT EXISTS in new migrations (CREATE TABLE/INDEX, ADD COLUMN). "
            "Historical entries are baselined in "
            "scripts/verify/migration-idempotency-baseline.json."
        )
        return 1

    if stale:
        print(f"note: {sum(len(v) for v in stale.values())} baseline entries are now idempotent (prune them from migration-idempotency-baseline.json)")
        for fname, items in sorted(stale.items()):
            for item in items:
                print(f"  ~ {fname}: {item}")

    print(f"migration idempotency ok ({len(current)} files with baselined historical DDL)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

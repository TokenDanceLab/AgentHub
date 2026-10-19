#!/usr/bin/env python3
"""backup-db — AgentHub PostgreSQL 备份。

pg_dump | gzip 备份到 BackupDir，并清理超过 RetentionDays 的旧 *.sql.gz。
BACKUP_DIR/DB_NAME/DB_USER/DB_HOST 环境变量作为参数兜底；
输出 `Backup: <file>` / `Cleaned backups older than N days`。

失败语义：pg_dump 退出码非零时抛 RuntimeError 并以非零状态退出，
不写出空备份文件。
"""

import argparse
import datetime
import gzip
import os
import shutil
import subprocess
import sys
import time


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--BackupDir", "-BackupDir", default=os.environ.get("BACKUP_DIR") or "./backups")
    parser.add_argument("--DbName", "-DbName", default=os.environ.get("DB_NAME") or "agenthub")
    parser.add_argument("--DbUser", "-DbUser", default=os.environ.get("DB_USER") or "agenthub")
    parser.add_argument("--DbHost", "-DbHost", default=os.environ.get("DB_HOST") or "localhost")
    parser.add_argument("--RetentionDays", "-RetentionDays", type=int, default=7)
    args = parser.parse_args()

    backup_dir = args.BackupDir
    os.makedirs(backup_dir, exist_ok=True)
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_file = os.path.join(backup_dir, f"agenthub_{timestamp}.sql.gz")

    pg_dump_exe = shutil.which("pg_dump")
    if not pg_dump_exe:
        raise RuntimeError("pg_dump executable not found")
    gzip_exe = shutil.which("gzip")
    if not gzip_exe:
        raise RuntimeError("gzip executable not found")

    # PGPASSWORD 透传自环境；pg_dump 失败必须非零退出，不写空文件
    pg_dump_run = subprocess.run(
        [pg_dump_exe, "-h", args.DbHost, "-U", args.DbUser, "-d", args.DbName],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if pg_dump_run.returncode != 0:
        raise RuntimeError(f"pg_dump failed with exit code {pg_dump_run.returncode}:\n{pg_dump_run.stderr.strip()}")
    with open(backup_file, "wb") as handle:
        gzip_run = subprocess.run([gzip_exe], input=pg_dump_run.stdout.encode("utf-8", errors="replace"), stdout=handle)
    if gzip_run.returncode != 0:
        raise RuntimeError(f"gzip failed with exit code {gzip_run.returncode}")
    print(f"Backup: {backup_file}")

    # Clean old backups
    cutoff = time.time() - args.RetentionDays * 86400
    for name in os.listdir(backup_dir):
        entry_path = os.path.join(backup_dir, name)
        if not name.endswith(".sql.gz") or not os.path.isfile(entry_path):
            continue
        if os.path.getmtime(entry_path) < cutoff:
            os.remove(entry_path)
    print(f"Cleaned backups older than {args.RetentionDays} days")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底：任何未处理异常以非零状态退出，禁止静默吞错
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

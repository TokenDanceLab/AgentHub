#!/usr/bin/env python3
r"""merge-coverprofiles.py — 合并多个 go test -coverprofile 文本 profile。

用途：CI 的 go test 2-shard matrix（#1689 wave2）中每个 shard 各自跑
`go test -coverpkg=./... -coverprofile=shard-N.out`。-coverpkg=./... 保证
每个 profile 含完整包集（未覆盖区间 count=0），合并只需按位置块求和。

文本格式（go tool cover 输出）：
    mode: set
    github.com/x/y/file.go:12.3,14.5 2 1
    （位置 语句数 计数）

契约（自测 scripts/verify/tests/merge-coverprofiles.Tests.py）：
- 全部输入的 mode 行必须一致，否则 fail（不同 covermode 合并无意义）。
- 位置键去重求和；numStmt 必须一致（-coverpkg 下同源文件同区间不变）。
- 输出行按位置排序，先写 mode 行。

用法:
    python scripts/verify/merge-coverprofiles.py a.out b.out -o merged.out
"""

import argparse
import sys


def parse_profile(path: str) -> tuple[str, dict[str, tuple[int, int]]]:
    mode: str | None = None
    blocks: dict[str, tuple[int, int]] = {}
    with open(path, encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if not line:
                continue
            if line.startswith("mode:"):
                if mode is None:
                    mode = line
                elif mode != line:
                    raise ValueError(
                        f"{path}: conflicting mode {line!r} (expected {mode!r})"
                    )
                continue
            location, num_stmt_raw, count_raw = line.rsplit(" ", 2)
            num_stmt = int(num_stmt_raw)
            count = int(count_raw)
            previous = blocks.get(location)
            if previous is not None:
                if previous[0] != num_stmt:
                    raise ValueError(
                        f"{path}: numStmt mismatch for {location}: "
                        f"{previous[0]} vs {num_stmt}"
                    )
                blocks[location] = (num_stmt, previous[1] + count)
            else:
                blocks[location] = (num_stmt, count)
    if mode is None:
        raise ValueError(f"{path}: missing mode line")
    return mode, blocks


def merge_profiles(paths: list[str], output: str) -> None:
    merged_mode: str | None = None
    merged_blocks: dict[str, tuple[int, int]] = {}
    for path in paths:
        mode, blocks = parse_profile(path)
        if merged_mode is None:
            merged_mode = mode
        elif merged_mode != mode:
            raise ValueError(f"{path}: mode {mode!r} conflicts with {merged_mode!r}")
        for location, (num_stmt, count) in blocks.items():
            previous = merged_blocks.get(location)
            if previous is not None:
                if previous[0] != num_stmt:
                    raise ValueError(
                        f"{path}: numStmt mismatch for {location}: "
                        f"{previous[0]} vs {num_stmt}"
                    )
                merged_blocks[location] = (num_stmt, previous[1] + count)
            else:
                merged_blocks[location] = (num_stmt, count)

    with open(output, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(merged_mode + "\n")
        for location in sorted(merged_blocks):
            num_stmt, count = merged_blocks[location]
            handle.write(f"{location} {num_stmt} {count}\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Merge go test coverprofile text files")
    parser.add_argument("inputs", nargs="+", help="coverprofile .out files to merge")
    parser.add_argument("-o", "--output", required=True, help="merged output path")
    args = parser.parse_args()

    try:
        merge_profiles(args.inputs, args.output)
    except (OSError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(f"merged {len(args.inputs)} profiles -> {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

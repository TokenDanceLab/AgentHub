#!/usr/bin/env python3
r"""merge-coverprofiles.Tests.py — merge-coverprofiles.py 的自测（unittest）。

契约：
- 位置键求和：同一位置块在两份 profile 中的 count 相加。
- numStmt 不一致时 fail（同一源码区间语句数漂移说明 profile 不可比）。
- mode 不一致时 fail（不同 covermode 合并无意义）。
- 输出含 mode 行且按位置排序。
"""

import importlib.util
import os
import sys
import tempfile
import unittest

_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "merge-coverprofiles.py")
_spec = importlib.util.spec_from_file_location("merge_coverprofiles", _SCRIPT)
assert _spec is not None and _spec.loader is not None
_merge_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_merge_module)
merge_profiles = _merge_module.merge_profiles


class MergeCoverProfilesTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def path(self, name: str) -> str:
        return os.path.join(self.tmp.name, name)

    def write(self, name: str, content: str) -> str:
        p = self.path(name)
        with open(p, "w", encoding="utf-8") as f:
            f.write(content)
        return p

    def read(self, name: str) -> str:
        with open(self.path(name), encoding="utf-8") as f:
            return f.read()

    def test_merges_counts_and_sorts(self):
        a = self.write("a.out", "mode: set\ngithub.com/x/p/file.go:10.2,12.4 3 2\n")
        b = self.write("b.out", "mode: set\ngithub.com/x/p/file.go:10.2,12.4 3 3\n")
        out = self.path("merged.out")
        merge_profiles([a, b], out)
        self.assertEqual(
            self.read("merged.out"),
            "mode: set\ngithub.com/x/p/file.go:10.2,12.4 3 5\n",
        )

    def test_sorted_output(self):
        a = self.write("a.out", "mode: set\ngithub.com/x/p/z.go:1.1,1.2 1 1\n")
        b = self.write("b.out", "mode: set\ngithub.com/x/p/a.go:1.1,1.2 1 1\n")
        out = self.path("merged.out")
        merge_profiles([a, b], out)
        self.assertEqual(
            self.read("merged.out"),
            "mode: set\n"
            "github.com/x/p/a.go:1.1,1.2 1 1\n"
            "github.com/x/p/z.go:1.1,1.2 1 1\n",
        )

    def test_numstmt_mismatch_fails(self):
        a = self.write("a.out", "mode: set\ngithub.com/x/p/f.go:1.1,1.2 3 1\n")
        b = self.write("b.out", "mode: set\ngithub.com/x/p/f.go:1.1,1.2 4 1\n")
        with self.assertRaises(ValueError):
            merge_profiles([a, b], self.path("out"))

    def test_mode_mismatch_fails(self):
        a = self.write("a.out", "mode: set\n")
        b = self.write("b.out", "mode: atomic\n")
        with self.assertRaises(ValueError):
            merge_profiles([a, b], self.path("out"))

    def test_missing_mode_fails(self):
        a = self.write("a.out", "github.com/x/p/f.go:1.1,1.2 3 1\n")
        with self.assertRaises(ValueError):
            merge_profiles([a], self.path("out"))


if __name__ == "__main__":
    unittest.main()

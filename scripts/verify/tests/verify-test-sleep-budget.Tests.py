#!/usr/bin/env python3
"""verify-test-sleep-ratchet 值预算门禁的负向自测（#1948，对偶 #1550 计数棘轮）。

每个用例在隔离的最小仓库夹具里运行：把校验器拷进临时目录，写入合成的计数基线、
值预算与一个含 time.Sleep 的测试文件，然后对夹具做单点变异，断言校验器非零退出
并命中预期策略码（[TSB-*]）。核心用例是 #1948 验收要求的变异自测红：
改 sleep 值而不更新预算。正向夹具必须绿（无假红），--update-baseline 必须能把
变异后的夹具恢复为绿（审批通路可用）。

用法：
  python scripts/verify/tests/verify-test-sleep-budget.Tests.py
"""

import datetime
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
VERIFIER_REL = ("scripts", "verify", "verify-test-sleep-ratchet.py")
BUDGET_REL = ("scripts", "verify", "test-sleep-budget.json")
BASELINE_REL = ("scripts", "verify", "test-sleep-baseline.json")

FIXTURE_FILE = "hub-server/internal/fixture/fixture_test.go"
EXTRA_FILE = "hub-server/internal/fixture/extra_test.go"

FIXTURE_GO = """package fixture

import (
    "testing"
    "time"
)

func TestFixtureSleep(t *testing.T) {
    time.Sleep(20 * time.Millisecond)
}
"""


def fixture_budget():
    return {
        "_comment": "self-test fixture budget (#1948); not a real repository gate",
        FIXTURE_FILE: {
            "count": 1,
            "total_ms": 20,
            "max_ms": 20,
            "owner": "self-test",
            "review": "2026-08-01",
            "reason": "synthetic fixture entry for negative self-tests",
            "sleeps": [
                {"ms": 20, "kind": "grace_window"},
            ],
        },
    }


def fixture_baseline():
    return {FIXTURE_FILE: 1}


def load_verifier_module():
    spec = importlib.util.spec_from_file_location(
        "verify_test_sleep_ratchet", os.path.join(REPO_ROOT, *VERIFIER_REL)
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class VerifyTestSleepBudgetTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="agenthub-sleep-budget-")
        self.fixture = self._tmp.name
        self.verifier_path = os.path.join(self.fixture, *VERIFIER_REL)
        self.budget_path = os.path.join(self.fixture, *BUDGET_REL)
        self.baseline_path = os.path.join(self.fixture, *BASELINE_REL)
        self.go_path = os.path.join(self.fixture, *FIXTURE_FILE.split("/"))
        os.makedirs(os.path.dirname(self.verifier_path), exist_ok=True)
        os.makedirs(os.path.dirname(self.go_path), exist_ok=True)
        shutil.copyfile(os.path.join(REPO_ROOT, *VERIFIER_REL), self.verifier_path)
        self.write_json(self.budget_path, fixture_budget())
        self.write_json(self.baseline_path, fixture_baseline())
        self.write_text(self.go_path, FIXTURE_GO)

    def tearDown(self):
        self._tmp.cleanup()

    @staticmethod
    def write_text(path, content):
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)

    @staticmethod
    def write_json(path, obj):
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(obj, handle, ensure_ascii=False, indent=1)
            handle.write("\n")

    @staticmethod
    def read_json(path):
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)

    def run_verifier(self, *extra_args):
        result = subprocess.run(
            [sys.executable, self.verifier_path, *extra_args],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        return result.returncode, (result.stdout or "") + (result.stderr or "")

    def assert_negative_code(self, expected_code, case_name):
        exit_code, output = self.run_verifier()
        self.assertNotEqual(exit_code, 0, "%s unexpectedly passed:\n%s" % (case_name, output))
        self.assertRegex(
            output,
            re.escape("[%s]" % expected_code),
            "%s failed with the wrong policy code; expected %s:\n%s" % (case_name, expected_code, output),
        )

    def test_positive_fixture_passes(self):
        exit_code, output = self.run_verifier()
        self.assertEqual(exit_code, 0, "positive fixture unexpectedly failed:\n%s" % output)

    def test_value_mutation_without_budget_update(self):
        """#1948 验收核心：改 sleep 值（20ms→30ms）而不更新预算，门禁必须红。"""
        self.write_text(self.go_path, FIXTURE_GO.replace("20 * time.Millisecond", "30 * time.Millisecond"))
        self.assert_negative_code("TSB-VALUE", "value mutation without budget update")

    def test_sleep_removal_without_budget_update(self):
        """删掉 sleep 也不更预算（预算值过期）同样必须红。"""
        self.write_text(self.go_path, FIXTURE_GO.replace("    time.Sleep(20 * time.Millisecond)\n", ""))
        self.assert_negative_code("TSB-VALUE", "sleep removal without budget update")

    def test_rotted_budget_path(self):
        """预算条目指向不存在的路径（腐化条目）必须红。"""
        budget = self.read_json(self.budget_path)
        entry = budget.pop(FIXTURE_FILE)
        budget["hub-server/internal/fixture/renamed_away_test.go"] = entry
        self.write_json(self.budget_path, budget)
        self.assert_negative_code("TSB-PATH", "rotted budget path")

    def test_missing_budget_file(self):
        """预算文件被删除时 fail-closed。"""
        os.remove(self.budget_path)
        self.assert_negative_code("TSB-BUDGET-MISSING", "missing budget file")

    def test_new_file_without_budget_entry(self):
        """新增含 sleep 的测试文件而无预算条目必须红。"""
        extra_path = os.path.join(self.fixture, *EXTRA_FILE.split("/"))
        self.write_text(extra_path, FIXTURE_GO.replace("TestFixtureSleep", "TestExtraSleep"))
        baseline = self.read_json(self.baseline_path)
        baseline[EXTRA_FILE] = 1
        self.write_json(self.baseline_path, baseline)
        self.assert_negative_code("TSB-UNBUDGETED", "new file without budget entry")

    def test_unresolvable_sleep_expression(self):
        """运行期变量时长的 sleep 无法预算，必须红（fail-closed）。"""
        self.write_text(self.go_path, FIXTURE_GO.replace("20 * time.Millisecond", "delay"))
        self.assert_negative_code("TSB-UNRESOLVED", "unresolvable sleep expression")

    def test_unknown_sleep_kind(self):
        """kind 不在许可分类集内必须红（防分类漂移）。"""
        budget = self.read_json(self.budget_path)
        budget[FIXTURE_FILE]["sleeps"][0]["kind"] = "ad_hoc"
        self.write_json(self.budget_path, budget)
        self.assert_negative_code("TSB-SCHEMA", "unknown sleep kind")

    def test_missing_owner_field(self):
        """缺审批字段（owner）必须红。"""
        budget = self.read_json(self.budget_path)
        del budget[FIXTURE_FILE]["owner"]
        self.write_json(self.budget_path, budget)
        self.assert_negative_code("TSB-SCHEMA", "missing owner field")

    def test_update_baseline_approves_value_change(self):
        """审批通路：变异后 --update-baseline 恢复绿，且保留 kind/owner、刷新 review。"""
        self.write_text(self.go_path, FIXTURE_GO.replace("20 * time.Millisecond", "30 * time.Millisecond"))
        exit_code, output = self.run_verifier("--update-baseline")
        self.assertEqual(exit_code, 0, "--update-baseline after value mutation failed:\n%s" % output)
        exit_code, output = self.run_verifier()
        self.assertEqual(exit_code, 0, "check after --update-baseline still failing:\n%s" % output)
        entry = self.read_json(self.budget_path)[FIXTURE_FILE]
        self.assertEqual(entry["count"], 1)
        self.assertEqual(entry["total_ms"], 30)
        self.assertEqual(entry["max_ms"], 30)
        self.assertEqual(entry["sleeps"][0]["ms"], 30)
        self.assertEqual(entry["sleeps"][0]["kind"], "grace_window")
        self.assertEqual(entry["owner"], "self-test")
        self.assertEqual(entry["review"], datetime.date.today().isoformat())

    def test_real_budget_round_trip_stable(self):
        """真实预算文件的版式必须与写回序列化一致（未来 --update-baseline 不整文件重排）。"""
        module = load_verifier_module()
        real_path = os.path.join(REPO_ROOT, *BUDGET_REL)
        with open(real_path, encoding="utf-8") as handle:
            original = handle.read()
        budget = module.load_budget(real_path)
        self.assertEqual(
            module.format_budget(budget),
            original,
            "real test-sleep-budget.json is not stable under the writer; run --update-baseline to normalize",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)

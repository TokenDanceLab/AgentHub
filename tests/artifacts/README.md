# L3 真实测试证据目录（devserver.sh test 报告 / 真实 E2E lane 证据）

本目录内容 gitignored（.gitignore 的 `tests/artifacts/*` 规则，README 除外），
只保留本说明文件。

命名契约：

| 文件/目录 | 内容 | 产出方 |
|---|---|---|
| `report-<YYYYMMDD-HHMMSS>.json` | Playwright real config JSON 报告 | `playwright.real.config.ts` |
| `html-<YYYYMMDD-HHMMSS>/` | Playwright HTML 报告 | `playwright.real.config.ts` |
| `manifest-<YYYYMMDD-HHMMSS>.json` | 真实 E2E lane evidence manifest（六字段合同：evidence_level / real_tested / claim / status / skipped_evidence_levels / planned_evidence_levels） | `scripts/e2e/run-real-e2e-lane.sh`（#1839 B3；`scripts/verify/verify-real-e2e-lane-manifest.py` 校验） |
| `real-e2e-account.env` | 测试账号凭据（运行期随机账号，chmod 600；重跑时 lane 复用零注册） | `scripts/e2e/provision-real-e2e-stack.sh` |
| `test-results/` | Playwright trace / 失败截图产物 | playwright 运行 |

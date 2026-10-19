# 真实 E2E 证据目录

本目录内容被 `.gitignore` 忽略（仅保留本说明），用于存放真实 E2E lane 的运行产物。

| 文件/目录 | 内容 | 产出方 |
|---|---|---|
| `report-<YYYYMMDD-HHMMSS>.json` | Playwright JSON 报告 | `playwright.real.config.ts` |
| `html-<YYYYMMDD-HHMMSS>/` | Playwright HTML 报告 | `playwright.real.config.ts` |
| `manifest-<YYYYMMDD-HHMMSS>.json` | evidence manifest（schema / generated_at / commit / scope / evidence_level / real_tested / claim / status / skipped_evidence_levels / planned_evidence_levels） | `scripts/e2e/run-real-e2e-lane.sh` |
| `test-results/` | Playwright trace / 失败截图 | Playwright |
| `real-e2e-account.env` | 运行期随机测试账号，chmod 600；Hub JWT 签名密钥只经环境变量传入，不写入该文件 | `scripts/e2e/provision-real-e2e-stack.sh` |

上传 CI artifact 前先运行 `scripts/verify/verify-real-e2e-artifacts.py` 做 fail-closed
内容扫描（endpoint、账号、callback、token、storage、绝对路径、请求正文）。只上传
sanitized manifest；内容扫描通过时额外上传原始报告（report/html）。trace 常含 OIDC
code、JWT、cookie 和 workspace 路径，`test-results/` 永不公开上传。`real-e2e-account.env`
永不离开 runner，也不进 Git。

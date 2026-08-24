# L3 真实测试证据目录（devserver.sh test 报告 / 真实 E2E lane 证据）

本目录内容 gitignored（.gitignore 的 `tests/artifacts/*` 规则，README 除外），
只保留本说明文件。

命名契约：

| 文件/目录 | 内容 | 产出方 | 进 CI evidence artifact |
|---|---|---|---|
| `report-<YYYYMMDD-HHMMSS>.json` | Playwright real config JSON 报告 | `playwright.real.config.ts` | 仅内容扫描通过 |
| `html-<YYYYMMDD-HHMMSS>/` | Playwright HTML 报告 | `playwright.real.config.ts` | 仅内容扫描通过 |
| `manifest-<YYYYMMDD-HHMMSS>.json` | 真实 E2E lane evidence manifest（六字段合同：evidence_level / real_tested / claim / status / skipped_evidence_levels / planned_evidence_levels；外加 commit / scope provenance） | `scripts/e2e/run-real-e2e-lane.sh`（#1839 B3；`scripts/verify/verify-real-e2e-lane-manifest.py` 校验） | ✅ 始终上传（sanitized） |
| `test-results/` | Playwright trace / 失败截图产物 | playwright 运行 | 仅内容扫描通过 |
| `real-e2e-account.env` | 测试账号凭据（运行期随机账号，chmod 600；重跑时 lane 复用零注册） | `scripts/e2e/provision-real-e2e-stack.sh` | ❌ 永不上传 |

CI evidence artifact 上传契约（`checks.yml` real-e2e-stack；公私分离 #1873）：

- 上传前先跑 `scripts/verify/verify-real-e2e-artifacts.py` 对 raw artifact
  （report JSON / HTML report / trace.zip）做 fail-closed 内容扫描（endpoint /
  账号 / callback / token / storage / 绝对路径 / 请求正文）。
- public artifact 只上传 sanitized manifest（`manifest-*.json`）：保留
  commit / evidence_level / real_tested / scope provenance，不复制私有运行事实。
- raw evidence（`report-*.json` / `html-*/` / `test-results/`）仅在内容扫描通过时
  才上传；真实 E2E trace 必含 OIDC code / JWT / cookie / workspace 路径 → 判
  non-public-safe，路由 private evidence store（不公开）。
- `real-e2e-account.env`（凭据，600 权限）显式排除在上传路径外——凭据永不离开
  runner，既不进 git（gitignored），也不进 artifact。
# 规则 → 机器验证映射（verifier-map）

> Owner：本文件是 AgentHub「规则 → 机器验证」映射的 SSOT；`AGENTS.md` 链接到这里。
> 机器门禁：`scripts/verify/verify-doc-ssot.py` 校验本表验证脚本路径与 CI 文件存在性。

最后更新：2026-10-18

## 映射表

| 规则 | 验证脚本 | CI job |
|---|---|---|
| 提交消息符合 Conventional Commits | `scripts/verify/verify-commit-messages.sh` | checks.yml → validate |
| CI 安全/合同门禁保持接线 | `scripts/verify/verify-ci-invariants.py` | checks.yml → validate |
| 仓库不得提交 secret | `scripts/verify/check-secrets.sh` | checks.yml → validate |
| JS 依赖无未登记漏洞 | `scripts/verify/verify-vulnerability-gates.sh` | checks.yml → vuln-scan-js |
| Go 依赖无未登记漏洞 | `scripts/verify/verify-vulnerability-gates.sh` | checks.yml → vuln-scan-go |
| Rust 依赖无未登记通告 | `scripts/verify/verify-rust-advisories.sh` | checks.yml → vuln-scan-rust |
| Go 安全扫描 fail-closed | `scripts/verify/verify-gosec-gates.sh` | checks.yml → go-*-static |
| 文档入口、内部链接、行数预算 | `scripts/verify/verify-doc-ssot.py` | checks.yml → validate |
| OpenAPI 与 Hub router 一致 | `scripts/verify/verify-openapi-contract.py` | checks.yml → validate |
| Hub service 纯包不得 import gorm/cache/ws/service | `scripts/verify/verify-hub-pure-packages.py` | checks.yml → validate |
| Hub handler 不直连 repository | `scripts/verify/verify-hub-layering.py` | checks.yml → validate |
| 前端包依赖方向与 Edge 导入边界（`pnpm lint:boundaries`） | `app/eslint.boundaries.config.mjs` | checks.yml → frontend lint |
| shared REST 客户端与 Hub router 合同一致 | `scripts/verify/verify-shared-rest-contract.py` | checks.yml → validate |
| Design token 唯一来源 | `scripts/verify/verify-design-token-ssot.py` | checks.yml → validate |
| devserver 脚本不内嵌远端主机/凭据 | `scripts/verify/verify-devserver-contract.py` | checks.yml → validate |
| 真实 E2E 证据等级 | `scripts/verify/verify-real-e2e-contract.py` | checks.yml → validate |
| 出站 HTTP client 收敛 | `scripts/verify/verify-outbound-client-hygiene.py` | checks.yml → validate |
| OIDC 常量后端/前端一致 | `scripts/verify/verify-oidc-code-ssot.py` | checks.yml → validate |
| 部署形状 SSOT | `scripts/verify/verify-deployment-shape.py` | cd-pr-check.yml → deployment-files（Enforce deployment shape SSOT #1527 step） |
| 后端性能/泄漏行为门禁 | `scripts/verify/verify-backend-perf-leak-gates.py` | checks.yml → backend-perf-leak-gates（dispatch） |
| 真实 E2E 产物脱敏/清单 | `scripts/verify/verify-real-e2e-artifacts.py`、`scripts/verify/verify-real-e2e-lane-manifest.py` | checks.yml → real-e2e-stack（dispatch） |

## 边界

- 本表登记每个相关 PR 真执行的门禁，以及在 job 列显式标注的 dispatch/manual 门禁（后者不阻塞 PR）。手工脚本（`verify-oidc-flow.py`、`verify-login-e2e-readiness.py`）和发布前检查不列入常规门禁，证据记录在对应 PR 或 release 说明中。
- `verify-ci-invariants.py` 只断言关键安全/合同门禁仍被接线（必需的 job 与步骤、verifier 调用、gosec/secret guard 保持硬阻断、引用的脚本存在），不复制完整的 CI 结构。
- 覆盖率由测试 job 直接产出，不设基线 ratchet；Edge lint 为 advisory（owner：edge maintainers），已登记的 lint 债务清零后移除 `continue-on-error`，与 `go-hub-static` 一样阻塞合并。Hub lint 经 `go-hub-static` / `go-hub` 阻塞合并。
- 新增门禁必须说明它替代了哪个旧门禁，或证明现有测试/契约检查无法覆盖；没有 CI 执行点的脚本不算门禁。

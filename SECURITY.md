# Security Policy

## 报告安全漏洞

请**不要**在公开 issue 中报告 Critical/High 级安全问题。

- 首选：GitHub Security Advisory（本仓库 Security 标签页 → Report a vulnerability）。
- 若该入口不可用：创建 issue 并**只写 "security report" 占位**（不含任何细节），在 body 中@维护者；我们会在 48 小时内确认收到，并通过私密渠道索要细节。

报告请包含：影响范围、复现步骤（最小化）、可能的修复建议。我们会在 48 小时内确认收到，并定期同步处理进展。

## 支持版本

| 版本 | 支持 |
|---|---|
| 最新 release（`vX.Y.Z`） | 是 |
| 更早版本 | 否（请先升级） |

## 处置流程

- 安全风险分级、状态与发布门禁以 TokenDance 私有治理文档 `security-risk-register`（SSOT，见 TokenDanceLab/docs `governance/agenthub/`）为准；本文件保留发布门禁状态摘要（下表）与处理规则。
- 已修复漏洞会在 release notes（`BREAKING CHANGE` / security 分组）中披露。
- 依赖漏洞由 CI 持续扫描：`govulncheck`（Go）、`pnpm audit --prod`（JS）、`cargo audit`（Rust），均 fail-closed。

## 发布门禁风险状态

发布阻断：任何状态为 `Open` / `rotate required` / `* verification required` 的 Critical/High 风险都阻断公开发布（机器门禁 `scripts/release/verify-release-gate.py` 读取本表；`Open` 行被捕获即 blocker）。下表只列 ID / 严重度 / 状态 / 一句话说明，不含细节；完整队列与关闭条件以私有治理文档为准。

| ID | Severity | Status | 说明 |
|---|---|---|---|
| AH-SR-028 | Critical | Mitigated in repo; rotate required | Hub JWT secret 已去硬编码默认值；部署实例需轮换后验证旧 secret 失效 |
| AH-SR-035 | High | Mitigated in repo; deploy verification required | Hub OIDC callback/JWKS/Hub session 代码已落地；缺浏览器真实授权码流证据 |
| AH-SR-036 | High | Mitigated in repo; deploy/client verification required | Desktop PKCE 登录闭环代码已落地；缺真实 Desktop 登录证据 |
| AH-SR-037 | High | Accepted | Web tab-scoped sessionStorage；补偿控制（HTTPS 生产、短 TTL、CSP）已记录 |
| AH-SR-045 | High | Mitigated in repo | Hub JWT remote reads fail-closed owner 过滤 + 敏感读路由 scoping |
| AH-SR-046 | High | Mitigated in repo | Edge PostRuns dual-token + purpose/action/target/thread 绑定；fixture E2E 已过 |
| AH-SR-048 | High | Mitigated in repo; runtime/log verification required | Edge 启动日志已脱敏；真实 adapter debug 日志待验证 |
| AH-SR-049 | High | Mitigated in repo | durable journal + offline/replay fixture；自动 redelivery 推迟 |
| AH-SR-052 | High | Accepted | Hub access-token jti 黑名单 Redis 故障时 fail-open；补偿：生产显式 `AGENTHUB_AUTH_FAIL_CLOSED=true` |

维护规则：风险状态变化时更新本表（与私有治理文档 `security-risk-register.md` 同步）；任何 `Open` 行必须附带 issue/PR 引用并在 merge 前关闭。

# Security Policy

## 报告安全漏洞

请**不要**在公开 issue 中报告 Critical/High 级安全问题。

- 首选：GitHub Security Advisory（本仓库 Security 标签页 → Report a vulnerability）。
- 若该入口不可用：创建 issue 并**只写 "security report" 占位**（不含任何细节），在 body 中@维护者；我们会在 48 小时内确认收到，并通过私密渠道索要细节。

报告请包含：影响范围、复现步骤（最小化）、可能的修复建议。确认收到后我们会定期同步处理进展。

## 支持版本

| 版本 | 支持 |
|---|---|
| 最新 release（`vX.Y.Z`） | 是 |
| 更早版本 | 否（请先升级） |

## 披露与扫描

- 敏感细节按 responsible disclosure 处理，修复随 release notes 发布。
- 发布前由维护者完成安全风险复核；`RELEASE_RISK_REVIEWED=<release tag>` 必须在受保护的 `release` environment 中设置（必须等于本次发布的 tag，不能只写 `true`），release workflow 在环境审批通过后才继续。
- 依赖与静态安全扫描由 CI 按改动路径触发（`workflow_dispatch` 时全量运行）；门禁规则与证据边界见 [docs/governance/verifier-map.md](docs/governance/verifier-map.md) 与 [docs/architecture/github-actions-ci-cd-policy.md](docs/architecture/github-actions-ci-cd-policy.md)。

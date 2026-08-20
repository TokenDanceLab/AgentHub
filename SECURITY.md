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

- 安全风险分级、状态与发布门禁以 `docs/governance/security-risk-register.md` 为准（Critical/High 且 Open 时阻断发布）。
- 已修复漏洞会在 release notes（`BREAKING CHANGE` / security 分组）中披露。
- 依赖漏洞由 CI 持续扫描：`govulncheck`（Go）、`pnpm audit --prod`（JS）、`cargo audit`（Rust），均 fail-closed。

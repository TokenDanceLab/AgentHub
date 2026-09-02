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
- 已修复漏洞在 release notes 中披露，但**没有独立的 security 分组可用**：release notes 由 git-cliff 按 Conventional Commits 类型分组（`cliff.toml`），而提交类型白名单是 `feat|fix|docs|refactor|chore|test|perf|ci|revert`（`scripts/verify/verify-commit-messages.sh`，不含 `security`），所以安全修复实际落在 `fix`/`feat` 等分组里；只有 `!:` 或正文含 `BREAKING CHANGE` 的提交会进破坏性变更分组。
- 依赖漏洞由 `.github/workflows/checks.yml` 的三个 `vuln-scan-*` job 扫描，判定统一交给 `scripts/verify/verify-vulnerability-gates.sh`（fail-closed：扫描工具故障、输出不可解析、存在漏洞都判红；唯一豁免通道是 `scripts/verify/vulnerability-exceptions.json`）：
  - **Go**（`vuln-scan-go`）：`govulncheck`，按 `hub-server` / `edge-server` 矩阵各跑一次。
  - **JS**（`vuln-scan-js`）：`pnpm audit --prod` **和** 全量 `pnpm audit` 两条都跑，互不替代——`--prod` 只覆盖随产物发布的依赖，dev/lint/build 链的通告对它完全不可见（该盲区曾让两枚 brace-expansion high 在门禁全绿下钉在 lockfile 里，#2154 F-d）。
  - **Rust**（`vuln-scan-rust`）：门禁是 `scripts/verify/verify-rust-advisories.sh`（内部调用 cargo-audit），**不是裸 `cargo audit`**——裸 `cargo audit` 会把 unsound 类通告当非失败警告放行，该脚本把这类也纳入判定，allowlist 每条带硬性复审到期日，过期即红。同 job 的 `cargo clippy` 是 `continue-on-error` advisory，不阻断。
- 上述三个 job 都经 `changes` job 的路径过滤触发（分别对应 go / frontend / desktop 改动面），`workflow_dispatch` 时无条件跑；因此不是「每次 push 全量扫描」。
- Go 静态安全扫描另由 `gosec` 承担（`go-edge` / `go-hub` job，输出经 `scripts/verify/verify-gosec-gates.sh` fail-closed 判定），与依赖漏洞扫描是两件事。

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

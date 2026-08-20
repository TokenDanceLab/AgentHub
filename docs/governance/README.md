# AgentHub Governance（公开区）

最后更新：2026-08-20

本目录是 AgentHub 公开仓库中的**治理区**，只保留工程门禁清单与指针。
内部运营/安全材料自 2026-08-20 起迁移至 TokenDance 私有文档中枢
（`TokenDanceLab/docs` 私有仓库 → `governance/agenthub/`），公开仓库不再维护正文。

## 本目录内容

| 文件 | 内容 | 可见性 |
|---|---|---|
| `verifier-map.md` | 规则 → 机器验证映射（SSOT，被 `scripts/verify/verify-doc-ssot.py` 机器校验） | public（工程门禁清单） |
| `README.md` | 本指针与迁移说明 | public |

## 已迁移至私有文档中枢（不在本仓）

| 原文件 | 私有区位置 | 内容 |
|---|---|---|
| `governance-execution.md` | TokenDanceLab/docs `governance/agenthub/governance-execution.md` | TokenDance 系统治理 → AgentHub 执行项（TD-P0 队列、登录拓扑门禁、发布审批切片） |
| `security-risk-register.md` | TokenDanceLab/docs `governance/agenthub/security-risk-register.md` | AgentHub 安全风险队列（AH-SR-*）、SAST 门禁、发布阻断、依赖监控 |
| `threat-model.md` | TokenDanceLab/docs `governance/agenthub/threat-model.md` | 活跃威胁模型摘要：资产、信任边界、威胁与控制 |

> 迁移理由：AgentHub 为 public 仓库；治理执行、安全风险登记与威胁模型属内部运营/审计材料，
> 应留在私有文档中枢。公开仓库保留 `SECURITY.md` 摘要、`verifier-map.md` 与本文档指针。

## Login fixture topology gate

P0 remote-control fixture 只验证拓扑合同和离线证据形状：`Web -> Hub -> Desktop/Edge -> Local Edge -> CLI/SDK adapter`。

- Web 侧只用 Hub-issued session 和 Hub execution-target inventory fixture，不直连 Local Edge。
- Desktop receives Hub dispatch -> Local Edge starts CLI adapter 是真实远控链路的后续验收，不属于登录 fixture slice。
- future real TokenDanceID/OIDC login remains approval-gated；未获审批时，脚本不得打开真实浏览器登录、访问 TokenDance ID、启动真实 CLI/model 或部署。

## Package and real-readiness gates

- D2b. Release dry build topology 是 topology/preflight only（拓扑/预检）验证；它检查版本、workflow、sidecar 名称、ignore 策略和 artifact 合同，不运行发布流程。
- full Tauri build / `pnpm tauri build` 是单独 opt-in 范围；Windows unsigned NSIS/portable 是未来显式启用的 artifact scope；dry artifacts 只允许作为 workflow artifact 上传，不发布到 release channel。
- Windows sidecar 名称固定为 `agenthub-edge-x86_64-pc-windows-msvc.exe`；updater metadata 必须成对记录 `latest.json` 和 `.sig`。
- macOS arm64 unsigned 边界只记录 `agenthub-edge-aarch64-apple-darwin`、`AgentHub.app` 和 `AgentHub_${version}_aarch64.dmg` 的未来包形状；`notarytool` notarization、codesign、stapling 是 later approval slice。
- Packaged Desktop OIDC readiness 是 proposal-only gate；Packaged real login dry readiness 只读仓库，不访问 Hub/TokenDance ID、不打开浏览器、不读取 secrets。
- Edge CLI real-readiness 是 proposal-only unless explicitly approved；真实运行、operator 审批、预算/脱敏策略、artifact root 与证据模式须先记录。
- GitHub Release / release asset upload / updater 生产 metadata publication 都是 later approval slice（后续审批范围）。

## 维护规则

- 新的机器门禁进 `verifier-map.md`，不写回 `AGENTS.md` 长表（§9.5 只保留指针）。
- 安全风险、威胁模型、治理执行的维护在本仓 `SECURITY.md`（摘要）与私有 docs 中枢（正文）双处同步；本仓不写真实 endpoint、token、secret 或 session 证据。
- 私有 docs 中枢的维护规则见 TokenDanceLab/docs `governance/agenthub/README.md`。

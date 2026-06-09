# Competitive Positioning

> Updated: 2026-06-10
> 本页是 AgentHub 在字节跳动 2026 AI 全栈挑战赛「AgentHub — 多 Agent 协作平台」赛道中的竞争力定位。
> 完整逐仓深审报告见 [`../../../docs/competitors/COMPETITOR-DEEP-COMPARISON-2026-06-10.md`](../../../docs/competitors/COMPETITOR-DEEP-COMPARISON-2026-06-10.md)（仓库外 docs）。

## 一句话定位

> AgentHub 是赛道内**唯一三端原生（Desktop / Web / Mobile）、唯一 Go 后端分布式（Hub-Edge）、工程量最大**的实现。代码量是同赛道竞品均值的约 8 倍，测试量约 6 倍。

## 工程规模对比

| 项目 | AgentHub | 竞品均值（6 仓） | 倍数 |
|---|---:|---:|---:|
| 源码 LOC（Go + Rust + TS） | ~464,000 | ~60,000 | ~8× |
| 其中 Go 后端 | ~90,000 | 0 | — |
| 其中 Rust / Tauri 桌面 | ~277,000 | ~1,000（多为存根） | — |
| 测试代码 | ~62,000 | ~10,000 | ~6× |
| 测试文件数 | 323 | ~40 | ~8× |
| Commits | 1,815+ | ~300 | ~6× |
| DB migrations | 82 | ~20 | ~4× |
| API 契约（OpenAPI） | 5,636 行 | 无独立规范 | — |

## 架构维度对比

| 维度 | AgentHub | 竞品主流做法 |
|---|---|---|
| 后端语言 | **Go**（Hub + Edge） | TypeScript / Python 单体 |
| 拓扑 | **Hub-Edge 分布式**（本地执行 + 云同步 + 多设备路由） | 单进程 / 单机 Sidecar / 本地优先单体 |
| 客户端 | **Desktop (Tauri) + Web + Mobile (Android 原生)** | Web only / PWA / 存根 Tauri |
| Runtime 数 | 3（Claude Code / Codex / OpenCode），完整协议适配 | 2-4，多为浅 CLI 调用 |
| 身份 | **OIDC 多用户**（TokenDance ID PKCE + 双重 JWT） | single-owner / 无 |
| 数据库 | PostgreSQL + Redis | SQLite |

## 我们独有的能力（竞品都没有）

- **真三端原生**：Tauri 桌面端 72 个 Rust 文件（系统托盘、通知、OIDC server、edge_manager、secure_store、updater）+ Android 原生 Mobile。竞品桌面端是 PWA 或存根。
- **Hub-Edge 分布式执行**：Edge 可本地 / 远程 / 云端运行，Hub 做多端同步和设备路由。竞品是单机。
- **完整 CLI 协议适配**：Claude Code 的 stream-json + control protocol 双向通信 + permission hooks + sub-agent dispatch；Codex NDJSON 完整事件 + mcp_tool_call。竞品多用 `--tools=none` 把 CLI 当纯文本生成器。
- **三级审批流 + SecurityHook 23-check**：YOLO / Auto / Manual 模式，高风险操作实时审批/拦截。
- **44 条安全风险台账**：每条带代码行号 + 测试命令 + 生产部署证据。竞品多为 8 条理论建议。
- **OpenAPI 5636 行契约**：前后端契约化，竞品无独立 API 规范。

## 竞品的强项（我们承认并参考）

| 竞品强项 | 我们的状态 | 应对 |
|---|---|---|
| IM 持久化闭环（刷新不丢数据） | v4 shared workbench 重构中 | 在 roadmap，架构上由 Hub 层承载 |
| 协作过程可视化（StepCard 类） | TranscriptBlock 合同已定义 12 类 | v4 工作台渲染迁移中 |
| 演示视频 / 截图 | 仅 1 张截图 | **见 demo 计划，需录屏** |
| PRD 演进 / ADR 叙事 | 11 篇 ADR + 本定位页 | 本页 + design-decisions 补齐 |
| 对话式创建 Agent（Instruct Agent） | 表单创建 | roadmap |
| MCP 已实现 | ADR-010 已定义，runtime 适配中 | roadmap |

## 评分维度对应（比赛官方）

| 维度 | 权重 | 我们的证据 |
|---|---:|---|
| AI 协作能力 | 30% | 11 ADR + Spec/Skill/Rules 沉淀 + 真实 CLI 协议适配 + AgentTeam 结构化委派（ADR-006） |
| 功能完整度 | 25% | Hub-Edge 分布式 + 三 Runtime 统一调度 + 三端 + TeamRun |
| 生成效果质量 | 20% | Glass 拟态设计系统 + Diff 审批 + Artifact 预览 |
| 代码理解度 | 15% | 52 handler / 44 service / 32 model / 28 adapter + OpenAPI 契约 |
| 创新与产品感 | 10% | Hub-Edge 数据主权 + 云协作 + 三端原生 |

## 被追问的回应预案

- **"为什么不用 SDK 直调 CLI（像某些竞品）"**：Go + CLI 解析带来跨平台（Edge 跑在 Android）、进程隔离、不依赖 Node 生态；且能完整吃透 stream-json / control protocol（SDK 封装会丢 thinking、permission hooks、sub-agent 能力）。
- **"为什么自研 WS 不用 Matrix"**：Hub-Edge 需要实时云端同步 + 本地离线执行，Matrix 联邦式协议不适合；类型化 WS 事件有 OpenAPI 文档，既适合本地环回也适合跨网络。
- **"为什么 IM 还没竞品完整"**：v4 正在做从双端分叉到 shared UI 的 clean rebuild，是架构升级。竞品前端好但加 Desktop/Mobile 要重写，我们 shared workbench 一次实现三端共享。

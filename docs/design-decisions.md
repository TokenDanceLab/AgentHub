# Key Design Decisions

> Updated: 2026-06-10
> 本页聚合 AgentHub 的关键技术决策，供评审快速理解「为什么这样选」。
> 每个决策的完整背景见 [adr/](adr/)。

## 1. 为什么 Go + CLI 解析，而不是 SDK 直调？

**决策**：Edge Server 用 Go 通过完整协议解析（stream-json / NDJSON）驱动 Claude Code / Codex / OpenCode，而非用各官方 SDK（`@anthropic-ai/claude-agent-sdk` / `@openai/codex-sdk`）。

**理由**：
- **跨平台**：Edge 节点要跑在 Desktop、Remote、Cloud，甚至 Android——Go 静态二进制 + CLI 子进程在所有平台一致，SDK 方案强绑 Node 生态。
- **进程隔离**：每个 Run 是独立子进程，崩溃不影响 Edge；SDK in-process 调用把 agent 生命周期绑进主进程。
- **完整协议吃透**：CLI 原生 stream-json + control protocol 暴露了 SDK 封装会丢失的能力——thinking 可视化、permission hooks、sub-agent dispatch、tool timeline。我们得到了 30+ 种结构化事件。
- **不依赖 Node**：Hub + Edge 全 Go，部署是单二进制，无 Node 运行时依赖。

**代价**：解析层要自己维护协议解析（已覆盖测试）。换来的是跨平台、进程隔离、协议完整性。

**相关**：[ADR-002 WebSocket/NDJSON](adr/ADR-002-websocket-ndjson.md)、[ADR-004 Go Process Orchestration](adr/ADR-004-go-process-orchestration.md)、[ADR-007 Unified Adapter Architecture](adr/ADR-007-unified-adapter-architecture.md)。

---

## 2. 为什么 Hub-Edge 分布式，而不是单体？

**决策**：拆分 Hub Server（云端协作）与 Edge Server（本地执行），而非把所有逻辑放进一个进程。

**理由**：
- **数据主权**：敏感代码与执行留在本地 Edge，只把协作元数据同步到 Hub。企业/团队场景的硬需求。
- **多端路由**：Desktop 本地执行 + 手机审批 + Web 查看，天然要求执行节点（Edge）与协作入口（Hub）分离。
- **多用户**：Hub 承载 OIDC 多用户身份、设备路由、审计；Edge 专注单节点执行效率。
- **扩展性**：Edge 可本地 / 远程 / 云端，Hub 做调度——这是单体做不到的。

**代价**：多了一层 Hub-Edge 投递契约（见 security-risk-register AH-SR-049 的 outbox 设计）。换来的是真正的分布式协作能力。

**相关**：[ADR-001 Hub-Edge Architecture](adr/ADR-001-hub-edge-architecture.md)、[ADR-006 Agent Communication Model](adr/ADR-006-agent-communication-model.md)。

---

## 3. 为什么自研类型化 WebSocket 事件，而不是用 Matrix？

**决策**：Hub-Edge 与客户端通信用自研的类型化 WebSocket 事件（有 OpenAPI 文档），而非 Matrix 房间协议。

**理由**：
- **场景匹配**：Hub-Edge 需要实时云端同步 + 本地离线执行 + 设备路由。Matrix 是联邦式 IM 协议，模型不匹配（我们的「房间」是 run/project/device，不是聊天室联邦）。
- **契约可控**：类型化事件有 OpenAPI 5636 行文档，前后端契约清晰；Matrix 的事件 schema 由 homeserver 决定，我们无法为 Agent 协作定制。
- **依赖最小**：无需部署 Matrix homeserver（Tuwunel/Synapse），Hub + Edge 自包含。

**代价**：放弃 Matrix 的联邦与现成客户端生态。换来的是为多 Agent 协作定制的、有文档的、自包含的协议。

**相关**：[ADR-002 WebSocket/NDJSON](adr/ADR-002-websocket-ndjson.md)。

---

## 4. 为什么 Tauri，而不是 Electron 或纯 Web？

**决策**：桌面端用 Tauri 2（Rust 内核 + WebView），移动端用 Tauri Android 原生，而非 Electron 或浏览器 PWA。

**理由**：
- **体积与性能**：Tauri 用系统 WebView，比 Electron（捆绑 Chromium）轻约 10×，启动快、内存低。
- **真原生能力**：72 个 Rust 文件实现系统托盘、原生通知、OIDC loopback server、Edge 进程管理、OS secure store、自动更新——这些 PWA 做不到，Electron 要重写。
- **Rust 安全**：secure_store / oidc.rs 用 Rust 写，内存安全，凭据落 OS keychain。
- **跨端复用**：同一套 shared UI（@shared/ui + OKLCH tokens + Glass 设计系统）跑在 Desktop / Web / Mobile。

**代价**：Rust 学习曲线 + Tauri 生态比 Electron 小。换来的是轻量、原生、安全的真桌面 + 移动应用。

**相关**：[ADR-008 Glass Token Design System](adr/ADR-008-glass-token-design-system.md)、[ADR-011 Frontend Monorepo](adr/ADR-011-frontend-monorepo.md)。

---

## 5. 为什么三级审批（YOLO/Auto/Manual）+ SecurityHook？

**决策**：Agent 执行高风险操作前，经 SecurityHook 23-check 管线 + 三级审批模式（YOLO 全自动 / Auto 自动批准白名单 / Manual 逐项人工）。

**理由**：
- **团队场景必需**：多 Agent 改生产代码、删文件、执行 shell——必须有 human-in-the-loop 审批，否则不可用于团队。
- **粒度可控**：三级模式适配不同信任度（个人 YOLO / 受信 Auto / 生产 Manual）。
- **拦截而非事后**：permission_requested 一次性注册表在操作前拦截，不是事后审计。

**代价**：审批流增加交互复杂度。换来的是可用于真实团队协作的安全边界。

**相关**：[ADR-006 Agent Communication Model](adr/ADR-006-agent-communication-model.md)、[威胁模型](governance/threat-model.md)。

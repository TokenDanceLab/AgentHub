# AgentHub 路线图

> 最后更新: 2026-06-05 | 唯一事实源 | 旧版归档: [archive/roadmap-full-history-20260605.md](archive/roadmap-full-history-20260605.md)

## 课题目标

构建 IM 形态的多 Agent 协作平台。用户像用飞书/微信一样与 AI Agent 交互：
- 单聊/群聊对话，@Agent 分派任务
- Orchestrator 自动协调多 Agent 协作
- Agent 回复内联 Diff、预览、附件等富媒体
- 统一适配器接入 Claude Code / Codex / OpenCode
- Desktop (Tauri) 为主力端

**考察维度**: AI 协作能力 30% | 功能完整度 25% | 生成效果 20% | 代码理解 15% | 创新与产品感 10%

**交付物**: 产品设计文档 + 技术文档 + 可运行 Demo + AI 协作开发记录 + 3 分钟 Demo 视频

---

## 当前 Sprint: IM 工作流 + Agent 可视化

> 目标: 打通 IM 核心闭环，Desktop 前端可用，Agent 操作在 ChatView 中可视化

### S1: IM 对话核心工作流

- [ ] **对话列表** — 新建/置顶/归档/搜索，按最近活跃排序
- [ ] **加好友** — 搜索用户 → 发送请求 → 接受/拒绝 → 成为联系人
- [ ] **单聊模式** — 选中联系人/Agent → 1v1 对话，发送消息收到回复
- [ ] **群聊模式** — 创建群组 → 邀请多 Agent → @Agent 分派任务
- [ ] **消息类型** — 文本、代码块、图片、文件附件、Diff 视图卡片、网页预览卡片
- [ ] **消息操作** — 回复、引用、复制代码、展开预览
- [ ] **上下文管理** — 聊天历史自动传递，支持 pin 关键消息

### S2: ChatView Agent 操作可视化

- [ ] **Agent 运行状态** — 思考中/工具调用中/生成中等实时状态指示
- [ ] **工具调用可视化** — ToolUseBlock 展示工具名、参数、结果
- [ ] **代码 Diff 内联** — Agent 产出代码时展示 Diff 视图卡片，支持一键应用
- [ ] **文件操作可视化** — Agent 读写文件的实时展示
- [ ] **多 Agent 并行流** — 群聊中多个 Agent 依次/并行回复的可视化
- [ ] **审批面板** — 高风险操作弹窗确认，Agent 等待审批后继续

### S3: Orchestrator 协调器

- [ ] **意图理解 + 任务拆解** — 群聊模式自动理解用户意图，拆解并分派子任务
- [ ] **子 Agent 调度** — 并行调度，失败降级
- [ ] **产出聚合** — 子 Agent 完成后在聊天流中汇报结果
- [ ] **冲突处理** — 多 Agent 修改同一文件时的冲突检测

### S4: Desktop 前端优化

- [ ] **对话列表 UI 打磨** — 未读计数、最后消息预览、在线状态
- [ ] **消息气泡优化** — 头像、时间戳、发送状态、Agent 标识
- [ ] **输入体验** — @Agent 弹窗选择、文件拖拽、快捷键
- [ ] **侧边栏** — 会话/联系人/Agent 商店导航
- [ ] **响应式适配** — 窄屏/宽屏自适应布局

---

## 已完成

| 批次 | 内容 | 完成日期 |
|------|------|:-------:|
| P0-P3 | Edge 24 消息类型 + Markdown + 线程管理 + Bundle 优化 | 2026-05 |
| M3b | AgentHook + 消息树 + 安全管道 + Context Budget | 2026-05 |
| M4 | Hub 骨架 + OpenCode/Codex E2E + 权限门控 | 2026-05 |
| M5 | 工程基础收敛: Edge race/metrics, Hub DI, Desktop 虚拟滚动 | 2026-05-24 |
| M6 | 生产部署: Docker + nginx + Cloudflare + 安全加固 | 2026-05-24 |
| M7 | Desktop P0: TanStack Query + RunState + 心跳 + viewRegistry | 2026-05-24 |
| M8 | 安全审计: 129 Issues 修复，纯后端清零 | 2026-05-27 |
| W22 | Desktop UI 大打磨: 40+ 验收项，Mobile/Web 对齐 | 2026-05-30 |
| 文档体系 | ADR 11 篇 + 竞品调研 25 项目 + 架构三合一 | 2026-06-02 |

> 详细历史见 [archive/roadmap-full-history-20260605.md](archive/roadmap-full-history-20260605.md)

---

## 已知缺口 (来自 B6/B8)

| # | 问题 | 优先级 |
|---|------|:------:|
| B6 (9项) | Desktop IM 对接真实 Hub session/message/WS 事件 | High |
| @Agent | Desktop IM @mention 完全缺失，核心差异化 | High |
| AgentTeam | Hub 模型已有，缺 E2E live smoke | Medium |
| Orchestrator | 文本扫描 JSON dispatch 脆弱，内存队列崩溃丢数据 | Medium |
| OIDC | 后端已通，前端部署态 login/logout 证据待补 | Low |

---

## P2 远期

- [ ] 部署发布 — 聊天中"部署"指令，返回部署状态卡片
- [ ] Agent 商店 — 搜索、安装、使用自定义 Agent
- [ ] 版本历史 — Checkpoint + Diff 对比 + 回滚
- [ ] Mobile 轻量端 — 查看/审批/预览
- [ ] FTS5 全文搜索

---

## 技术栈速查

| 层 | 技术 | 测试 |
|----|------|------|
| Desktop | React 19 + Tauri 2 + Zustand + TanStack Query | `pnpm test && pnpm typecheck` |
| Edge Server | Go + gorilla/websocket + NDJSON | `go test ./... -short -race` |
| Hub Server | Go + Gin + GORM + Redis + PG | `go test ./... -short -race` |
| 协议 | REST JSON + WebSocket NDJSON | — |
| CI | GitHub Actions 8 job | `scripts/verify-ci-gates.ps1` |

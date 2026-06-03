# AgentHub 质量收敛 Roadmap

> 基于 2026-06-03 四路并行审计（设置页、Chat/IM 页、设计系统、后端+文档）
> 分支：`dev/delicious233` | 最后更新：2026-06-03 (18:30 HKT)
> 关联：`docs/handoff/STATE.md`、`docs/roadmaps/client.md`、`docs/roadmaps/integration.md`

---

## 进度总览（2026-06-03 最新）

经过 18 个 worktree + 3 个 SettingsPage 收敛提交后，34 项中 **17 项已关闭**、**4 项部分完成**、**13 项仍 Open**。

| 项 | 状态 | 说明 |
|----|:--:|------|
| **S1-01** 设置页双代码库 | ✅ 已关闭 | 4213→**765 行**（目标 ≤1500），29 section 提取 + 死代码清理 + feature flags + Ctrl+K 搜索 |
| **S1-02** Online IM 设置区 | ✅ 已关闭 | OnlineImSection 已 import 到 SettingsPage |
| **S1-03** Web mock 数据清理 | ✅ 已关闭 | WT-A 完成 |
| **S1-04** ChatView stub handler | ✅ 已关闭 | WT-B 完成 |
| **S1-05** OIDC 浏览器冒烟测试 | ❌ Open | 完整 browser login/callback/logout 未执行 |
| **S1-06** Git 卫生 | ✅ 已关闭 | WT-E 完成 |
| **S2-01** IM 内联样式 | ✅ 已关闭 | WT-B2 (72→0) |
| **S2-02** rgba() 治理 | ✅ 已关闭 | WT-D (797→0 in TSX) |
| **S2-03** Web Light Theme | ✅ 已关闭 | WT-D2 (6 preset + light/dark) |
| **S2-04** SettingsPage CSS 拆分 | ✅ 已关闭 | WT-C2 (2033→375)，后因 Ctrl+K 增至 524 |
| **S2-05** Shared 组件集成 | ⚠️ 部分 | EmptyState 已共享 (WT-N)，其余待评估 |
| **S2-06** i18n 清理 | ⚠️ 部分 | WT-K 处理了 IM 组件；Settings/ChatView 残留 |
| **S2-07** Web/Shared 测试 | ❌ Open | WT-A2 未执行（用户指示不急于前端测试） |
| **S3-01** 键盘快捷键 | ✅ 已关闭 | WT-C 提取 KeyboardSection |
| **S3-02** 权限管理 | ✅ 已关闭 | WT-C 提取 PermissionsSection + AllowlistEditor |
| **S3-03** 工作区配置 | ✅ 已关闭 | WT-C 提取 WorktreeSection |
| **S3-04** Group Chat | ❌ Open | GroupChatSection 可能仍显示 Planned |
| **S3-05** Data Section | ✅ 已关闭 | WT-C 提取 + WT-O 颜色清理 |
| **S3-06** MCP 配置 | ⚠️ 部分 | Edge MCP 端点已有 (WT-H)；UI CRUD 待验证 |
| **S3-07** Hooks 配置 | ❌ Open | 仍为 "Not configured" |
| **S3-08** Git 配置 | ❌ Open | 仍为硬编码文本 |
| **S4-01** CHANGELOG | ✅ 已关闭 | WT-E 完成 |
| **S4-02** 本地开发指南 | ✅ 已关闭 | WT-E 完成 |
| **S4-03** Hub→Edge 推送 | ❌ Open | 反向 WebSocket 未实现 |
| **S4-04** Mobile OIDC | ❌ Open | Rust stub 状态 |
| **S4-05** 安全漏洞 | ❌ Open | npm audit + Dependabot 4 moderate 未处理 |
| **S4-06** AgentTeam 集成 | ❌ Open | 20 路由已有，E2E 测试未写 |
| **S5-01** stylelint | ✅ 已关闭 | WT-U 完成 (禁止新 hex/rgba) |
| **S5-02** Makefile fe targets | ✅ 已关闭 | WT-U 完成 (fe-lint/fe-test/fe-build/fe-typecheck) |
| **S5-03** i18n 命名空间 | ❌ Open | 仍为 flat JSON |
| **S5-04** 视觉回归测试 | ❌ Open | Playwright 截图未实现 |
| **S5-05** Settings 测试 | ❌ Open | Primitives 无单元测试 |
| **S5-06** Runner→Runtime | ❌ Open | 命名未迁移 |
| **S5-07** 文档归档 | ❌ Open | archive/ 无 staleness index |

---

## 审计摘要

| 维度 | 状态 | 关键发现 |
|------|:--:|------|
| 设置页 | ✅ 已收敛 | SettingsPage.tsx 765 行（目标 ≤1500），32 section 已提取，死代码已清理，Ctrl+K 搜索已加入 |
| Chat/IM 展示 | 已改善 | ChatView stub handler 已修复 (WT-B)；IM 子组件 CSS 模块化 (WT-B2) |
| Web 页面 | 已改善 | 4 个 Web 页面 mock 数据已清除，接入 Hub API (WT-A) |
| 设计系统 | 已收敛 | 26 个 glass token 定义，TSX rgba() 797→0 (WT-D)，6 个主题 preset + light/dark (WT-D2) |
| 测试覆盖 | 两极分化 | Desktop 56 文件 / Web 1 文件 / Shared 0 文件 |
| 后端 | 高度完整 | Hub 145+ 操作已实现，OIDC 全链路已通，middleware 86.3% 覆盖率，缺浏览器冒烟 |
| 文档 | 基本齐全 | CHANGELOG 更新至 v0.3.0，local-dev-setup.md 已编写，Edge/Hub README 已完善 |

---

## Sprint 1 — 阻塞级问题（P0，1-2 天）

### S1-01 设置页双代码库危机

**问题**：`SettingsPage.tsx` 4200+ 行内联渲染几乎所有 section，同时 `sections/` 目录下有 31 个已提取的 section 文件，其中 29 个从未被 import（只有 `AppearanceSection` 和 `ConnectionsSection` 被使用）。15 个 card 文件也全部是死代码。

**行动**：
- [ ] 对比 inline 版本和 extracted 版本，保留功能更完整的一方
- [ ] 逐 section 替换 inline JSX 为 import（优先 OnlineImSection、KeyboardSection、WorktreeSection 这三个功能差距最大的）
- [ ] 删除或归档被替换的 inline 代码
- [ ] 确保 SelectControl primitive 补齐 `disabled` prop

**验收**：SettingsPage.tsx 降到 1500 行以内；至少 8 个 section 从 extracted 文件加载。

### S1-02 Online IM 设置区从 stub 变为可用

**问题**：运行中的应用内 Online IM 区只显示 3 个 CapabilityCard（Planned/Planned/Ready），无任何真实数据。但 `OnlineImSection.tsx` 已有完整的 session 列表、好友请求、通知功能，只是从未被 import。

**行动**：
- [ ] import OnlineImSection 替换 inline stub
- [ ] 验证 session 列表、好友请求 accept/reject、通知 mark-read 功能正常

**验收**：设置页 Online IM 区显示真实 Hub 数据。

### S1-03 Web 页面 mock 数据清理

**问题**：`GroupWorkspace.tsx`（Alice/Bob/Charlie 假数据）、`PrivateChats.tsx`（`昨天` 硬编码中文 + 英文 mock）、`Project.tsx`（假 milestone 和 task）三个页面 100% 假数据。用户看到的全是假信息。

**行动**：
- [ ] PrivateChats：接入 Hub `/client/sessions` API，删除 mock 数据，修复 `'昨天'` i18n 问题
- [ ] GroupWorkspace：接入 Hub agent-team API 或标记为"Coming Soon"空状态
- [ ] Project：接入 Hub projects + runs API 或标记为"Coming Soon"空状态
- [ ] AgentSquare：修复 Hub custom-agents fetch 被丢弃的 bug（响应取了但没展示）

**验收**：所有 Web 页面要么显示真实数据，要么明确展示空状态。

### S1-04 ChatView 关键 stub handler 修复

**问题**：
- `onApplyDiff` 是 `() => {}` 空函数——artifact 预览的"应用 Diff"按钮点击无效
- ApprovalCard 渲染用 `agentName="Agent"` `toolName=""` `riskLevel="low"` `timestamp=""`——审批上下文完全丢失
- TeamApprovalPanel 的 reason input 被采集但从未传给 approve/deny handler——用户输入被静默丢弃

**行动**：
- [ ] 给 onApplyDiff 接上真实的 diff apply mutation
- [ ] ApprovalBlock 类型扩展：增加 agentName/toolName/riskLevel/timestamp 字段，后端 event 携带这些上下文
- [ ] TeamApprovalPanel 将 reason input 值传给 onApprove/onDeny
- [ ] TeamApprovalPanel 增加 approve/deny 确认对话框（当前单击即触发不可逆决策）

**验收**：Chat 中 artifact apply、审批卡片、审批理由三个功能闭环。

### S1-05 OIDC 浏览器冒烟测试

**问题**：后端 OIDC 链路（PKCE、state、JWT、user mapping、device registration）代码完整，但 STATE.md 明确标注"full browser login/callback/logout/reconnect smoke is still pending"。

**行动**：
- [ ] 在 dev 环境跑通完整 Desktop → TokenDance ID → Hub 浏览器登录流
- [ ] 验证 logout + reconnect 流程
- [ ] 记录并修复发现的问题

**验收**：`verify-oidc-flow.ps1` 32/32 + 浏览器端真实登录成功截图。

### S1-06 Git 卫生

**问题**：`hub-server/server-hub-linux` 编译产物在工作树中。

**行动**：
- [ ] 在 `.gitignore` 中添加 `server-hub-linux`、`server-hub-*` 模式
- [ ] 清理 `edge-server/cov*.out`、`hub-server/cov*.out` 覆盖文件

---

## Sprint 2 — 设计系统和前端质量（P1，3-5 天）

### S2-01 IM 子组件内联样式 → CSS Modules

**问题**：`TeamApprovalPanel`、`TeamEventTimeline`、`TeamMemberList`、`TeamTaskBoard` 四个组件 100% 内联样式，40+ 个硬编码 hex 颜色（`#f59e0b`、`#10b981`、`#ef4444` 等），无法主题化，与 CSS Modules 体系脱节。

**行动**：
- [ ] 为每个组件创建 `.module.css`
- [ ] 将硬编码颜色映射到 `--td-*` token（`--td-plum`、`--td-moss`、`--td-danger` 等）
- [ ] 使用 settings primitives 的 Panel/SettingRow 模式统一布局

**验收**：四个组件零硬编码颜色，主题切换后自动跟随。

### S2-02 797 个硬编码 rgba() 治理

**问题**：32 个 `.module.css` 文件共 797 个 `rgba()` 值绕过设计 token。Top 3：App.module.css(106)、SettingsPage.module.css(95)、ChatView.module.css(91)。

**行动**：
- [ ] 定义 glass token 层：`--glass-bg-subtle`、`--glass-bg-medium`、`--glass-border`、`--glass-tint-plum` 等
- [ ] 在 tokens.css 中添加 glass token 定义
- [ ] 批量替换 rgba() 为 glass token（从 SettingsPage.module.css 开始，最大收益）
- [ ] 添加 stylelint 规则禁止新 rgba() 值

**验收**：SettingsPage.module.css 中 rgba() 降到 20 以内。

### S2-03 Web 端 Light Theme 和 Token 补全

**问题**：Web `tokens.css` 只有暗色主题，缺少 4/7 字号、1/3 字重、z-index 刻度、动画 token。

**行动**：
- [ ] 从 Desktop tokens.css 同步缺失 token
- [ ] 添加 Light Theme 支持（参考 Desktop themes.css 的 `[data-theme='light']` 模式）
- [ ] 抽取全局 CSS reset 到 shared 包（消除 Desktop/Web 重复）

### S2-04 SettingsPage.module.css 拆分

**问题**：1370 行单体 CSS 文件，Panel/ModeCard/CapabilityCard/SummaryCard 等 primitive 样式散布其中。

**行动**：
- [ ] 拆分为 `primitives.module.css`（Panel、ModeCard、SummaryCard、CapabilityCard、SettingRow、SelectControl、Switch）
- [ ] 拆分为 `sections-*.module.css`（按 section 组）
- [ ] SettingsPage.module.css 只保留页面级布局样式

### S2-05 Shared 组件集成

**问题**：`ChatBubble`、`ChatInput`、`ConversationList` 三个 shared 组件从未被 Desktop 或 Web 实际使用。每个 view 自己实现了一套。

**行动**：
- [ ] 评估：是让 shared 组件替代现有实现，还是归档 shared 组件承认各端独立
- [ ] 如果保留 shared：将 IMMessageView 的渲染逻辑迁移到 ChatBubble；将 IMMessageInput 迁移到 ChatInput
- [ ] 如果归档：将 shared/components 移到 archive，避免误导新贡献者

### S2-06 i18n 硬编码字符串清理

**问题**：多个组件硬编码英文/中文：
- IMMessageInput: `'Type a message...'`、`'Send message'`
- IMMessageView: `'Just now'`、`'m ago'`、`'No messages yet'`、`formatTime` 强制 `en-US`
- ChatView: `"... ${totalLines - 15} more lines"`
- SettingsPage: `'Online'`/`'Offline'`、`D:\Code\TokenDance`（用户路径）
- IMView: `'Interface gap'` 开发占位符暴露给用户

**行动**：
- [ ] 统一使用 `t()` 包裹所有用户可见字符串
- [ ] IMMessageView `formatTime` 使用 app locale 而非 `en-US`/`undefined`
- [ ] 替换 `'Interface gap'` 为用户友好的描述（如 "此功能需要 Hub 登录"）
- [ ] SettingsPage 中用户路径改为动态检测或 placeholder
- [ ] 添加 i18n key parity CI check（en.json vs zh.json 双向校验）

### S2-07 Web 和 Shared 测试覆盖

**问题**：Desktop 56 个测试文件 vs Web 1 个 vs Shared 0 个。

**行动**：
- [ ] Web：为 SettingsPage、IMView、ChatView 添加基础渲染测试
- [ ] Web：为 AgentSquare、PrivateChats 添加 API mock 测试
- [ ] Shared：为 designTokens.ts、ChatBubble、ChatInput 添加单元测试
- [ ] 目标：Web 10+ 文件，Shared 5+ 文件

---

## Sprint 3 — 功能完善（P1-P2，5-7 天）

### S3-01 键盘快捷键自定义

**问题**：inline 版本只读展示，extracted `KeyboardSection.tsx` 有完整的编辑/捕获/冲突检测/持久化功能但从未 import。

**行动**：import extracted 版本替换 inline stub。

### S3-02 权限管理完善

**问题**：Permission Ledger 显示 "Planned"；AllowlistEditor 已实现但不可达。

**行动**：import PermissionsSection 替换 inline stub，使 AllowlistEditor 可用。

### S3-03 工作区配置完善

**问题**：Worktree 区显示硬编码 `D:\Code\TokenDance`；extracted WorktreeSection 有真实的工作区选择 UI。

**行动**：import extracted 版本。

### S3-04 Group Chat 功能补全

**问题**：房间列表和审核 UI 显示 "Planned"；extracted GroupChatSection 有真实功能。

**行动**：import extracted 版本。

### S3-05 Data Section 接入

**问题**：完整的 localStorage 导出/导入/重置功能存在于 DataSection.tsx 但从未被引入导航。

**行动**：在 SettingsPage 导航中添加"数据管理"入口。

### S3-06 MCP 配置功能

**问题**：MCP 模板（Filesystem、GitHub、Hub、Remote Server）只是展示卡，无配置控件。

**行动**：
- [ ] 为本地 MCP 模板添加配置表单（路径、环境变量）
- [ ] 接入 Hub `/web/mcp-servers` CRUD API

### S3-07 Hooks 配置 UI

**问题**：pre-run/post-run hooks 显示 "Not configured"，无编辑界面。

**行动**：
- [ ] 添加 hook 脚本编辑器（textarea + 语法高亮）
- [ ] 添加 hook 执行日志查看

### S3-08 Git 配置功能

**问题**：Branch Policy 和 Commit Style 是硬编码展示文本。

**行动**：
- [ ] 添加 branch policy 选择器
- [ ] 添加 commit style 选择器（conventional/simple）

---

## Sprint 4 — 后端和基础设施（P1-P2，持续）

### S4-01 CHANGELOG 更新

**问题**：CHANGELOG.md 冻结在 v0.1.0（2026-05-27），之后 6+ 天的快速开发无任何记录。

**行动**：
- [ ] 补充 05-28 到 06-03 的变更日志
- [ ] 建立每版本更新 CHANGELOG 的规范

### S4-02 Edge/Hub 本地开发指南

**问题**：新贡献者没有 step-by-step 的 Edge + Hub 联调指南。

**行动**：
- [ ] 编写 `docs/guides/local-dev-setup.md`
- [ ] 覆盖 docker-compose 启动、环境变量配置、OIDC 测试流程

### S4-03 Hub → Edge 推送机制

**问题**：Hub 无法直接推送事件到 Edge，完全依赖 Desktop 中继。Cloud Edge 和 Remote Edge 需要反向 WebSocket 或轮询。

**行动**：
- [ ] 设计反向 WebSocket 连接（Edge → Hub 长连接）
- [ ] 实现 Edge 自注册到 Hub

### S4-04 Mobile OIDC Deep-link

**问题**：Mobile 端 OIDC 是 Rust stub。

**行动**：
- [ ] 设计 mobile deep-link 流程文档
- [ ] 实现 Tauri deep-link handler

### S4-05 安全漏洞修复

**问题**：STATE.md 标注 3 个 Dependabot moderate 漏洞未处理。

**行动**：
- [ ] 运行 `npm audit`，修复或 acknowledge 所有 moderate+ 漏洞

### S4-06 AgentTeam 集成闭环

**问题**：20 个 agent-team 路由已实现，但端到端集成成熟度未验证。

**行动**：
- [ ] 编写 AgentTeam E2E 场景测试
- [ ] 验证：创建团队 → 分配 Agent → 启动 Run → 审批 → 完成 全链路

---

## Sprint 5 — 工程化打磨（P2，持续）

### S5-01 添加 stylelint

- [ ] 配置 stylelint 禁止新 rgba()/hex 硬编码
- [ ] 强制 CSS Module 规范

### S5-02 Makefile 前端 target

- [ ] 添加 `make fe-lint`、`make fe-test`、`make fe-build`
- [ ] `make test` 同时跑前后端

### S5-03 Desktop i18n 命名空间重构

- [ ] 从单个 1000+ key flat JSON 迁移到命名空间结构（与 Web 对齐）
- [ ] 添加 CI check 校验 en/zh key parity

### S5-04 视觉回归测试

- [ ] Playwright 截图测试：theme 切换、preset 切换、dark/light 模式
- [ ] 覆盖 SettingsPage 主要 section 的视觉快照

### S5-05 Settings Primitives 独立测试

- [ ] Panel、ModeCard、SummaryCard、CapabilityCard 各添加单元测试

### S5-06 Runner → Runtime 命名迁移

- [ ] 按 `api/deprecations.md` 计划推进代码中的命名迁移

### S5-07 文档归档整理

- [ ] `docs/archive/` 添加 staleness index（什么被什么替代了）
- [ ] 合并重复的 `security-risk-register.md`

---

## 进度跟踪

| Sprint | 状态 | 项数 | 完成 | 关闭 | 部分 | Open |
|--------|------|:--:|:--:|:--:|:--:|:--:|
| S1 — 阻塞级 | 大部分完成 | 6 | 5 | 5 | 0 | 1 |
| S2 — 设计系统 | 大部分完成 | 7 | 4 | 4 | 2 | 1 |
| S3 — 功能完善 | 部分完成 | 8 | 1 | 4 | 1 | 3 |
| S4 — 后端基础 | 部分完成 | 6 | 1 | 1 | 0 | 5 |
| S5 — 工程化 | 部分完成 | 7 | 2 | 2 | 0 | 5 |
| **总计** | | **34** | **13** | **17** | **4** | **13** |

---

## 决策记录

| 日期 | 决策 | 原因 |
|------|------|------|
| 2026-06-03 | 设置页重构策略：逐 section 替换，而非一次性重写 | 降低风险，每步可验证 |
| 2026-06-03 | Web mock 页面策略：能接 API 的接 API，不能接的展示空状态 | 竞赛 demo 不能展示假数据 |
| 2026-06-03 | Shared 组件暂不强制统一 | 先解决 P0，S2-05 再评估 |

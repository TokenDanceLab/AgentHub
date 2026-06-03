# 产品化成熟度竞品差距分析

> 分析时间：2026-06-03
> 分析范围：AgentHub 全产品 vs 10 个竞品（Cursor、Windsurf、Claude Code、Codex、Devin、GitHub Copilot、OpenHands、Aider、Cline、Continue.dev）
> 数据来源：reference/ 竞品源码深度调研（25 个项目 + 16 篇交叉对比） + Web 调研

---

## 产品化对比矩阵

| 维度 | AgentHub | Cursor | Windsurf | Claude Code | Codex | Devin | GitHub Copilot | OpenHands | Aider | Cline | Continue.dev |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 零配置上手 | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ |
| 设置 UI 完整度 | ⚠️ | ✅ | ✅ | N/A CLI | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | ⚠️ |
| i18n 多语言 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 用户文档/帮助 | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | ✅ |
| 错误处理 UX | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | ✅ | ⚠️ |
| SSO/团队管理 | ⚠️ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ⚠️ | ❌ | ❌ | ⚠️ |
| 用量分析面板 | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ⚠️ | ❌ |
| 性能/资源占用 | ⚠️ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | ⚠️ | ✅ |
| MCP 生态 | ⚠️ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ⚠️ | ❌ | ✅ | ❌ |
| 快捷键系统 | ⚠️ | ✅ | ✅ | ✅ | ✅ | N/A | ✅ | ❌ | ⚠️ | ✅ | ❌ |
| Onboarding 引导 | ❌ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✓ | ❌ | ❌ | ❌ | ❌ |
| 插件/扩展市场 | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | ⚠️ | ❌ | ✅ | ✅ |

> ✅ = 成熟　⚠️ = 部分实现/有缺陷　❌ = 缺失

---

## 产品化成熟度评分（1-5 分）

| 维度 | AgentHub | Cursor | Windsurf | Claude Code | Codex | 业界最佳 | 差距 | 比赛权重 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---:|
| 首次上手体验 | 2/5 | 5/5 | 4/5 | 4/5 | 4/5 | Cursor 5/5 | -3 | 产品感 10% |
| 设置系统完整度 | 2.5/5 | 5/5 | 4/5 | N/A | 4/5 | Cursor 5/5 | -2.5 | 功能完整 25% |
| i18n 覆盖率 | 5/5 | 1/5 | 1/5 | 1/5 | 1/5 | AgentHub 5/5 | +4 | 功能完整 25% |
| 错误处理 UX | 2/5 | 4/5 | 4/5 | 4/5 | 4/5 | Devin/Cursor 4/5 | -2 | 功能完整 25% |
| 账号/团队 | 2/5 | 4/5 | 4/5 | 1/5 | 4/5 | GitHub Copilot 5/5 | -3 | 功能完整 25% |
| 文档/帮助 | 1.5/5 | 4/5 | 4/5 | 4/5 | 4/5 | Aider 4/5 | -2.5 | 产品感 10% |
| 性能/Tauri | 3/5 | 3/5 | 3/5 | 3/5 | 4/5 | Codex 4/5 | -1 | 生成效果 20% |
| 生态集成 | 2/5 | 4/5 | 4/5 | 5/5 | 4/5 | Claude Code 5/5 | -3 | 创新 10% |

> 加权差距：`(-3×10) + (-2.5×25) + (+4×25) + (-2×25) + (-3×25) + (-2.5×10) + (-1×20) + (-3×10) / 100 = -55/100`
>
> **加权差距 -0.55 分**，i18n 是唯一显著优势维度（+4）。

---

## 逐维度详细分析

### 1. 新用户上手体验（2/5，差距 -3）

**AgentHub 当前状态：**
- README 是开发者文档，无截图/GIF/产品演示，end user 看完不知道产品长什么样
- 下载链接指向不存在的 GitHub Releases（v0.1.0 预发布）
- 从零 clone 到运行需 ~15 步（Go + Node + pnpm + PostgreSQL + Redis + Docker），仅面向开发者
- README_EN.md 比中文版更弱——英文用户连预构建下载的提及都没有
- WelcomeScreen.tsx（268 行）已实现，但无引导流程、无 feature tour、无"首次使用做什么"提示

**竞品参考：**
- **Cursor**：一键导入 VS Code 配置（扩展、快捷键、主题、Git），5-7 分钟完成迁移。自动索引项目（2000 文件 ~30s）
- **Windsurf**：Wave 28 优化了注册 onboarding flow，Automatic Planning Mode 降低学习曲线
- **Claude Code**：npm 安装即用，CLAUDE.md 自定义是第一件事
- **Aider**：`pip install aider-chat` 一条命令，但有 ~20-30 分钟配置学习曲线
- **AionUI**（参考项目）：README 上有 10+ 产品 GIF 演示、功能对比表、多语言导航、Download CTA——AgentHub 的文档标杆

**改进建议：**
1. README 重写为产品落地页：加 3-5 张截图/GIF、功能对比表、Download CTA、社区入口
2. 实现 one-click installer 或至少提供真实下载链接
3. 添加首次启动引导：WelcomeScreen → "创建你的第一个 Project" → "启动 Agent" 三步引导
4. 提供 `docs/quick-start.md` 给非开发者的 end user（不是 local-dev-setup.md）

---

### 2. 设置系统完整度（2.5/5，差距 -2.5）

**AgentHub 当前状态：**
- SettingsPage.tsx：4213 行巨石组件，含 30 个 section，其中 28 个以内联方式渲染
- `sections/` 目录：32 个独立 section 组件，但仅 2 个（AppearanceSection、ConnectionsSection）被 SettingsPage 实际导入——**29 个 standalone section 是死代码**
- 4 个功能硬编码为 `available = false`：skillSync、remoteControl、platformSync、auditTrail
- 大量 inline 组件与 standalone components 重复定义（如 TaskRunRow、AgentMarketCard 等各有两个版本）
- 设置无搜索功能
- AgentMarketSection 含 6 个 hardcoded MOCK_COMMUNITY_AGENTS（182 行假数据）
- SkillsSection 含 7 个 hardcoded PROJECT_SKILLS
- DataSection（362 行，完整的 export/import/clear 功能）不在主导航中

**竞品参考：**
- **Cursor**：settings.json + UI 双重配置，Privacy Mode、Max Mode、credit 使用面板
- **Cline**：React webview 设置面板，按 tab 分 api-config/features/browser/terminal/general，Plan/Act 模式分离
- **OpenCode（架构标杆）**：4-axis provider 分离（Protocol/Endpoint/Auth/Framing），`opencode.toml` 配置，8 个 builtin agents
- **AionUI**：设置按域组织（LLM/Agent/Secrets/MCP/Skills/Git/Billing），Command Palette（Ctrl+K）

**改进建议：**
1. **立即**：将死代码 standalone sections 连线到 SettingsPage（WT-C settings extraction 已有计划）
2. **P0**：将 inline section 组件迁移到 `sections/` 目录，SettingsPage 改为路由分发器
3. **P0**：移除或标注 mock 数据（MOCK_COMMUNITY_AGENTS、PROJECT_SKILLS），或改为从配置加载
4. **P1**：添加设置搜索（Ctrl+K command palette）
5. **P1**：移除 `available = false` 硬编码，改为 feature flag 配置
6. **P1**：DataSection 加入主导航

---

### 3. 多语言/国际化（5/5，优势 +4）⭐

**AgentHub 当前状态：**
- 桌面端：en/zh 各 ~1,686 keys，**完美对称**
- Web 端：en/zh 各 681 keys（7 个 namespace 文件），**完美对称**
- 语言切换通过 AppearanceSection 实现
- 所有设置 label、提示文本、WelcomeScreen 均已本地化

**竞品对照：**
- 所有 10 个竞品**均无双语言支持**（或仅勉强支持）
- Cursor、Windsurf、Claude Code、Codex、Devin：仅英文
- Aider：仅英文
- OpenHands：社区贡献部分翻译，不完整
- **AgentHub 在此维度是行业唯一**——这对中国市场是巨大优势，可在答辩中重点展示

**改进建议：**
1. 确保 UI 中所有新增文本都走 i18n key（特别关注 chat 消息中的系统提示）
2. Web 端的 7 个 namespace 补充到与桌面端同等的完整度
3. 考虑添加日语（字节比赛国际化展示）
4. 确保 Web 端 i18n namespace 文件与桌面端的 `common.json` 风格一致

---

### 4. 错误处理与用户反馈（2/5，差距 -2）

**AgentHub 当前状态：**
- ConnectionsSection 有 WebSocket 连接状态显示（30s 自动刷新）和 Edge 健康状态
- 但未观察到全局错误边界、网络断开 toast、API 错误友好文案、操作失败的 recovery 路径
- 无用户反馈入口（"Report a Bug"、"Send Feedback"）
- AgentMarketSection 的 auth gate 显示了 sign-in prompt（好的实践）

**竞品参考：**
- **Claude Code**：23 个安全检查，11 步权限流水线，错误类型分类明确
- **Cline**：Approval cards with structured tool preview，per-tool rendering components，status-based message display（generating/complete/error/cancelled）
- **AionUI**：Tool loop detection（3 次相同调用→警告，5 次→auto-interrupt）
- **Cursor/Windsurf**：Agent 无限循环烧 credit 是用户最大痛点——这也说明 error recovery 是差异化机会

**改进建议：**
1. 添加全局 ErrorBoundary + toast 通知系统
2. WebSocket 断开时显示醒目重连提示（含手动重试按钮）
3. API 错误映射为用户友好文案（不是 "ECONNREFUSED" 而是 "无法连接到 Hub 服务器，请检查网络"）
4. 添加 "Report Feedback" 入口（可对接飞书或 GitHub Issues）
5. 添加 agent tool loop detection（参考 AionUI 的 3→5 次模式）

---

### 5. 账号与团队协作（2/5，差距 -3）

**AgentHub 当前状态：**
- TokenDance ID 统一登录架构完整（OIDC + PKCE）
- 但 Relying Party 矩阵中所有产品均未达到 "Release-ready"——Desktop/Web 客户端缺少完整的登出/重连证明
- AgentTeam / TeamRun 概念在架构和 roadmap 中定义清晰，但 UI 未实现
- AccountSection（69 行）支持 sign in/out、设备注册状态、错误展示
- GroupChatSection、OnlineImSection 有 Hub rooms 和会话摘要，但 IM 协作核心流未打通
- 飞书集成：文档完善但**零实现**——app 状态 "pending launch"，10 个可派发 issue 未分配

**竞品参考：**
- **GitHub Copilot**：企业级 SSO/SAML/SCIM/EMU，Audit log 180 天保留，`actor:Copilot` 过滤，Policy 层级 Enterprise > Org，Cloud agent firewall
- **Cursor Enterprise**：SAML 2.0/OIDC + SCIM 2.0，pooled usage，AI code tracking API，repository blocklist
- **Windsurf Enterprise**：SOC 2 Type II + FedRAMP High/HIPAA，Zero Data Retention，hybrid deployment，custom RBAC
- **Devin Enterprise**：SOC 2 Type II，VPC 部署，Built-in Secrets Manager，Guardrails V3
- **Claude Code**：**无团队功能**——AgentHub 可在此差异化

**改进建议：**
1. **P0**：完成 Desktop/Web OIDC 登出流程和 reconnect smoke test
2. **P1**：实现 AgentTeam 创建和 Team 管理 UI（backend 已有 slice，缺前端）
3. **P1**：GroupChatSection 从摘要卡片升级为可用的 IM 聊天界面
4. **P2**：飞书 Bot 集成 MVP（已有详细 issue，按 roadmap M0→M1 逐步推进）
5. **答辩策略**：Team 协作是 AgentHub 的核心差异化——没有其他工具让 "Claude Code 和 Codex 在同一对话中协作"

---

### 6. 文档与帮助系统（1.5/5，差距 -2.5）

**AgentHub 当前状态：**
- **内部工程文档出色**：架构文档（Runtime/Profile/Configuration/Target 模型）、产品需求（13 项 P0 checklist）、实现指南、roadmap——在同类项目中属最详尽之列
- **但面向用户文档为零**：
  - ❌ 无用户手册
  - ❌ 无 FAQ
  - ❌ 无快捷键参考（仅 archived design spec）
  - ❌ 无 troubleshooting guide（local-dev-setup.md 的 6 条 FAQ 是给开发者的）
  - ❌ 无 changelog（冻结在 v0.1.0）
  - ❌ 无 privacy policy / 安全白皮书（有内部 security-risk-register.md 但非用户文档）
  - ❌ 无系统需求说明
  - ❌ 无截图画廊/产品导览
  - ❌ 无功能对比页（"AgentHub vs Cursor vs Claude Code"）

**竞品参考：**
- **Aider**：aider.chat 完整文档站，leaderboards、model 对比、安装指南、HISTORY.md 追踪每个版本
- **OpenHands**：DeepWiki 文档，每个模块有文档（47+ 子模块），V0/V1 版本标记
- **AionUI**：GitHub README 即产品落地页（banner + 10+ GIF + 对比表 + 多语言），landing page 网站
- **Claude Code**：docs.anthropic.com 含 CLAUDE.md/hooks/MCP/plugins/skills/agents 全覆盖

**改进建议：**
1. **P0**：README 改为产品落地页（截图、对比表、下载入口）
2. **P0**：写 `docs/user-guide.md`（每个面板做什么、怎么创建 project/thread、怎么启动 agent）
3. **P0**：激活快捷键参考文档（从 archive 恢复并更新为实现状态）
4. **P1**：写 `docs/faq.md`（从架构文档中提取常见概念澄清）
5. **P1**：恢复 CHANGELOG.md（从 roadmap sprint closeout 提取）
6. **P1**：创建 `docs/comparison.md`（"AgentHub vs 竞品" 产品定位页）

---

### 7. 性能与资源占用（3/5，差距 -1）

**AgentHub 当前状态：**
- Tauri 2（Rust）桌面端——理论上比 Electron 轻量 ~3-5x
- React 19 + Zustand 状态管理——现代且高效
- WebSocket 连接稳定性：ConnectionsSection 自动刷新（30s），Edge 健康检查已实现
- 无性能基准数据（启动时间、内存占用、大仓库表现）

**竞品参考：**
- **AionUI**（Electron）：react 18 + UnoCSS，uncontrolled input 优化渲染，per-thread localStorage draft
- **OpCode**（Tauri 2）：Zustand v5 + subscribeWithSelector，checkpoint 使用 SHA-256 + zstd 压缩
- **Codex**：95.6% Rust，v0.132.0 快速迭代，Unix socket transport
- **Claude Code**：200K token 后指令遵循开始退化（"200K ghost"问题），~370K 声称无法读取——token 效率问题

**改进建议：**
1. 建立性能基准（启动时间、内存占用、WebSocket 延迟）并持续跟踪
2. 大仓库场景测试（10K+ 文件）
3. Tauri 2 相对 Electron 的优势应在答辩中突出

---

### 8. 生态集成（2/5，差距 -3）

**AgentHub 当前状态：**
- MCP：McpSection（57 行）展示 runtime matrix 和 MCP 模板（Filesystem、GitHub、TokenDanceHub、RemoteServer），但主要是占位符
- 飞书：文档完整但零实现
- TokenDance Gateway：集成规划中但未实施
- Skills：SkillsSection 含 7 个 hardcoded project skills，skill sync 硬编码为 `false`
- Hooks：HooksSection 显示 "not configured"——无实际 hook 配置 UI
- Remote Control、Platforms：控件全部禁用

**竞品参考：**
- **Claude Code**：28 个 hook events + 4 种 hook 类型（Command/Prompt/Agent/HTTP），101 个官方 plugins，9000+ 社区 MCP entries，MCP Tunnels（内网穿透），Managed Agents sandboxes，Skills 被 Codex 和 Gemini CLI 采纳为标准
- **Cline**：MCP Marketplace（100+ 内置 MCP servers），built-in 浏览/安装/配置，`.mcp.json` 跨工具共享
- **OpenHands**：150+ tool plugins + skill loading system（V1），public/user/org/repo/sandbox 多层 skill 来源
- **AionUI**：Agent auto-discovery（PATH scan），Team MCP Server，Cron 自动化引擎，4 种 product forms（Desktop/Web/IM Bot/CLI）
- **Continue.dev**：Config-as-code，model provider hot-switching，10+ context providers（@file/@folder/@codebase/@terminal/@git/@docs/@url/@jira）

**改进建议：**
1. **P0**：MCP 支持从占位符升级为可用（至少 Filesystem 和 GitHub MCP servers 可配置运行）
2. **P1**：Skills 从 hardcoded mock 改为可加载配置
3. **P1**：实现基础 hooks（pre-run lint、post-run commit）
4. **P2**：飞书 Bot 集成 M0（消息收发）
5. **答辩策略**：AgentHub 的独特生态优势是 TokenDance Gateway + Hub-Edge 分布式架构——不是单机 Agent，而是 Agent Network

---

## 产品化亮点（差异化优势）

| 亮点 | 竞品覆盖情况 | 比赛价值 |
|------|------------|---------|
| **IM-native 多 Agent 协作** | 无人做到——Cursor/Windsurf/Claude Code 是单人 Agent，Teamily 是 SaaS 非开发者工具 | 创新 10% |
| **三种 Runtime 统一抽象**（Claude Code + Codex + OpenCode） | OpCode 仅 Claude Code，AionUI 仅自己 Runtime，其他竞品锁定单一模型 | 创新 10% + AI 协作 30% |
| **Hub-Edge 分布式架构** | 所有竞品是单机或纯云端——AgentHub 的本地执行+云端治理是唯一 | 创新 10% |
| **Execution Target 模型**（Local/Remote/Cloud/Hub Relay） | 无同类抽象——OpenHands 有 sandbox 层级但没有 Target 抽象 | 代码理解 15% |
| **完整中英文 i18n** | 全部 10 个竞品无双语言——AgentHub 唯一 | 功能完整 25% |
| **TokenDance 生态**（统一身份 + Gateway + 飞书集成路线） | 生态壁垒——Cursor 绑定 VS Code，AgentHub 绑定 TokenDance 全家桶 | 创新 10% |
| **Append-only typed events**（RunEvent/TeamEvent 可回放可审计） | Kanna 有 EventStore，但 AgentHub 的 Team 级别事件恢复是独有的 | 代码理解 15% |

---

## 🏆 高影响力改进（直接影响比赛评分）

### 1. 设置系统去石化和死代码清理
- **当前状态**：SettingsPage.tsx 4213 行巨石 + 29 个未使用的 standalone section 文件（死代码），6 个 mock agent，7 个 mock skill
- **竞品参考**：Cline 的 tabbed settings webview，OpenCode 的 toml 配置
- **改进方案**：
  - 将 SettingsPage inline 渲染改为导入 standalone sections
  - 移除硬编码 `available = false` 改为 feature flag
  - 标注或移除 mock 数据
- **涉及文件**：`SettingsPage.tsx`、`sections/*.tsx`
- **预估工作量**：3-5 天
- **可并入 worktree**：WT-C（settings-extraction）

### 2. README 产品化 + 用户文档从零到一
- **当前状态**：README 是开发者文档，无截图/GIF/产品介绍，end user 无法理解产品
- **竞品参考**：AionUI 的 GitHub README（banner + 10+ GIF + 对比表 + Download CTA）
- **改进方案**：
  - README 加 3-5 张截图/GIF、功能对比表、Download CTA
  - 写 `docs/user-guide.md`
  - 激活 `docs/faq.md`
  - 激活快捷键参考（从 archive 恢复）
- **涉及文件**：`README.md`、`README_EN.md`、新建 `docs/user-guide.md`、`docs/faq.md`
- **预估工作量**：2-3 天
- **可并入 worktree**：新建 WT-F（docs-productization）

### 3. Onboarding 引导流程
- **当前状态**：WelcomeScreen.tsx 存在但无引导，用户首次打开看到空 Agent 列表不知干什么
- **竞品参考**：Cursor VS Code settings 一键迁移（5-7 分钟），AionUI feature tour 和 agent auto-discovery
- **改进方案**：
  - "创建第一个 Project" → "选择 Runtime" → "启动 Agent" 三步引导
  - 检测 Edge 是否运行并提示启动
  - 首次打开显示 quick start checklist
- **涉及文件**：`WelcomeScreen.tsx`、`WelcomeScreen.module.css`、新建 `OnboardingGuide.tsx`
- **预估工作量**：2-3 天
- **可并入 worktree**：新建 WT-G（onboarding）

### 4. 错误处理和用户反馈系统
- **当前状态**：无全局错误边界，API 错误 raw 展示，无 feedback 入口
- **竞品参考**：Cline 的 structured tool preview + status-based display，AionUI 的 tool loop detection
- **改进方案**：
  - 全局 ErrorBoundary + toast 通知
  - WebSocket 断开醒目重连提示
  - API error → 用户友好文案映射
  - "Report Feedback" 入口
  - Agent tool loop detection
- **涉及文件**：`ErrorBoundary.tsx`（新建）、`App.tsx`、`ConnectionSection.tsx`
- **预估工作量**：2-3 天
- **可并入 worktree**：新建 WT-H（error-ux）

### 5. MCP 支持从占位符到可用
- **当前状态**：McpSection 展示 UI 骨架和模板名但没有功能
- **竞品参考**：Cline 的 MCP Marketplace（100+ 内置），Claude Code 的 MCP Tunnels
- **改进方案**：
  - 至少实现 Filesystem MCP 和 GitHub MCP 的配置和运行
  - McpSection UI 从只读模板改为 MCP server 增删改查
- **涉及文件**：`McpSection.tsx`、新增 MCP 管理 API（如有 backend 需要）
- **预估工作量**：3-5 天
- **可并入 worktree**：新建 WT-I（mcp-real）

---

## 🔧 产品化基础（不做会扣分）

| # | 项目 | 当前 | 改进 |
|---|------|------|------|
| 1 | CHANGELOG.md | 冻结在 v0.1.0 | 从 roadmap sprint closeout 提取历史，更新到最新 |
| 2 | 系统需求说明 | 无文档 | 写 `docs/system-requirements.md`（OS、RAM、磁盘） |
| 3 | local-dev-setup Go 版本不一致 | README 说 1.25+，local-dev-setup 说 1.22+ | 统一为 1.22+ |
| 4 | DataSection | 已实现但不在导航中 | 加入 SettingsPage 导航 |
| 5 | AgentMarketSection mock 数据 | 6 个 fake agent | 标注为 "示例" 或添加 "即将上线" 标签 |
| 6 | SkillsSection mock 数据 | 7 个 hardcoded skill | 改为从配置文件加载 |
| 7 | desktop i18n key 冲突 | `teamRun.noTeams` vs `teamrun.noTeams` | 修复 case sensitivity |
| 8 | Web 端页面可用性 | 3/5 页面 100% mock 数据 | WT-A web mock cleanup |
| 9 | ChatView stub handlers | 占位符 handler | WT-B chat stub fixes |

---

## 💡 创新亮点（答辩加分项）

| # | 亮点 | 答辩展示方式 |
|---|------|------------|
| 1 | IM-native 多 Agent 协作 | Demo：创建 TeamRun，Claude Code 和 Codex 在同一对话中分工协作，消息树可见 |
| 2 | 三种 Runtime 统一抽象 | Demo：Settings → Agent Profiles → 切换 Runtime（Claude Code → Codex → OpenCode），同一 UI 不同后端 |
| 3 | Hub-Edge 分布式架构 | 架构图：Desktop → Edge（本地安全） → Hub（云端治理）——"数据不出本地，协作走云端" |
| 4 | 完整中英双语 i18n | 现场切换语言演示——"竞品没一个做到的" |
| 5 | Execution Target 抽象 | 展示 Local/Remote/Cloud/Hub Relay 四种 Target 切换——"同一个 Agent Profile，跑在哪由你决定" |
| 6 | Append-only EventStore | 展示 RunEvent 回放——"每一步都可审计，出问题可追溯" |
| 7 | TokenDance 生态集成 | 展示 TokenDance ID 登录 → Gateway 模型路由 → 飞书通知（即使飞书还未完整实现，可展示规划） |

---

## 比赛答辩建议

### 1. Demo 脚本（5 分钟）

**0:00-1:00 开场定位**
- "AgentHub 不是又一个 AI 编码助手——它是 IM-native 的多 Agent 协作平台"
- "现有工具（Cursor、Claude Code、Codex）都是单人 Agent。AgentHub 让 Claude Code 和 Codex 在同一个群里对话、分工、协作。"

**1:00-2:30 核心功能 Demo**
- 打开 Desktop → WelcomeScreen → 创建 Project → 启动 Edge
- Settings → Agent Profiles：展示三种 Runtime 切换（Claude Code / Codex / OpenCode）
- 创建 Thread → 发送任务 → 展示 Agent 执行过程（tool calls、diff preview）
- **关键**：展示中英文切换——"竞品没一个做到的"

**2:30-4:00 IM-native 多 Agent 协作**
- 创建 IM 群聊 → 添加 Claude Code Agent + Codex Agent
- 发送任务 → 展示两个 Agent 在群聊中对话、分工
- 展示 TeamRun 控制和消息树

**4:00-5:00 架构和生态**
- 展示 Hub-Edge 分布式架构图（1 张幻灯片）
- TokenDance 生态：ID 登录、Gateway 路由、飞书通知路线图
- "本地执行保安全，云端治理保协作——这是 AgentHub 的独特定位"

### 2. 主动提及的竞品对比

| 竞品 | 如何定位 |
|------|---------|
| Cursor / Windsurf | "IDE-native 单人 Agent，AgentHub 是 platform-native 多人协作" |
| Claude Code / Codex | "它们是 AgentHub 的 Runtime，AgentHub 是它们的协作层——不是替代，是增强" |
| Teamily AI | "IM-native 但不是开发者工具——AgentHub 填补了专业开发者 IM 协作的空白" |
| OpenHands | "云端优先、Docker 部署——AgentHub 是本地优先、Tauri 桌面端" |

### 3. 差异化价值定位（一句话）

> **AgentHub 是唯一让 Claude Code、Codex 和 OpenCode 在同一工作台上对话、分工、治理的 AI 协作平台——本地执行、IM-native、中英双语。**

### 4. 可预见的评审问题和参考答案

**Q: "和 Cursor/Windsurf 有什么区别？"**
A: Cursor 和 Windsurf 是 IDE-native 的工具——你打开它写代码。AgentHub 是 platform-native 的平台——你打开它管理多个 Agent 协作。Cursor 的 Agent 是一个人写，AgentHub 的 Agent Team 是一群人（Claude Code + Codex + OpenCode）一起写。我们是 IM 层的创新，不替代任何 Runtime。

**Q: "为什么不用 Claude Code 自带的 MCP/Agent 功能？"**
A: Claude Code 的 Agent Team 还处在 TeammateIdle hook 阶段，没有 IM 接口。而且 Claude Code 锁定 Anthropic 模型。AgentHub 让你同时用 Claude Code（Anthropic）、Codex（OpenAI）、OpenCode（多模型），同一个 Team 里各取所长。

**Q: "i18n 是 feature 吗？"**
A: 对全球市场不一定是，但对字节比赛和中国开发者是。10 个主流竞品中只有 AgentHub 做了完整中英双语。这是产品化诚意。

**Q: "产品做到什么程度了？"**
A: P0 本地执行已完成（三种 Runtime 适配、8 种部署场景中 1 种完整 + 2 种可运行）。当前正在做产品化打磨（设置系统收敛、Web mock 清理、Glass UI token 规范化）。Roadmap 上 Q3 是 IM 协作完整化、Q4 是差异化完备。

---

## 附录：竞品数据速查

### 行业定价收敛（2026 年 6 月）

| 工具 | 入门价 | 中间价 | 企业价 | 计费模式 |
|------|--------|--------|--------|---------|
| Cursor | Free（受限） | Pro $20/月 | Enterprise 定制 | Credit 池（Auto 模式不限） |
| Windsurf | Free（评估用） | Pro $20/月 | Enterprise 定制 | 日/周配额（2026.3 废除 credit） |
| GitHub Copilot | Free（受限） | Business $19/人 | Enterprise $39/人 | Token 计费（2026.6 生效） |
| Devin | Core $20/月 | Team $500/月 | Enterprise 定制 | ACU（Agent Compute Unit） |
| Claude Code | Free（自带 key） | Pro $20/月 | — | API 用量 + Pro 额度 |
| Codex | Go $8/月 | Plus $20/月 | Business $20-30/人 | Credit 公式计费 |
| OpenHands | Free（自部署） | Cloud 付费 | Enterprise | SaaS 分层 |
| **AgentHub** | **开源免费** | — | — | **本地执行无 API 费用** |

### 用户规模

| 工具 | 安装量/用户 | GitHub Stars | 年度收入（如公开） |
|------|------------|-------------|-------------------|
| Cursor | 1M+ 付费用户 | N/A | $2B+ ARR（2026.2） |
| Windsurf | — | N/A | 被 $250M 收购 |
| Claude Code | N/A（npm + 捆绑） | N/A | N/A |
| Codex CLI | 86.1M npm/周 | N/A | N/A |
| OpenHands | 3M+ 下载 | 69-75K | — |
| Aider | 6.8M+ pip 安装 | ~45K | — |
| Cline | 5M+ VS Code 安装 | 61.2K | — |
| Continue.dev | 2.5M+ VS Code 安装 | ~32K | — |
| AionUI | — | 26.3K | — |

### SWE-bench Verified 对比

| 工具 | 最高分 |
|------|--------|
| Claude Code（Opus 4.7） | 87.6% |
| Aider（o1-preview + DeepSeek Architect/Editor） | ~85%（Polyglot benchmark） |
| OpenHands（Claude Sonnet 5-attempt） | 77.6% |
| Codex | 未公开 |
| Devin（PR 接受率） | 61.6%（最低但持续改善） |

---

> 内部参考文档：`docs/reference/competitor-master-report.md`、`docs/reference/cross-comparison/15-competitive-update-2026-05-27.md`、`docs/reference/projects/aionui/07-gap-analysis.md`
> 
> 本报告基于 AgentHub 代码库审计（Settings system + Docs + reference 竞品分析）+ Web 调研（2026-06-03），所有竞品数据优先来自参考目录已有调研，辅以 web search 验证。

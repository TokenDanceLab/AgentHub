## AgentHub Wave 1 全景进度报告

> 生成时间：2026-06-03 13:30 HKT
> 基线：`dev/delicious233` @ `2f09d7c`
> 新增提交：10 个（自 `31a9e56` 基线以来）

---

### Wave 1 Worktree 状态

| Worktree | 分支 | 状态 | 合并提交 | 关键成果 |
|----------|------|------|---------|---------|
| **WT-A** web-mock-cleanup | ~~feat/web-mock-cleanup~~ | ✅ **已完成** | `bfcd826` | 4 个 Web 页面 mock 数据清除，接入 Hub API |
| **WT-B** chat-stub-fixes | ~~feat/chat-stub-fixes~~ | ✅ **已完成** | `a09771e` | ChatView stub handler 修复，审批面板增强，测试补充 |
| **WT-C** settings-extraction | feat/settings-extraction | 🔄 **进行中** | — | SettingsPage 4200→3151 行，31 个 section 已 import，仍有 ~1000 行待提取 |
| **WT-D** glass-tokens | ~~feat/glass-tokens~~ | ✅ **已完成** | `2f09d7c` | 793→12 个 rgba()，26 个 glass token 定义，dark/light 双主题 |
| **WT-E** git-hygiene-backend | ~~feat/git-hygiene-backend~~ | ✅ **已完成** | `55db8b8` | .gitignore 完善、CHANGELOG 更新、本地开发指南 |

**完成率：4/5（80%）**

### WT-C 当前进度细看

```
SettingsPage.tsx:  4200 → 3151 行（↓25%，目标 ≤1500）
Section imports:   31 个（目标 ≥25 ✅）
测试文件:          SettingsPage.test.tsx 大幅更新（-1786/+490 行）
待完成:            继续提取剩余 inline section → 目标 ~1000 行待削减
```

### 分支清理

已清理：
- `feat/web-mock-cleanup` — 过期（工作直接提交到 dev），分支 + worktree 已删除
- `feat/chat-stub-fixes` — 已合并，分支 + worktree 已删除
- `feat/glass-tokens` — 已合并，分支 + worktree 已删除
- `feat/git-hygiene-backend` — 已合并，分支 + worktree 已删除

剩余：
- `feat/settings-extraction` — 仍在运行中，保留

### 竞品分析报告

4 份报告全部完成，位于 `docs/roadmaps/`：

| 报告 | 文件 | 大小 | 核心发现 |
|------|------|------|---------|
| Chat 交互 | `competitive-gap-chat.md` | 21KB | 消息类型最丰富(18种)，缺对话历史搜索和 Apply All |
| UI/UX | `competitive-gap-uiux.md` | 16KB | Glass 拟态 + 四层 Token 独一无二，动效/空状态短板 |
| 工程架构 | `competitive-gap-engineering.md` | 24KB | AI 协作基础设施行业领先(5/5)，沙箱隔离缺失 |
| 产品化 | `competitive-gap-product.md` | 27KB | 中英双语行业唯一，README/onboarding/帮助系统短板 |

### 未提交文件（主仓库）

```
?? docs/roadmaps/competitive-gap-chat.md
?? docs/roadmaps/competitive-gap-engineering.md
?? docs/roadmaps/competitive-gap-product.md
?? docs/roadmaps/competitive-gap-uiux.md
?? docs/roadmaps/quality-convergence.md
?? docs/roadmaps/worktree-execution-plan.md
```

---

## 竞品分析 P0 改进清单汇总

从 4 份报告中提取的跨报告 P0 项（按比赛评分权重排序）：

### AI 协作能力 30%

1. **MCP Server 端点暴露** — Edge 新增 `/mcp` 端点，暴露 project/thread/run 为 MCP tools
2. **Agent Context 标准化** — 发布 Skill/Prompt 格式规范，兼容 CLAUDE.md 和 .clinerules
3. **沙箱执行隔离** — Edge 增加 Docker sandbox adapter，三模式执行

### 功能完整度 25%

4. **对话历史搜索** — SearchDialog 组件，跨会话关键词检索
5. **Apply All 批量应用 Diff** — FileChangeBlock 底部一键应用
6. **@symbol / @folder 引用** — 扩展 useMention 支持函数/类名/文件夹
7. **Code Generation 预览** — write/edit 结果 Preview before apply

### 生成效果质量 20%

8. **TSX 硬编码颜色清理** — 5 个文件中 inline hex 改为 CSS class + design token
9. **空状态品牌个性** — 空 Threads/Runs/Chat 列表增加图标 + 引导文案 + 快捷键 CTA
10. **动效/转场增强** — hover/active/focus 过渡动画，参考 Windsurf Cascade

### 代码理解度 15%

11. **Hub 测试覆盖率 40%→65%** — 补 handler/service/middleware 层测试
12. **可观测性** — OpenTelemetry 分布式追踪集成

### 创新与产品感 10%

13. **README 产品化** — 截图/GIF/对比表/Download CTA
14. **Onboarding 引导** — WelcomeScreen 三步引导：创建 Project → 选 Runtime → 启动 Agent
15. **用户文档** — user-guide.md + faq.md
16. **错误处理系统** — 全局 ErrorBoundary + toast + WS 断连重连

---

## Wave 2 规划建议

### 前置依赖

```
WT-C merge → WT-C2 (settings-css-split) 可以启动
WT-C merge → WT-C3 (settings-i18n-polish) 可以启动
WT-A merge ✅ → WT-A2 (web-tests) 可以启动
WT-B merge ✅ → WT-B2 (im-css-modular) 可以启动
WT-D merge ✅ → WT-D2 (web-light-theme) 可以启动
```

### 建议 Wave 2 分两批

**Wave 2a（WT-C 完成后可立即启动，5 路并行）：**

| Worktree | 来源 | 优先级 | 理由 |
|----------|------|--------|------|
| WT-C2 settings-css-split | 原计划 | P0 | SettingsPage CSS 2114→400 行 |
| WT-A2 web-tests | 原计划 | P1 | Web 测试覆盖率 |
| WT-B2 im-css-modular | 原计划 | P1 | IM 组件 inline style → CSS module |
| **WT-F docs-productization** | **竞品分析新增** | **P0** | README 产品化 + onboarding + 用户文档 |
| **WT-G chat-enhancements** | **竞品分析新增** | **P0** | 对话搜索 + Apply All + @引用增强 |

**Wave 2b（Wave 2a 部分完成后）：**

| Worktree | 来源 | 优先级 | 理由 |
|----------|------|--------|------|
| WT-C3 settings-i18n-polish | 原计划 | P1 | 设置页硬编码字符串清理 |
| WT-D2 web-light-theme | 原计划 | P2 | Web 端 light theme + 6 preset |
| WT-E2 i18n-cleanup | 原计划 | P1 | IM/ChatView 硬编码中英文 |
| **WT-H mcp-server** | **竞品分析新增** | **P0** | Edge MCP Server 端点 |
| **WT-I error-handling** | **竞品分析新增** | **P1** | 全局错误处理系统 |

### 不建议进入 Wave 2 的项（投入产出比低或范围太大）

- **沙箱执行隔离** — 需要架构级设计，建议作为 M2 里程碑单独规划
- **OpenTelemetry 集成** — 工程量大且比赛加分有限
- **Hub 测试覆盖率 65%** — 应分散到各个后续 worktree 中逐步提升

---

## 答辩核心叙事

> "AgentHub 不是又一个 AI 编码助手——它是**唯一让 Claude Code、Codex、OpenCode 在同一 IM 工作台上对话协作**的平台。本地执行、中英双语、Hub-Edge 分布式架构、团队审批流、Glass 拟态设计系统。"

**重点 Demo 环节**：
1. 三种 Runtime 在同一聊天窗口协作（独有）
2. 团队审批流 + 风险等级 + 二次确认（独有）
3. Glass 拟态 dark/light 主题切换（视觉冲击）
4. IM 原生多 Agent 协作（独有）
5. 中英双语无缝切换（行业唯一）

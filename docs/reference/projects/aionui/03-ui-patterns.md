# 03 - AionUi UI/UX 模式

## 组件树（顶层 → 叶子）

```
App
├── LoginPage                    # 登录/密码保护
├── ConversationPage             # 主对话界面
│   ├── Sidebar
│   │   ├── AgentList            # 已检测 Agent 列表
│   │   ├── ConversationList     # 历史会话
│   │   └── SettingsButton
│   ├── ChatArea
│   │   ├── MessageList          # 消息流
│   │   │   ├── UserMessage      # 用户消息气泡
│   │   │   ├── AssistantMessage # AI 回复
│   │   │   │   ├── TextBlock    # 文本/Markdown
│   │   │   │   ├── ToolCallCard # 工具调用卡片
│   │   │   │   │   ├── DiffViewer     # 文件差异
│   │   │   │   │   ├── CodeBlock      # 代码片段
│   │   │   │   │   └── BrowserPreview # 网页预览
│   │   │   │   └── ApprovalCard # 审批卡片
│   │   │   └── SystemMessage    # 系统通知
│   │   ├── ChatInput            # 输入区
│   │   │   ├── TextArea         # 文本输入
│   │   │   ├── FileUpload       # 文件上传
│   │   │   ├── ModelSelector    # 模型选择
│   │   │   └── AgentSelector    # Agent 选择
│   │   └── StatusBar            # Agent 状态指示
│   └── FilePanel                # 工作区文件浏览
├── TeamPage                     # Team 模式
│   ├── TeamDashboard            # 总览
│   │   ├── LeaderPanel          # Leader 状态
│   │   └── TeammateGrid         # Teammate 卡片矩阵
│   │       └── TeammateCard     # 单 Agent 状态卡片
│   ├── TaskBoard                # 任务看板
│   └── MailboxView              # Agent 间消息
├── CronPage                     # 定时任务管理
│   ├── CronList
│   └── CronEditor
├── SettingsPage                 # 设置
│   ├── AgentSettings            # Agent 配置
│   ├── ModelSettings            # 模型/API Key 管理
│   ├── MCPSettings              # MCP Server 管理
│   ├── ExtensionSettings        # 扩展管理
│   ├── ChannelSettings          # IM 通道配置
│   └── AppearanceSettings       # 外观/主题
└── PetOverlay                   # 桌面宠物覆盖层
    └── AnimatedSprite           # 动画精灵
```

## 关键交互状态转换

### 消息发送流程

```
┌──────────┐   输入    ┌──────────┐   发送    ┌──────────┐
│  EMPTY   │ ────────→ │ TYPING   │ ────────→ │ SENDING  │
│(空输入框)│           │(用户输入)│           │(发送中)  │
└──────────┘           └──────────┘           └────┬─────┘
                                                   │
                                          ┌────────┼────────┐
                                          │        │        │
                                          ▼        ▼        ▼
                                    ┌────────┐ ┌──────┐ ┌──────┐
                                    │STREAM  │ │ERROR │ │QUEUED│
                                    │(流式)  │ │(错误)│ │(排队)│
                                    └───┬────┘ └──┬───┘ └──┬───┘
                                        │         │        │
                                        ▼         ▼        │
                                    ┌────────┐ ┌──────┐    │
                                    │  DONE  │ │RETRY │◄───┘
                                    │(完成)  │ │(重试)│
                                    └────────┘ └──────┘
```

### 审批交互流

```
Agent 请求执行工具
       │
       ▼
┌──────────────┐
│PENDING_      │ ← 显示审批卡片（黄色边框）
│APPROVAL      │   选项：[Approve] [Deny] [View Details]
└──────┬───────┘
       │
  ┌────┴────┐
  │         │
  ▼         ▼
[批准]   [拒绝]
  │         │
  ▼         ▼
┌──────┐ ┌──────┐
│EXEC  │ │DENIED│
│(执行)│ │(拒绝)│
└──┬───┘ └──────┘
   │
   ▼
┌──────┐
│RESULT│ ← 显示执行结果
└──────┘

YOLO Mode: 跳过 APPROVAL 状态，直接 EXEC
Auto Mode: 低风险操作跳过，高风险仍需审批
```

### 流式消息渲染

```
┌──────────┐   chunk   ┌──────────────┐   complete   ┌──────────┐
│ WAITING  │ ────────→ │ STREAMING    │ ────────────→│ COMPLETE │
│(等待首字)│           │(增量渲染)    │              │(渲染完毕)│
└──────────┘           └──────┬───────┘              └──────────┘
                              │
                              │ 每收到一个 chunk:
                              │ - TextDelta → 追加文本
                              │ - ToolCall → 插入工具卡片
                              │ - Approval → 插入审批卡片
                              │ - Error → 插入错误卡片
                              │
                              │ 渲染策略:
                              │ - 文本: 直接拼接(React key=stable)
                              │ - Markdown: 异步渲染(remark/rehype)
                              │ - 代码块: highlight.js 语法高亮
                              │ - Diff: Monaco DiffEditor(懒加载)
```

## 动画/过渡系统

- **CSS Transitions**：消息出现用 `opacity + translateY` 淡入
- **Thinking 指示器**：三跳点动画（`.thinking-dot` 依次缩放）
- **Tool Call 展开**：CSS `max-height` transition（不依赖 JS 动画库）
- **Pet 角色**：基于 spritesheet 的帧动画（CSS `steps()` timing function）
- **页面切换**：无路由动画（直接替换，保持性能）

## 主题/色彩系统

AionUi 使用**深色优先**设计：

- **色彩变量**：CSS custom properties，全局注入
- **暗色模式**：深灰底（`#1a1a2e`）+ 绿色强调（`#32CD32`）
- **亮色模式**：白底 + 同绿色系（通过 `.light` class 切换）
- **Arco Design 主题**：覆盖 Arco 默认蓝色为绿色系
- **扩展主题**：`ExtensionRegistry.resolveThemes()` 允许扩展注入自定义主题

关键 token（从 UnoCSS config 推断）：
```
--primary: #32CD32 (lime green)
--bg-base: #1a1a2e (dark navy)
--bg-elevated: #16213e
--text-primary: #eee
--text-secondary: #aab
--border: #2a2a4a
```

## 无障碍（WCAG 级别）

- **键盘导航**：Tab 切换焦点，Enter 发送消息，Escape 关闭弹窗
- **ARIA 标签**：按钮、输入框均有 `aria-label`
- **色对比度**：深色模式下文本对比度 ≥ 4.5:1（WCAG AA）
- **屏幕阅读器**：消息区域 `role="log"`，新消息 `aria-live="polite"`
- **不足**：未全面达到 WCAG AA，无专用无障碍测试

## UI 架构决策（对 AgentHub 的参考价值）

| 决策点 | AionUi 做法 | AgentHub 适用性 |
|--------|-------------|-----------------|
| 组件库 | Arco Design（字节） | 可考虑 Semi-UI（已有）或 Arco |
| CSS 方案 | UnoCSS（原子化） | 当前 CSS Modules，可混合使用 |
| 流式渲染 | 自定义 stream parser | 可直接采纳模式 |
| 审批 UI | 内联卡片，不弹窗 | 应采纳——不打断用户流 |
| 文件面板 | 常驻侧边栏 | 应采纳——AgentHub 已有 workspace 概念 |
| Team 视图 | 卡片矩阵 + 看板 | M4 功能，重点参考 |
| Pet 浮层 | Overlay 窗口 | 可选，趣味性功能 |

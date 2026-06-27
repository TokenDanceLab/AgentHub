# 09 - AionUi vs AgentHub UI 深度对比报告

> 基于 AionUi 源码分析 + AgentHub 实际代码（`app/desktop/`、`app/web/`、`AgentHubHome/`）的逐项对比。
> 前置阅读：[08-ui-packaging-gap.md](./08-ui-packaging-gap.md)（产品包装对比）、[07-gap-analysis.md](./07-gap-analysis.md)（功能差距报告）

---

## 0. 总体判断

**AgentHub 的设计工程化程度远超 08 报告中描述的"2 分"水平。** 经过 P0-P3 + M3b-M6 持续建设，AgentHub 已具备完整的设计 token 体系（OKLCH 色空间、7 级字号、4 级 easing curve、WCAG 适配）。但 AionUi 在**设计系统成熟度、微观交互打磨、产品包装完整性**三个维度仍有领先。

| 维度 | AionUi | AgentHub | 差距 |
|------|--------|----------|:--:|
| 设计 token 数量 | 80+ | ~60 | 小 |
| 色阶系统 | 10 级品牌色 + 10 级灰度 | OKLCH 语义色 + 4 级 surface | 路线不同，持平 |
| Light/Dark 独立色值 | 完整两套 | 完整两套 | 持平 |
| TypeScript 类型安全引用 | `cssVars.bg[2]` | 无 | **大** |
| 原子 CSS 集成 | UnoCSS 原子类 | CSS Modules 手动引用 | **大** |
| 滚动条定制 | 透明 hover 渐显 | thin + 固定色 | 中 |
| 侧边栏动画 | translateX + opacity 过渡 | transform slide（仅 mobile） | 中 |
| 业务状态动画 | Team 标签呼吸光晕 | fade-in / slide-in 基础 | **大** |
| prefers-reduced-motion | 全局 | 全局 | 持平 |
| Mobile 适配 | safe-area + 100dvh + 44px | safe-area + 100dvh + 44px | 持平 |
| 产品 README | banner + 动图 + 对比表 + 多语言 | 架构图 + 文档链接 | **大** |
| 官网 SEO | 完整 og:image + meta | 缺失 | 中 |
| 共享 UI 库 | 无独立包概念 | `@shared/ui` 8 组件 + 测试 + Storybook | **AgentHub 领先** |
| 虚拟滚动 | 懒加载旧消息 | `@tanstack/react-virtual` | **AgentHub 领先** |
| 代码语法高亮 | 未确认 | Catppuccin 风格 token 着色 | **AgentHub 领先** |
| Card-Based 布局 | 传统全宽 | 720px 居中卡片 | **AgentHub 领先** |

**关键发现**：AgentHub 不是"2 分"，而是约 **6-7 分**。从 0 到 6 已完成，从 6 到 9 的差距主要在**精致度**和**产品包装**。

---

## 1. 设计 Token 体系对比

### 1.1 色阶系统

**AionUi — 10 级品牌色阶：**

```
品牌色系（AOU Purple-Gray）：
  --aou-1  (#eff0f6) → --aou-6  (#7583b2, 主色) → --aou-10 (#0d101c)
  语义色系（功能色）：primary/success/warning/danger，Light/Dark 各一套
  灰度阶梯：bg-0 → bg-10，10 级层级深度控制
```

**AgentHub — OKLCH 语义体系：**

```css
/* 语义色 — 按用途组织，非色阶 */
--primary / --secondary / --muted / --accent / --destructive
--success / --warning / --info / --brand

/* 4 级 Surface 层级 */
--surface-base → --surface-raised → --surface-raised-hover → --surface-overlay

/* 领域专用色（AionUi 没有的） */
--authority-hub / --authority-edge / --authority-hybrid  /* 权威来源 */
--run-queued / --run-starting / --run-running / --run-completed / --run-failed  /* 运行状态 */
--diff-added-bg/border / --diff-removed-bg/border  /* Diff 着色 */
```

**判断**：两种路线各有优劣。AionUi 色阶适合精细 UI 层级控制（侧边栏嵌套深度），AgentHub 语义色适合功能驱动产品（业务语义内建在 token 中）。AgentHub 不需照搬色阶路线。

### 1.2 品牌色与功能色解耦

**AionUi**：品牌色（AOU Purple-Gray）→ UI chrome / 语义色 → 功能元素 / 营销色（`#32CD32`）→ README。**三套完全独立。**

**AgentHub**：主应用品牌色 = `oklch(0.75 0.12 260)` 蓝色 / 官网品牌色 = `#7c5cfc` 紫色。**主应用和官网用不同品牌色，造成品牌割裂。** 这是需要修复的问题。

### 1.3 Token 消费方式 — 核心代差

```
AionUi 四端统一:
  CSS:    var(--bg-2)           ← 直接引用
  UnoCSS: bg-2, text-primary   ← 原子类零成本消费
  TS:     cssVars.bg[2]        ← 类型安全引用
  Figma:  同名变量              ← 设计代码同步

AgentHub 两端:
  CSS:    var(--primary)        ← CSS Modules 手动引用
  TS:     无类型定义
  Figma:  不同步
```

**AionUi 的 UnoCSS 原子类让开发者写 `bg-2 text-primary` 就能消费设计 token，AgentHub 需要在每个 CSS Module 中手动写 `var(--xxx)`。这是开发体验的代差。**

---

## 2. 微观交互逐项对比

### 2.1 滚动条

| 特性 | AionUi | AgentHub |
|------|--------|----------|
| 宽度 | 6px | 6px |
| 默认状态 | `transparent` 完全隐藏 | `oklch(0.3 0.01 260)` 始终可见 |
| hover 行为 | `transition: background 0.3s` 渐显 | 直接变色，无过渡 |
| 深浅模式 | 独立色值 | 独立色值 |

**AionUi 的实现**（`base.css`）：
```css
::-webkit-scrollbar-thumb { background: transparent; transition: background 0.3s; }
*:hover::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); }
[data-theme='dark'] *:hover::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); }
```

**AgentHub 改进（30 分钟）**：将 `--scrollbar-thumb` 默认值改为 `transparent`，hover 时渐显。

### 2.2 侧边栏动画

**AionUi**：折叠时文字 `opacity + translateX(-8px)` 向左淡出，所有元素 `0.25s ease` 同步过渡，`transform-origin: left center`。

**AgentHub**：仅 mobile overlay 面板有 `transform: translateX` 过渡（180ms）。桌面端侧边栏折叠是**硬切**——这是需要修复的体验问题。

### 2.3 状态动画 — 最大差距

**AionUi Team 标签呼吸动画**（最令人印象深刻的细节）：
```css
@keyframes team-tab-breathe {
  0%, 100% { opacity: 1; box-shadow: none; }
  50% {
    opacity: 0.85;
    background-color: color-mix(in srgb, var(--color-primary-6) 18%, transparent);
    box-shadow:
      0 0 8px 2px color-mix(in srgb, var(--color-primary-6) 30%, transparent),
      inset 0 0 6px 0 color-mix(in srgb, var(--color-primary-6) 15%, transparent);
  }
}
```

活跃 Agent 的标签有呼吸光晕——用户一眼就知道哪个 Agent 正在工作。**这是专业产品才会做的细节。**

**AgentHub**：有 `fade-in`、`slide-in-right`、`progress-indeterminate` 三个通用动画，但**没有为业务状态**（Agent 思考中、工具执行中、等待审批）设计专属动画。

**建议新增**：
- Agent 思考 → 输入区边框微光呼吸
- 工具执行中 → 工具卡片左侧边框脉冲
- 等待审批 → 审批按钮柔光吸引注意

### 2.4 消息入场动画

**AionUi**：消息以 `opacity + translateY` 淡入。

**AgentHub**：虚拟滚动 + 无入场动画。虚拟滚动与入场动画组合较难（新消息可能不在可视区），但可在**用户主动发送的消息**和**首条机器回复**上用 `animate-fade-in`。

---

## 3. 布局架构对比

| 特性 | AionUi | AgentHub |
|------|--------|----------|
| 布局模型 | 传统 sidebar + main + right panel | **Card-Based 三区布局** |
| 左侧 | 会话列表 sidebar | 56px 图标导航 + 可展开 ThreadPanel |
| 中间 | ConversationPage 全宽 | **Workspace Card（max-width 720px 居中）** |
| 右侧 | Inspector/Detail | RightPanel（300px） |
| 独特优势 | Team Dashboard / Cron Page 独立页面 | Card 布局更具现代感和聚焦感 |

**AgentHub 的 Card-Based 布局在视觉上比 AionUi 的传统全宽布局更现代、更聚焦。这是不应放弃的设计资产。**

响应式策略两者水平相当——都支持 `safe-area-inset`、`100dvh`、44px 触控、iOS 16px 防缩放。AgentHub 额外做了平板断点（768-1023px）和 `MobileToolbar` 组件。

---

## 4. 组件体系对比

### 4.1 共享 UI 库

**AionUi**：组件在 `src/renderer/components/` 下按功能组织（`chat/`、`team/`、`cron/`），无独立共享 UI 包。

**AgentHub**：`@shared/ui` 包 — 8 个组件（Button、Card、Avatar、Pill、ProgressBar、SearchInput、CollapsibleBlock、TextShimmer），全部有测试/Storybook，被 desktop 和 web 共同引用。

**AgentHub 领先**：明确的包边界 + 测试 + Storybook。但 8 个组件偏少，缺少 Toast、Dialog、Tooltip、Tabs、DropdownMenu。

### 4.2 业务组件覆盖

**AgentHub 已有且质量不错的**：
- `ChatView`：虚拟滚动 + 消息类型分发 + 流式文本 + Diff 内联
- `PromptInput`：@mention + 模型选择 + 草稿持久化 + 非受控输入
- `ThreadPanel`：搜索 + 内联重命名 + 删除确认
- `IMMessageView / IMMessageInput / IMContactList`：完整 IM 模式
- `DiffViewer`、`PermissionDialog`、`SearchDialog`、`MessageTree`

**AgentHub 缺少但 AionUi 有的**：
- `TaskBoard`（Team Mode 看板）、`ToolCallCard`（工具调用时间线）、`CronConfigPage`、`AgentDiscoveryPanel`、`ContextUsageChart`

---

## 5. Chat/消息体验对比

### 5.1 消息渲染

| 特性 | AionUi | AgentHub |
|------|:--:|:--:|
| 虚拟滚动 | 懒加载旧消息 + memo | ✅ `@tanstack/react-virtual` |
| 流式文本 | ✅ ACP text_delta | ✅ `useStreamingText` hook |
| 工具调用卡片 | ✅ ToolCallCard 时间线 | ✅ CollapsibleBlock + Pill |
| Diff 内联 | Monaco Editor diff | ✅ 内联 Diff 卡片 |
| 代码高亮 | 未确认 | ✅ Catppuccin 风格 token 着色 |
| 消息操作 | Copy/Retry/Delete | ✅ Copy/Retry/Delete |
| 消息树/Fork | ✅ `AcpSession.fork()` | ✅ `MessageTree` 组件 |
| 相对时间 | 未确认 | ✅ "Just now / 5 min ago / Yesterday" |
| 空状态 | 未确认 | ✅ WelcomeScreen + EmptyState |
| Loading 骨架 | `bg-animate` keyframe | ✅ Skeleton + TextShimmer |

**AgentHub 在消息渲染功能上不落后甚至局部领先**（虚拟滚动是 AionUi 缺失的）。差距在动画精致度而非功能完整性。

### 5.2 输入体验

| 特性 | AionUi | AgentHub |
|------|:--:|:--:|
| 非受控输入 | ✅ useRef + DOM | ✅ useRef + DOM |
| 草稿持久化 | ✅ localStorage[threadId] | ✅ `useInputDraft` hook |
| @提及 | ✅ @agent / @file | ✅ MentionPopover + useMention |
| 斜杠命令 | ✅ /search /file /agent /model /clear /fork | ❌ |
| 模型切换 | /model 命令 | ✅ 下拉选择器 |
| 循环检测 | ✅ 3/5 次相同工具调用阈值 | ❌ |

**差距**：AgentHub 缺少斜杠命令和工具调用循环检测。路线图中已有排期。

---

## 6. 产品包装对比

### 6.1 GitHub README — 最大差距

| 要素 | AionUi | AgentHub |
|------|:--:|:--:|
| Banner 图片 | ✅ 产品示意 + AI Agent 视觉 | ❌ |
| Badge 统一色 | ✅ 绿底 `#32CD32` | ✅ 4 枚，无统一色 |
| Trending 徽章 | ✅ 动态 | ❌ |
| 功能对比表 | ✅ 5 维 AionUi vs 传统工具 | ❌ |
| 产品动图 | ✅ 10+ 张 GIF | ❌ |
| Download CTA | ✅ 绿色大按钮 | ❌ |
| 多语言 | ✅ 10+ 语言 | ⚠️ 中英双语 |
| Community | ✅ Discord/微信/Twitter | ❌ |

**AgentHub README 质量不低**（237 行，架构图 + 组件表 + Demo 流程 + 技术栈 + 快速开始），但它是一份**好的技术文档**而非**好的产品首页**。AionUi 的 README 是产品首页。

### 6.2 官网 Landing Page

AgentHubHome 的官网质量不差——终端风格 Hero 有视觉记忆点、动画完整（fadeSlideUp + pulseGlow + gradientShift）、响应式到位。差距在 **SEO 标签**（og:image、meta description、hreflang、theme-color）和**品牌色统一**。

---

## 7. 可访问性 — AgentHub 持平或领先

| 特性 | AionUi | AgentHub |
|------|:--:|:--:|
| `prefers-reduced-motion` | ✅ | ✅ |
| Focus ring | 未确认 | ✅ 2px + offset + 品牌色 |
| 触控目标 44px | ✅ | ✅ `--touch-target-min` |
| iOS 16px 防缩放 | ✅ | ✅ |
| `safe-area-inset` | ✅ | ✅ |
| `100dvh` | ✅ | ✅ |
| 滚动条定制 | ✅ | ✅ |
| 文本选择色 | 未确认 | ✅ `::selection` |
| 字体抗锯齿 | 未确认 | ✅ `-webkit-font-smoothing` |
| `text-autospace` | 未确认 | ✅ 中英文间距自动插入 |

AgentHub 在可访问性上**持平甚至领先** AionUi。这是显著优势。

---

## 8. 差距矩阵总览

```
                          AionUi    AgentHub    差距
设计 token 数量             80+        ~60        小
品牌/功能色解耦              ✅         部分        中
TypeScript token 引用         ✅         ❌         大
原子CSS消费                  ✅         ❌         大
Figma 同步                   ✅         ❌         中
滚动条渐隐                   ✅         ❌         中
侧边栏过渡动画               ✅         部分        中
业务状态动画                 ✅         基础        大
消息入场动画                 ✅         ❌         中
README 产品包装              ✅         ❌         大
官网 SEO                     ✅         ❌         中
斜杠命令                     ✅         ❌         中
工具循环检测                 ✅         ❌         中
共享 UI 库                   ❌         ✅         AgentHub领先
虚拟滚动                     ❌         ✅         AgentHub领先
代码语法高亮                 未确认      ✅         AgentHub领先
可访问性                     ✅         ✅         持平
Mobile 适配                  ✅         ✅         持平
Card-Based 布局              无         ✅         AgentHub领先
```

---

## 9. 优先级行动清单

### 立即（本周，~2 天）

| # | 改进 | AionUi 参考 | 时间 |
|---|------|-------------|:--:|
| 1 | **README 加产品截图/GIF** — 录 3-5 张核心功能动图 | README GIF 策略 | 3h |
| 2 | **README 加功能对比表** — AgentHub vs 传统聊天客户端 | 对比表心理学 | 1h |
| 3 | **README 加 Banner 图** — 产品视觉 | 顶部 banner | 2h |
| 4 | **滚动条 hover 渐显** — 默认透明，hover 出现 | `base.css` L90-129 | 30min |
| 5 | **统一品牌色** — 官网 `#7c5cfc` ↔ 产品蓝色 | 品牌色解耦原则 | 1h |
| 6 | **官网加 SEO 标签** — og:image、meta description、theme-color | aionui.com head | 1h |

### 短期（1-2 周）

| # | 改进 | 参考 | 时间 |
|---|------|------|:--:|
| 7 | **斜杠命令系统** — /search /file /clear /agent /model | `slash/` 命令注册 | 2d |
| 8 | **侧边栏折叠动画** — translateX + opacity | `layout.css` L41-120 | 2h |
| 9 | **消息入场动画** — 用户发送 + 首条回复淡入 | CSS transitions | 1h |
| 10 | **Agent 状态动画** — 思考/执行/等待的呼吸/脉冲 | team-tab-breathe | 3h |
| 11 | **工具循环检测** — (toolName, argsHash) + 3/5 阈值 | AcpSession | 2h |
| 12 | **TypeScript token 类型** — 生成 CssVars 类型定义 | `colors.ts` | 1d |

### 中期（2-4 周）

| # | 改进 | 参考 | 时间 |
|---|------|------|:--:|
| 13 | **Tailwind/UnoCSS 桥接** — OKLCH token → 原子类 | UnoCSS 集成 | 3d |
| 14 | **README 多语言** — 中/英/日/韩 | README 多语言 | 2d |
| 15 | **TaskBoard 组件** — Team Mode 看板 | TaskBoard | 3d |
| 16 | **Token 用量图表** — StatusBar 常驻 + 历史 | ContextUsage | 2d |
| 17 | **ToolCallCard 时间线** — 工具调用可视化 | ToolCallCard | 2d |

---

## 10. 核心洞察

AionUi 最值得 AgentHub 学习的不是具体 CSS 技巧，而是**"设计工程化"的理解深度**：

```
AionUi:
  设计 token → 四端统一消费（CSS / UnoCSS / TypeScript / Figma）
  动画 → 表达系统状态，而非纯粹装饰
  品牌 → 营销色 ≠ 产品色 ≠ 功能色，三套独立
  包装 → README 是产品的一部分，不是"项目文档"

AgentHub 现状:
  设计 token → 只在 CSS，未进入 TypeScript/Figma
  动画 → 通用工具类，未绑定业务语义
  品牌 → 官网和产品用不同主色
  包装 → README 偏技术文档，缺少产品化表达
```

**最重要的三个改进方向**：

1. **让设计 token 进入 TypeScript**（类型安全引用）和 Figma（设计代码同步）
2. **让动画服务于业务状态感知**（而不仅是装饰），参考 AionUi 的 team-tab-breathe
3. **让 README 从"项目说明"升级为"产品首页"**，参考 AionUi 的功能对比表 + 动图策略

AgentHub 的工程基础（OKLCH 色空间、共享 UI 包、虚拟滚动、可访问性）已经打得很好。接下来是从"能用"到"精致"的最后一公里。

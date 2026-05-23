# AgentHub UI 美化计划 — 对齐 OpenCode 视觉品质

> 基准：OpenCode v1.15.10 的 185 组件 UI 体系
> 目标：在 React+Tauri 技术栈不变的前提下，达到同等视觉品质
> 工期：共 ~18 天，分 3 轮

---

## 1. 差距诊断

### 1.1 不是差在功能，差在"最后 10%"

AgentHub 的 UI 有骨架但缺血肉。拿一个消息气泡举例：

| 细节 | AgentHub 现状 | OpenCode |
|------|------|------|
| 字号层次 | 14px 一统 | 11px 时间戳 / 13px 代码 / 14px 正文 / 16px 标题 |
| 颜色层次 | fg / muted-fg 两档 | text-strong → text-weak → text-weaker → text-weakest 四档 |
| hover 态 | 无 | `bg-surface-raised-base-hover` 全局统一 |
| 间距节奏 | 不一致 | Tailwind 4px grid 自动保证 |
| 圆角 | 随意 | 卡片 8px / 按钮 6px / badge 999px 三种固定 |
| 流式输出 | 无指示 | `session-progress-whip` 2px 彩色进度条动画 |
| 空状态 | 空白 | 图标 + 标题 + 描述 + CTA 四件套 |
| 加载态 | 无 | Skeleton + Spinner + 渐变 placeholder |

### 1.2 根本原因：CSS 策略错了

AgentHub 用 CSS Modules 手写 6000+ 行 CSS，大部分是布局代码。OpenCode 用 Tailwind utility class 省掉了 90% 的布局 CSS，精力花在动效和微交互上。

**不需要换框架。shadcn/ui 已经内置了 Tailwind，AgentHub 的 `app/desktop` 项目可以直接用 Tailwind utility class，逐步淘汰 CSS Module。**

---

## 2. 三轮美化计划

### 第一轮：设计基础（5 天）— 不改任何组件，只升级基础设施

#### 2.1 字号梯度扩展

**当前**（3 级）→ **目标**（7 级）：

```css
:root {
  /* 保留现有 3 个作为基础 */
  --font-size-xs:   0.75rem;  /* 12px — 保留 */
  --font-size-sm:   0.875rem; /* 14px — 保留 */
  --font-size-base: 1rem;     /* 16px — 保留 */

  /* 新增 4 个 */
  --font-size-2xs:  0.625rem; /* 10px — keybind badge, 极小标注 */
  --font-size-lg:   1.125rem; /* 18px — section 标题 */
  --font-size-xl:   1.25rem;  /* 20px — 页面标题 */
  --font-size-2xl:  1.5rem;   /* 24px — 空状态大标题 */

  /* 字重新增 */
  --font-weight-semibold: 600; /* 标题专用，OpenCode 验证 */
}
```

#### 2.2 文字颜色梯度扩展

**当前**（2 档）→ **目标**（4 档）：

```css
:root {
  /* 现有 */
  --foreground:        oklch(0.92 0.005 260);  /* → text-strong */
  --muted-foreground:  oklch(0.55 0.012 260);  /* → text-weak */

  /* 新增 */
  --text-weaker:       oklch(0.42 0.008 260);  /* placeholder, disabled */
  --text-weakest:      oklch(0.30 0.006 260);  /* 几乎不可见的分隔符 */
}
```

#### 2.3 表面层级补全

OpenCode 有 4 层表面体系，AgentHub 只有 2 层：

```css
:root {
  /* 现有: background, card */

  /* 新增 */
  --surface-base:         oklch(0.14 0.006 260);  /* 最底层容器 */
  --surface-raised:       oklch(0.17 0.007 260);  /* 卡片/面板 */
  --surface-raised-hover: oklch(0.20 0.007 260);  /* hover 提升 */
  --surface-overlay:      oklch(0.22 0.008 260);  /* dropdown/popover */

  /* hover 统一变量（全局使用） */
  --hover-overlay: oklch(1 0 0 / 0.06);  /* 所有 hover 态的基础 */
}
```

#### 2.4 全局过渡一致性

```css
/* 所有可交互元素统一过渡 */
* {
  transition-property: color, background-color, border-color, opacity, box-shadow;
  transition-duration: var(--duration-fast);  /* 100ms — 够快不拖沓 */
  transition-timing-function: var(--ease-out);
}

/* 关键帧动画 */
@keyframes fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes slide-in-right {
  from { opacity: 0; transform: translateX(16px); }
  to   { opacity: 1; transform: translateX(0); }
}

@keyframes progress-indeterminate {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}

/* 动画工具类 */
.animate-fade-in       { animation: fade-in var(--duration-medium) var(--ease-out); }
.animate-slide-in      { animation: slide-in-right var(--duration-medium) var(--ease-out); }
.animate-progress      { animation: progress-indeterminate 1.5s infinite; }
```

---

### 第二轮：组件逐个美化（9 天）

#### 2.5 ChatView — 消息气泡重设计（3 天）

**对标 OpenCode 的 MessageTimeline**。核心改动：

| 项目 | 现状 | 目标 |
|------|------|------|
| Agent 头像 | 纯色圆点 | 24×24 品牌色头像 + agent name 标注 |
| 消息间距 | 不统一 | `gap-6`（24px）消息间，`gap-2`（8px）消息内工具调用间 |
| 工具调用卡片 | 裸 JSON 展开 | 折叠卡片：`[icon] tool_name` + status badge + 展开看详情 |
| 流式输出指示 | 无 | 2px 彩色进度条（OpenCode 的 `session-progress-whip`） |
| 时间戳 | 无 | 11px text-weaker，hover 显示精确时间 |
| 代码块 | 基础 Markdown | Shiki 语法高亮 + 语言标签 + 一键复制 |
| 消息 hover | 无变化 | 轻微背景变化 + 操作按钮出现（复制/重试） |

#### 2.6 ThreadPanel — 会话列表重设计（1.5 天）

| 项目 | 现状 | 目标 |
|------|------|------|
| 列表项密度 | 44px min-height | 紧凑 36px（更多信息可见） |
| 选中态 | 微弱 | 明显左侧 3px 品牌色竖线 + bg-surface-raised |
| 标题截断 | 无省略 | 单行省略 + tooltip 全称 |
| 时间 | 无 | 相对时间（"3分钟前"）+ 12px |
| Agent 多标签 | 无 | 彩色小圆点 × N |
| 未读指示 | 无 | 5px 圆点 |

#### 2.7 PromptInput — 输入框重设计（1.5 天）

对标 OpenCode 的 Composer：

| 项目 | 现状 | 目标 |
|------|------|------|
| 边框 | 常显边框 | focus 时边框变品牌色（ring transition） |
| placeholder | 固定文字 | 随 context 变化（"@Agent 回复..." / "输入新消息..."） |
| @mention | 无 | 输入 `@` 弹出 Agent 列表（CommandMenu 风格） |
| 字符计数 | 无 | 右键 12px text-weaker |
| 发送按钮 | 文字按钮 | 圆形 icon 按钮 + hover 品牌色 |
| 快捷键提示 | 无 | 右下角 `Enter ↵` badge |

#### 2.8 DiffViewer — 对齐 GitHub 风格（1.5 天）

| 项目 | 现状 | 目标 |
|------|------|------|
| 文件列表 | 无 | 左侧文件树 + 变更图标（A/M/D） |
| 行号 | 无 | 左右两侧行号 |
| 语法高亮 | 无 | Shiki diff 高亮 |
| +/- 符号 | 无背景色 | 完整行背景色（浅绿/浅红） |
| 折叠 | 无 | 大文件默认折叠，点击展开 |

#### 2.9 StatusBar + 全局细节（1.5 天）

| 项目 | 现状 | 目标 |
|------|------|------|
| StatusBar | 36px 纯色条 | 左侧 Runner 状态 / 右侧项目路径 + 分隔线 |
| Tooltip | 无 | 全局 Tooltip 组件（hover 0.3s 延迟出现） |
| Toast | 基础 | 4 种 variant（success/error/warning/info）+ 图标 + 自动消失 |
| 键盘快捷键 | 隐藏 | `?` 按钮打开快捷键面板 |

---

### 第三轮：体验闭环（4 天）

#### 2.10 空状态系统

OpenCode 每个空白页面都有完整的空状态。AgentHub 当前全空白。

```tsx
// 四件套空状态模板 — 每个 view 都要有
function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-24 animate-fade-in">
      <Icon name={icon} size={48} className="text-text-weaker" />
      <div className="flex flex-col items-center gap-2">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-sm text-text-weak max-w-md text-center">{description}</p>
      </div>
      {action && <Button variant="primary">{action.label}</Button>}
    </div>
  );
}
```

场景覆盖：
- 没有 Thread 时："创建第一个对话"
- 没有 Agent 时："添加 Agent 开始协作"
- 没有搜索结果："换个关键词试试"
- 没有 Diff 文件时："Agent 生成的代码变更将显示在这里"

#### 2.11 Loading 态系统

| 场景 | 实现 |
|------|------|
| 全页加载 | Skeleton 骨架屏（已有组件，补全变体） |
| 消息流式输出 | 2px 品牌色进度条（`animate-progress`） |
| 按钮提交 | spinner + disabled + "发送中..." 文字 |
| 列表刷新 | 下拉刷新指示器 |
| Agent 思考中 | 三个点跳动动画 |

#### 2.12 微交互收尾

```css
/* 按钮 press 反馈 */
button:active { transform: scale(0.97); }

/* 卡片 hover 提升 */
.card:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); }

/* 链接 underline 动画 */
a { text-decoration: underline 1px transparent; transition: text-decoration-color 150ms; }
a:hover { text-decoration-color: currentColor; }

/* checkbox/radio 选中动画 */
input[type="checkbox"]:checked { animation: check-pop 150ms var(--ease-emphasized); }
```

---

## 3. 实施策略

### 3.1 立即切换：Tailwind utility class 优先

AgentHub 的 `app/desktop` 已通过 shadcn/ui 引入 Tailwind。**从现在开始，新 UI 代码一律用 Tailwind utility class，停止新增 CSS Module 文件。** 老 CSS Module 逐步在修改时替换。

对比效率：

```
/* CSS Module 方式（当前） */
.my-button { padding: 8px 16px; border-radius: 6px; background: var(--primary); color: var(--primary-foreground); font-size: 14px; font-weight: 500; transition: all 150ms; }
.my-button:hover { opacity: 0.9; }

/* Tailwind utility class（目标） */
<button className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium transition-all duration-150 hover:opacity-90">
```

### 3.2 分组件推进，不搞大重写

| 轮次 | 范围 | 天数 | 验收标准 |
|:---:|------|:--:|------|
| 1 | tokens.css + themes.css + 全局动画 | 5d | 所有组件自动获得新 token 和过渡效果 |
| 2 | ChatView → ThreadPanel → PromptInput → DiffViewer → StatusBar | 9d | 逐个组件截图对比 OpenCode |
| 3 | 空状态 + Loading + 微交互 | 4d | 所有场景无空白/无闪烁 |

### 3.3 持续对比 OpenCode

在 `reference/opencode/` 已有完整源码。每次改一个组件前，先 `npm run dev:desktop` 启动 OpenCode 看它是怎么做的，再回来写 React 版。

---

## 4. 不改的项

| 项 | 理由 |
|------|------|
| SolidJS → React | AgentHub 技术栈不变 |
| Tailwind → CSS Module | 停止新增 CSS Module，但不强制重写已有 |
| Electron → Tauri | Tauri 2 已选定，不换 |
| 185 个组件全部搬运 | 按需采用，shadcn/ui 已有基础组件 |
| ghostty-web 终端嵌入 | 当前不需要内置终端 |
| `@thisbeyond/solid-dnd` 拖拽 | React 生态用 `@dnd-kit/core` |

---

## 5. 总结

AgentHub 的 UI 基础不差——OKLCH 色彩系统、WCAG 2.2 AA 无障碍、3 字号规则、CSS 变量架构都是对的。差的是"最后 10%"：没有足够的字号梯度来制造信息层次、没有微交互来反馈操作、没有空状态来引导用户、没有全局一致的过渡效果。

这 18 天的计划不引入新框架、不重写架构，只升级设计基础设施然后逐个组件打磨。做完后 AgentHub 的 UI 品质可以对标 OpenCode，同时保持 React+Tauri 的技术栈优势。

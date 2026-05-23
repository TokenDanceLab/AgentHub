# AgentHub 微交互设计规格

> 跨参考: kanna.md（打字动画、排空指示器）、claude-code-webui.md（UnifiedMessageProcessor 双模流式）、design-desktop-ux.md（渐进式展开 4 层、动画曲线）、deep-dive-librechat-message-tree.md（SSE 流式、memo 策略）
> 日期: 2026-05-21 | 状态: 草稿 v1.0

---

## 1. 流式文本动画（打字机效果）

### 1.1 来源分析

| 项目 | 策略 | 粒度 | 光标 |
|---------|----------|-------------|--------|
| Kanna | `useEmptyStateTyping` 逐字渲染 | 字符级 | 闪烁 `|` |
| claude-code-webui | UnifiedMessageProcessor：首个片段创建消息，后续 `updateLastMessage(content+delta)` | Chunk 级（SDK message） | 无 |
| LibreChat | SSE `unfinished: true`，每个事件重新渲染 | Chunk 级 | 无 |
| **AgentHub** | 自适应双模 | <50 字符 → 逐字符；>=50 → 整块 | `▍` 闪烁，完成后 200ms 移除 |

### 1.2 规格

```
状态机: IDLE → STREAMING_START → STREAMING → STREAMING_DONE → IDLE

规则:
  - 首个 chunk < 50 字符：每字符 30ms 间隔（打字机感觉，常见于思考阶段）
  - 后续 chunk >= 50 字符：立即追加（对快速输出不人为减速）
  - 光标：`▍` Unicode 块，CSS `animation: blink 1s step-end infinite`，强调色
  - 16ms 防抖（Kanna 模式）：将多个流事件合并为单次 React 渲染
  - 光标移除：STREAMING_DONE 后 200ms 宽限期
```

```css
.streaming-cursor::after { content: '▍'; animation: cursor-blink 1s step-end infinite; }
@keyframes cursor-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
```

---

## 2. Thinking Block 加载动画

### 2.1 来源分析

| 项目 | Thinking 显示 | 加载 |
|---------|-----------------|---------|
| Kanna | 无分离 | 排空中旋转器 |
| claude-code-webui | `processSystemMessage` init/non-init | 无 |
| **AgentHub** | L1 渐进式展开，默认折叠 | 脉冲圆点 + 已用时间计数器 |

### 2.2 规格

```
状态: THINKING_ACTIVE → THINKING_DONE → THINKING_EXPANDED

THINKING_ACTIVE（流式）:
  - 切换: "Thinking... (3.2s)" — 真实已用时间，每 1s 更新
  - 三点脉冲：300ms 错开，强调色
    @keyframes thinking-dot {
      0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
      30% { opacity: 1; transform: translateY(-2px); }
    }

展开: max-height 0→12rem，200ms ease-out；内容 opacity 0→1，150ms，延迟 50ms
折叠: max-height 12rem→0，150ms ease-in；opacity 1→0，100ms
THINKING_DONE → 展开：切换文本 "Thinking (collapsed)" → "Thinking (expanded)"
```

---

## 3. 工具调用进度指示器

### 3.1 来源分析

| 项目 | 运行中状态 | 结果 |
|---------|--------------|--------|
| Kanna | turn 后排空指示器 | 内联打字结果 |
| claude-code-webui | 无显式运行中指示器 | `tool_result` 在调用下方 |
| **AgentHub** | 旋转图标 + 已用时间计数器 | 带状态徽章的滑下效果 |

### 3.2 规格

```
状态: TOOL_PENDING → TOOL_RUNNING → TOOL_DONE → TOOL_EXPANDED / TOOL_COLLAPSED

TOOL_RUNNING:
  - 旋转器：SVG animateTransform rotate，1s linear infinite
  - 已用时间："Running... (1.5s)" 每 500ms 更新
  - 颜色：琥珀色-警告

TOOL_RUNNING → TOOL_DONE:
  - 旋转器 → 状态图标：100ms 交叉淡入淡出
  - 左边框：琥珀色 → 绿色/红色，300ms ease
  - 已用时间 → 最终耗时：即时替换

展开（L2）：ToolParams max-height 0→16rem，200ms ease-out；然后 ToolResult 渲染
折叠：ToolResult 卸载；max-height 16rem→0，150ms ease-in
```

### 3.3 结果状态徽章

| 状态 | 图标 | 颜色 | 文本 |
|--------|------|-------|------|
| Success | CheckCircle | 绿色 | "Done (1.2s)" |
| Error | XCircle | 红色 | "Failed (exit 1)" |
| Denied | ShieldOff | 琥珀色 | "Denied" |
| Timeout | Clock | 红色 | "Timeout (30s)" |

---

## 4. AgentRun 状态切换动画

### 4.1 切换映射

```
idle → queued → starting → running → completed → idle
                          ├── awaiting_approval → running
                          ├── failed → idle
                          └── cancelled → idle
```

### 4.2 切换规格

| 切换 | 动画 | 持续时间 |
|------------|-----------|----------|
| idle → queued | SendButton → StopButton 交叉淡入淡出；带 "sending..." 徽章的乐观消息 | 100ms |
| queued → starting | 徽章：灰色 → 蓝色，颜色过渡 | 200ms |
| starting → running | RunIndicator 旋转器淡入；徽章绿色脉冲（2s infinite） | 150ms |
| running → completed | 旋转器 → 绿色勾交叉淡入淡出；徽章淡出 | 200ms + 3s 保持 + 500ms 淡出 |
| running → failed | 旋转器 → 红色 X 交叉淡入淡出；错误滑下；徽章保持 | 200ms + 200ms 滑入 |
| running → cancelled | 旋转器 → 灰色方形交叉淡入淡出；徽章 3s 后淡出 | 150ms |
| running → awaiting_approval | ApprovalCard 从顶部滑入；徽章琥珀色脉冲 | 200ms |

### 4.3 RunIndicator CSS

```css
.run-indicator { width: 8px; height: 8px; border-radius: 50%; background: var(--color-accent); }
.run-indicator--running { animation: run-pulse 1.5s ease-in-out infinite; }
.run-indicator--awaiting { animation: run-pulse 2s ease-in-out infinite; background: var(--color-warning); }
@keyframes run-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.85); }
}
```

### 4.4 排空指示器（Kanna 模式）

```
触发：turn 结果已到达但流中仍有待处理事件
UI：顶部细琥珀色条，"Finishing up..." + 脉冲圆点；"Stop Draining" 按钮可见
所有待处理事件处理完毕后自动解决 → idle
强制停止 → cancelled

滑入：translateY(-100%) → 0，150ms ease-out
滑出：0 → translateY(-100%)，150ms ease-in
```

---

## 5. DiffCard 微交互

| 切换 | 动画 | 持续时间 | 缓动 |
|------------|-----------|----------|--------|
| IDLE → VIEWING | 从底部滑入 | 200ms | ease-out |
| VIEWING → APPLYING | [Apply] → 旋转器交叉淡入淡出 | 150ms | ease |
| APPLYING → APPLIED | 旋转器 → 绿色勾 + 徽章 | 200ms | ease-out |
| APPLYING → APPLY_FAILED | 旋转器 → 红色 X + [Retry] | 200ms | ease-out |
| VIEWING → DISCARDED | Opacity 1 → 0.4，灰色边框 | 200ms | ease-in |

**撤销窗口**：0-4500ms 倒计时标签 "Undo (N s)"，5000ms 按钮消失 + 边框变灰，5300ms opacity 渐变为 0.7。窗口期内点击：立即还原（无动画）。

---

## 6. 动画设计系统

### 6.1 持续时间 Token

| Token | ms | 用途 |
|-------|-----|-------|
| `instant` | 0 | 文本替换、光标隐藏 |
| `fast` | 100 | 交叉淡入淡出、按钮替换 |
| `normal` | 150 | 标准 UI 过渡、徽章颜色 |
| `medium` | 200 | 内容出现（工具滑入、diff 卡片、状态）、布局调整 |
| `slow` | 300 | 强调（thinking 展开、错误、边框颜色变化） |
| `glacial` | 500 | 延迟消失（RunIndicator 淡出） |

### 6.2 缓动曲线（Material Design 3）

| Token | CSS cubic-bezier | 用途 |
|-------|-----------------|-------|
| `ease-out` | `(0, 0, 0.2, 1)` | 入场（展开、出现、滑入） |
| `ease-in` | `(0.4, 0, 1, 1)` | 退场（折叠、消失、淡出） |
| `ease-standard` | `(0.4, 0, 0.2, 1)` | 状态变化（颜色、交叉淡入淡出、调整大小） |
| `ease-emphasized` | `(0.05, 0.7, 0.1, 1)` | 吸引注意力（错误、审批） |

### 6.3 布局过渡目录

| 元素 | 属性 | 持续时间 | 缓动 |
|---------|----------|----------|--------|
| Sidebar 折叠（280→48px） | `width` | 200ms | ease-standard |
| RightPanel 打开/关闭 | `width` + `opacity` | 200ms | ease-standard |
| 消息出现（流式） | `opacity` + `translateY(8px→0)` | 150ms | ease-out |
| JumpToBottomButton | `opacity` + `scale(0.8→1)` | 150ms | ease-out |
| Toast 进入/退出 | `translateY` + `opacity` | 200ms | ease-out / ease-in |
| Modal 背景 | `opacity` 0→1 | 150ms | ease-out |
| Drawer（移动端） | `translateX(-100%→0)` | 150ms | ease-out |
| Bottom Sheet（移动端） | `translateY(100%→0)` | 200ms | ease-out |
| ApprovalCard | `max-height` + `opacity` | 200ms | ease-out |

### 6.4 流式过程中自动滚动

```
1. 用户向上滚动 > 100px → 不自动滚动；显示 JumpToBottomButton（淡入 150ms）
2. 用户在底部 100px 内 → 平滑自动滚动（scroll-behavior: smooth）
3. streaming_done 时 → 如果已接近底部则最终滚动到底；如果已向上滚动则保持位置
4. JumpToBottomButton 点击 → 即时滚动（跳过平滑）

实现：在列表底部的 1px 哨兵 div 上使用 IntersectionObserver
```

### 6.5 性能保障

| 规则 | 原因 |
|------|-----|
| 使用已知上限的 `max-height`，永不用 `height: auto` | CSS 无法过渡到/从 auto |
| 仅动画化 `transform` + `opacity` | GPU 合成，零布局抖动 |
| 仅在活跃动画期间使用 `will-change` | 持久提升导致内存膨胀 |
| 流式渲染 16ms 防抖（Kanna） | 60fps，合并 SSE 事件 |
| MessageBubble 上字段级 memo 对比器（LibreChat） | 防止单消息 delta 导致全树重新渲染 |
| 流式消息容器无 React `key`（LibreChat） | 流式原地变更；key 导致卸载/重挂载闪烁 |
| 消息列表使用 `@tanstack/react-virtual` | 仅渲染可见 + 3 个 overscan |

---

## 7. Design Token 摘要

```ts
// src/styles/tokens.ts
export const animation = {
  duration: { instant: 0, fast: 100, normal: 150, medium: 200, slow: 300, glacial: 500 },
  easing: {
    out: 'cubic-bezier(0, 0, 0.2, 1)',
    in: 'cubic-bezier(0.4, 0, 1, 1)',
    standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
    emphasized: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
  },
  streaming: {
    typewriterThreshold: 50,      // 字符数：低于 → 逐字符，高于 → 整块
    typewriterInterval: 30,       // 每字符毫秒数
    debounceWindow: 16,           // ms（Kanna 批处理）
    cursorBlinkInterval: 1000,    // ms step-end
    cursorRemovalDelay: 200,      // streaming_done 后的 ms
  },
  thinking: {
    dotStaggerDelay: 300,         // 每点 ms
    elapsedUpdateInterval: 1000,  // ms
    expandDuration: 200,          // ms max-height
    collapseDuration: 150,        // ms
    contentFadeIn: 150,           // ms opacity
  },
  toolCall: {
    elapsedUpdateInterval: 500,   // ms
    statusCrossfade: 100,         // ms 旋转器→图标
    borderColorTransition: 300,   // ms 琥珀色→绿色/红色
    expandDuration: 200,          // ms 滑下
    collapseDuration: 150,        // ms 滑上
  },
  undoWindow: 5000,               // ms
};
```

---

## 8. 参考资料

- `kanna.md` -- 排空指示器、空状态打字、16ms 防抖广播
- `claude-code-webui.md` -- UnifiedMessageProcessor 双模、NDJSON 流式、权限 UI
- `design-desktop-ux.md` -- 渐进式展开 L0-L4、DiffCard 状态机、移动端 150ms 过渡
- `deep-dive-librechat-message-tree.md` -- SSE 流式、SiblingSwitch、自定义 memo 对比器、无 React key

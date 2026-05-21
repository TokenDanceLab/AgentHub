# AgentHub Markdown/代码渲染 -- 跨仓库对比与建议

> 日期: 2026-05-21 | 来源: LibreChat、Claude Code Viewer、AgentHub Desktop UX Spec

## 1. 对比矩阵

| 维度 | LibreChat | Claude Code Viewer |
|-----------|-----------|-------------------|
| **Markdown 解析器** | `react-markdown` v9 + 8 个 remark/rehype 插件 | `react-markdown` v10 + `remark-gfm` |
| **代码高亮** | `rehype-highlight`（highlight.js，~35 语言）+ 流式场景 lazy `lowlight` | `react-syntax-highlighter`（Prism-light，15 语言） |
| **Mermaid** | 完整集成：mermaid v11 + react-zoom-pan-pinch + DOMPurify SVG 消毒 + 对比度修复 | 未内置（依赖 Claude Code 自身的工具渲染） |
| **LaTeX 数学** | `remark-math` + `rehype-katex` + `preprocessLaTeX`（在 remark 前转义 `\(`/`\[`） | 无 |
| **流式策略** | 完整 `react-markdown` 重新渲染 + 自定义 `areMessageRenderPropsEqual` memo 对比器 + 流式消息无 React key | N/A（静态 JSONL 查看器） |
| **服务端导出** | `marked@15` CDN + 内联 GitHub-CSS + 链接/图片的 `isSafeUrl()` 白名单 | 自定义正则 Markdown 到 HTML（简单，基于 escapeHtml） |
| **打包优化** | `langSubset` 35 语言白名单；`lowlight` 动态 import | 手动 Vite chunk-split：`syntax-highlighter-vendor` / `prismjs-vendor` / `refractor-vendor` / `markdown-parser-vendor` |
| **主题** | GitHub 风格 CSS，使用 `prefers-color-scheme` 媒体查询 | 通过 react-syntax-highlighter 样式的 `oneDark` / `oneLight` |

## 2. Markdown 解析：react-markdown vs marked

两个项目都收敛于 `react-markdown` 用于交互式渲染。统一的 unified 管线：

```
content → remark-parse → [remark 插件] → remark-rehype → [rehype 插件] → rehype-react → React 元素
```

### LibreChat 管线（丰富，8 个插件）

```
content → preprocessLaTeX() → react-markdown
  remark: supersub → gfm → directive → artifactPlugin → math → unicodeCitation → mcpUIResourcePlugin
  rehype: katex → highlight（highlight.js，子集：35 语言）
  components: Artifact、Citation、MCPUIResource、自定义 code/a/p/img
```

### Claude Code Viewer 管线（精简，1 个插件）

```
content → react-markdown
  remark: gfm
  rehype: （无 — 代码通过自定义组件处理）
  components: h1-h6、p、ul/ol/li、code/pre、blockquote、a、table、hr、strong、em
```

### marked（仅 LibreChat 服务端导出）

LibreChat 的 `markdown.ts` 使用 `marked@15.0.12` 通过 CDN 生成自包含 HTML 导出，配置 `gfm: true, breaks: true`，使用 `isSafeUrl()` URL 白名单和 `html() { return ''; }` 阻止原始 HTML 注入。比 unified 更适合非 React 上下文。

### AgentHub 建议

| 用例 | 库 | 理由 |
|----------|---------|-----------|
| 聊天消息渲染 | `react-markdown` v10+ | 生态标准，两个参考项目均收敛于此 |
| Remark 插件 | `remark-gfm` + `remark-math` | GFM 表格/删除线/任务列表；数学用于 agent 输出 |
| Rehype 插件 | `rehype-katex`（仅数学） | 代码块单独处理；保持 rehype 表面积小 |
| HTML 导出 | `marked` v15 | 比 unified 更适合静态 HTML 生成 |

## 3. 代码语法高亮：三种方案

### LibreChat：rehype-highlight + lowlight（highlight.js）

`rehype-highlight` 在 remark->rehype 管线中转换代码块，生成 `<code class="hljs language-python">` HTML。使用 `langSubset`（35 语言）配合 `{ detect: true, ignoreMissing: true }`。并行 `useLazyHighlight` hook 动态导入 `lowlight`，在 rehype-highlight 输出不足时（流式、工具结果）进行编程式高亮。

权衡：两条代码路径（rehype 插件用于静态，lowlight 用于动态）。代码块被锁定为原始 HTML，非 React 组件。

### Claude Code Viewer：react-syntax-highlighter（Prism）

使用 `react-syntax-highlighter/dist/esm/prism-light`，显式注册 15 种语言和别名（`sh`->bash、`js`->javascript 等）。主题：`oneDark`/`oneLight`。自定义 `CodeBlock` 组件，带复制按钮和语言标题。

权衡：手动语言注册。`prism-light` tree-shake 效果优于 highlight.js，但仍有 JS 运行时成本。

### 第三方案：Shiki（AgentHub 推荐）

两个项目都未使用 Shiki，但它解决了它们各自的弱点：

| | highlight.js | Prism.js | **Shiki** |
|---|-------------|----------|-----------|
| 语法来源 | JS 正则 | JS 正则 | TextMate（VS Code 品质） |
| 浏览器 JS 成本 | ~50KB 子集 | ~30KB light | **~0KB**（服务端/构建预渲染） |
| 双主题 | 通过 CSS 变量 | `oneDark`/`oneLight` | 原生 `dualTheme` |
| 流式友好度 | 需要后处理 | 需要后处理 | Token 数组，适合增量 |
| 语言覆盖 | 190+（可选择子集） | ~300（手动注册） | ~200（自动检测） |

**建议**：P1 使用 Shiki，P0 回退方案为 `react-syntax-highlighter`（Prism-light，CCV 模式），如果 WASM/打包复杂性是顾虑的话。

AgentHub 的 Shiki 集成方案：
- **服务端/构建预渲染**：`shiki` 在 Go 后端或构建步骤运行，生成静态 HTML `<span class="..." style="...">` token。浏览器接收预高亮 HTML，零 JS 成本。
- **客户端回退**：`@shikijs/engine-javascript`（无 WASM）或 `shikiji`，在服务端预渲染不可用时（离线/PWA）进行纯 JS 高亮。
- **流式**：流式过程中，代码块渲染为纯 `<pre><code>`。当闭合 fence 到达且 `isStreaming` 翻转为 `false`，完成的代码块发送到 Shiki（服务端或客户端）并替换。
- **双主题**：Shiki 的 `dualTheme` 映射到 AgentHub 的暗/亮系统。CSS 变量用于主题颜色，无需 JS 主题切换。

## 4. 流式 Markdown 渲染

### 问题

WebSocket delta 以 20-60 chunk/秒的速度到达。渲染器必须处理 chunk 边界处的不完整语法（写到一半的代码 fence、未闭合的数学表达式）。

### LibreChat 方案：完全重新渲染 + 激进 memo

**相同的** `react-markdown` 组件同时用于流式和静态消息。每次内容变更触发完全重新解析和重新渲染。这之所以可行是因为：

1. **自定义 memo 对比器**（`areMessageRenderPropsEqual`）：~15 个字段比较；仅在 `text`、`error`、`unfinished` 或 `content` 实际变化时重新渲染。
2. **流式消息无 React key**：LibreChat 故意从 `MultiMessage` 省略 key，因为 `messageId` 在流式过程中会变化（客户端 UUID -> 服务端 ID），这会卸载/重新挂载整个子树。
3. **解析成本可忽略**：`react-markdown` 解析 <50KB 耗时 <1ms；瓶颈是 DOM 协调，而非解析。

### 代码块流式优化

LibreChat 的 `useLazyHighlight` 和 `CodeBlock` 通过渲染纯 `<code>` 而不进行高亮来处理流式过程中的不完整代码块。仅在消息标记为 `!unfinished` 时才应用完整语法高亮。

### AgentHub 建议

**P0**：完全重新渲染 + 自定义 memo，复制 LibreChat 的成熟模式：

```tsx
const MessageBubble = memo(
  ({ message }: { message: Message }) => (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}
      components={markdownComponents}>
      {message.text}
    </ReactMarkdown>
  ),
  (prev, next) =>
    prev.message.id === next.message.id &&
    prev.message.text === next.message.text &&
    prev.message.isStreaming === next.message.isStreaming
);
```

| 优先级 | 方案 | 细节 |
|----------|----------|--------|
| **P1** | 节流到 20fps | 在缓冲区中累积 WS chunk，按 `requestAnimationFrame` 对齐批次刷新 |
| **P2** | Shiki 流式 | 不完整代码块为纯 `<pre>`，块完成时替换为 Shiki 渲染的 HTML |
| **P2** | `useDeferredValue` | 对于 >100KB 的消息，在流式过程中保持滚动响应 |

## 5. Mermaid 图渲染

### LibreChat 的实现（参考模式）

```
Mermaid 代码块 → MarkdownComponents 检测到 lang="mermaid"
  → <MermaidErrorBoundary>（捕获解析错误）
    → <Mermaid> 组件
      → useEffect: mermaid.render("mermaid-diagram", content)
      → DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true } })
      → 注入 DOM
```

Artifact 全屏模式使用 `react-zoom-pan-pinch` 配合 `TransformWrapper` + `TransformComponent`、工具栏（放大/缩小、重置、复制代码）和平移边界限制。

**两种 `htmlLabels` 模式**（关键实现细节）：
- 内联：`htmlLabels: false` -- SVG 渲染为 blob URL `<img>`，浏览器在 `<img>` 中阻止 `foreignObject`
- Artifact：`htmlLabels: true` -- SVG 直接注入 DOM，`foreignObject` 可工作

**对比度修复**：`fixSubgraphTitleContrast()` 计算子图背景的 BT.601 亮度，覆盖文本填充以保持在暗/亮主题中的可读性。

### AgentHub 建议

直接使用 LibreChat 的模式：
- `mermaid` v11 + `dompurify` v3 + `react-zoom-pan-pinch`（用于 RightPanel Preview 标签页全屏）
- 在首个 `lang="mermaid"` 代码块时懒加载 `mermaid`
- `MermaidErrorBoundary` 捕获无效语法，显示原始代码带错误徽章
- 安全：`securityLevel: 'strict'` + DOMPurify SVG profile

## 6. AgentHub NPM 依赖

### 生产依赖

```json
{
  "react-markdown": "^10.1.0",
  "remark-gfm": "^4.0.1",
  "remark-math": "^6.0.0",
  "rehype-katex": "^6.0.3",
  "katex": "^0.16.x",
  "mermaid": "^11.x",
  "dompurify": "^3.x",
  "shiki": "^1.x",
  "marked": "^15.x"
}
```

### 体积预算（gzip）

| 包 | 体积 | 加载策略 |
|---------|------|---------------|
| `react-markdown` v10 + `remark-gfm` v4 + `remark-math` v6 | ~25KB | 关键路径（首屏渲染） |
| `katex` v0.16 + `rehype-katex` v6 | ~280KB | 懒加载（idle callback 后动态 import） |
| `mermaid` v11 | ~1.5MB | 懒加载（首个 `lang="mermaid"` 代码块时动态 import） |
| `shiki` v1 | ~0KB JS | 服务端/构建预渲染；零浏览器成本 |
| `marked` v15 | ~20KB | 仅服务端（不在浏览器打包中） |
| `dompurify` v3 | ~10KB | 关键路径（Mermaid SVG 消毒需要） |

**参考版本说明**：LibreChat 使用 `react-markdown@^9.0.1`、`rehype-highlight@^6.0.0`、`remark-gfm@^4.0.0`、`mermaid@^11.15.0`。Claude Code Viewer 使用 `react-markdown@10.1.0`、`react-syntax-highlighter@16.1.1`、`remark-gfm@4.1.0`。两者均在当前主版本上；AgentHub 应从最新版开始。

### 不引入的包

| 跳过 | 原因 |
|------|-----|
| `react-syntax-highlighter` | Shiki 替代；零 JS 运行时 vs 30KB+ Prism 打包 |
| `rehype-highlight` / `lowlight` | Shiki 避免双代码路径（rehype 插件 + lazy highlight） |
| `remark-directive` | 仅自定义 `:artifact[...]` 块语法需要；推迟到 P1 |
| `remark-supersub` | 小众（^^上标^^ / ~~下标~~）；按需添加 |
| `rehype-raw` | 安全风险（原始 HTML 透传）；不可避免时使用 DOMPurify |

## 7. 组件架构

```
MessageBubble
  ├── ThinkingBlock（折叠、变暗的 Markdown）
  ├── MessageText
  │   └── <ReactMarkdown remarkPlugins={[gfm, math]} rehypePlugins={[katex]}
  │         components={{
  │           code → CodeBlockRouter
  │             ├── inline → 样式化 <code>
  │             ├── lang="mermaid" → MermaidDiagram（懒加载）
  │             └── block → CodeBlock（Shiki HTML，isStreaming→纯 <pre>）
  │           a → SafeLink、img → SafeImage、pre → PreWrapper、table → ScrollableTable
  │         }} />
  ├── ToolUseCard（折叠：标题始终可见；参数/结果展开）
  └── SiblingSwitch（仅在 siblingCount > 1 时可见）
```

## 8. 性能优化策略

| 技术 | 时机 | 原因 |
|-----------|------|-----|
| 自定义 `memo` 对比器 | 始终 | 字段级对比防止未变化消息重新渲染 |
| 节流到 20fps | 流式 | 将渲染从 60/s 降到 20/s；延迟不可感知 |
| `useDeferredValue` | 消息 >100KB | 在大消息流式过程中保持滚动响应 |
| 纯文本代码块 | 流式过程中 | 在不完整代码上跳过 Shiki/Prism |
| 虚拟列表（`@tanstack/react-virtual`） | 长会话 | 仅挂载可见消息 |
| 手动 Vite chunks | 构建 | 分离 `katex-vendor`、`mermaid-vendor`、`markdown-vendor` |

## 9. 总结：最终建议

| 决策 | 选择 | 理由 |
|----------|--------|-----------|
| Markdown 解析器 | `react-markdown` v10 | 两个参考项目均收敛于此 |
| GFM | `remark-gfm` | 表格、删除线、任务列表 — 用户期望 |
| 数学 | `remark-math` + `rehype-katex` + `katex` | LibreChat 模式；懒加载 katex |
| 代码高亮 | **Shiki**（服务端/构建） | 零 JS、最佳品质、流式友好；回退 Prism-light |
| Mermaid | `mermaid` v11 + `dompurify` | LibreChat 模式；首个图懒加载 |
| 流式 | 完全重新渲染 + memo + 节流 | 最简单，在 LibreChat 已验证 |
| HTML 导出 | `marked` v15 | 比 unified 更适合静态输出 |
| 主题 | Tailwind CSS 变量（暗/亮） | 两个项目均使用此方案 |
| 打包拆分 | 手动 Vite chunks | 分离并懒加载 katex、mermaid、markdown-parser |

**应避免的关键反模式**：
1. `rehype-highlight` + `lowlight` 双路径（LibreChat）-- Shiki 更简单
2. `highlight.js` 优于 Prism/Shiki -- tree-shake 更差，语法品质更低
3. `rehype-raw` 用于 HTML 透传 -- 安全风险；不可避免时使用 DOMPurify
4. 单体 mermaid import -- 始终在首个图遇到时懒加载

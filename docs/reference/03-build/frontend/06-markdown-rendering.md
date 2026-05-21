# AgentHub Markdown/Code Rendering -- Cross-Repository Comparison & Recommendation

> Date: 2026-05-21 | Sources: LibreChat, Claude Code Viewer, AgentHub Desktop UX Spec

## 1. Comparison Matrix

| Dimension | LibreChat | Claude Code Viewer |
|-----------|-----------|-------------------|
| **Markdown parser** | `react-markdown` v9 + 8 remark/rehype plugins | `react-markdown` v10 + `remark-gfm` |
| **Code highlighting** | `rehype-highlight` (highlight.js, ~35 langs) + lazy `lowlight` for streaming | `react-syntax-highlighter` (Prism-light, 15 langs) |
| **Mermaid** | Full integration: mermaid v11 + react-zoom-pan-pinch + DOMPurify SVG sanitize + contrast fix | Not built-in (relies on Claude Code's own tool rendering) |
| **LaTeX math** | `remark-math` + `rehype-katex` + `preprocessLaTeX` (escapes `\(`/`\[` before remark) | None |
| **Streaming strategy** | Full `react-markdown` re-render + custom `areMessageRenderPropsEqual` memo comparator + no React key on streaming messages | N/A (static JSONL viewer) |
| **Server-side export** | `marked@15` CDN + inline GitHub-CSS + `isSafeUrl()` allow-list for links/images | Custom regex-based Markdown-to-HTML (simple, escapeHtml-based) |
| **Bundle optimization** | `langSubset` 35-language allowlist; `lowlight` dynamic import | Manual Vite chunk-split: `syntax-highlighter-vendor` / `prismjs-vendor` / `refractor-vendor` / `markdown-parser-vendor` |
| **Theme** | GitHub-flavored CSS with `prefers-color-scheme` media queries | `oneDark` / `oneLight` via react-syntax-highlighter styles |

## 2. Markdown Parsing: react-markdown vs marked

Both projects converge on `react-markdown` for interactive rendering. The unified pipeline:

```
content → remark-parse → [remark plugins] → remark-rehype → [rehype plugins] → rehype-react → React elements
```

### LibreChat pipeline (rich, 8 plugins)

```
content → preprocessLaTeX() → react-markdown
  remark: supersub → gfm → directive → artifactPlugin → math → unicodeCitation → mcpUIResourcePlugin
  rehype: katex → highlight (highlight.js, subset: 35 langs)
  components: Artifact, Citation, MCPUIResource, custom code/a/p/img
```

### Claude Code Viewer pipeline (lean, 1 plugin)

```
content → react-markdown
  remark: gfm
  rehype: (none — code handled via custom component)
  components: h1-h6, p, ul/ol/li, code/pre, blockquote, a, table, hr, strong, em
```

### marked (LibreChat server-side export only)

LibreChat's `markdown.ts` generates self-contained HTML exports using `marked@15.0.12` via CDN with `gfm: true, breaks: true`, an `isSafeUrl()` URL allow-list, and `html() { return ''; }` to block raw HTML injection. Simpler than unified for non-React contexts.

### AgentHub recommendation

| Use case | Library | Rationale |
|----------|---------|-----------|
| Chat message rendering | `react-markdown` v10+ | Ecosystem standard, both references converge here |
| Remark plugins | `remark-gfm` + `remark-math` | GFM tables/strikethrough/task-lists; math for agent outputs |
| Rehype plugins | `rehype-katex` (math only) | Code blocks handled separately; keep rehype surface area small |
| HTML export | `marked` v15 | Lighter than unified for static HTML generation |

## 3. Code Syntax Highlighting: Three Approaches

### LibreChat: rehype-highlight + lowlight (highlight.js)

`rehype-highlight` transforms code blocks during the remark->rehype pipeline, producing `<code class="hljs language-python">` HTML. Uses `langSubset` (35 languages) with `{ detect: true, ignoreMissing: true }`. A parallel `useLazyHighlight` hook dynamically imports `lowlight` for programmatic highlighting when rehype-highlight output is insufficient (streaming, tool results).

Trade-off: Two code paths (rehype plugin for static, lowlight for dynamic). Code blocks are locked as raw HTML, not React components.

### Claude Code Viewer: react-syntax-highlighter (Prism)

Uses `react-syntax-highlighter/dist/esm/prism-light` with 15 explicitly registered languages and aliases (`sh`->bash, `js`->javascript, etc.). Themes: `oneDark`/`oneLight`. Custom `CodeBlock` component with copy button and language header.

Trade-off: Manual language registration. `prism-light` tree-shakes better than highlight.js but is still a JS runtime cost.

### Third option: Shiki (recommended for AgentHub)

Neither project uses Shiki, but it addresses their respective weaknesses:

| | highlight.js | Prism.js | **Shiki** |
|---|-------------|----------|-----------|
| Grammar source | JS regex | JS regex | TextMate (VS Code quality) |
| Browser JS cost | ~50KB subset | ~30KB light | **~0KB** (server/build pre-render) |
| Dual theme | Via CSS vars | `oneDark`/`oneLight` | Native `dualTheme` |
| Streaming friendliness | Post-processing needed | Post-processing needed | Token arrays, incremental-friendly |
| Language coverage | 190+ (subset selectable) | ~300 (manual registration) | ~200 (auto-detected) |

**Recommendation**: Shiki for P1, with `react-syntax-highlighter` (Prism-light, CCV pattern) as P0 fallback if WASM/bundle complexity is a concern.

Shiki integration approach for AgentHub:
- **Server/build pre-render**: `shiki` runs on the Go backend or build step, produces static HTML `<span class="..." style="...">` tokens. Browser receives pre-highlighted HTML, zero JS cost.
- **Client fallback**: `@shikijs/engine-javascript` (no WASM) or `shikiji` for pure-JS highlighting when server pre-render isn't available (offline/PWA).
- **Streaming**: During streaming, code blocks render as plain `<pre><code>`. When the closing fence arrives and `isStreaming` flips to `false`, the completed code block is sent to Shiki (server or client) and swapped in.
- **Dual theme**: Shiki's `dualTheme` maps to AgentHub's dark/light system. CSS variables for theme colors, no JS theme toggle needed.

## 4. Streaming Markdown Rendering

### The problem

WebSocket deltas arrive at 20-60 chunks/second. The renderer must handle incomplete syntax at chunk boundaries (half-written code fences, unclosed math expressions).

### LibreChat's approach: Full re-render + aggressive memo

The **same** `react-markdown` component is used for both streaming and static messages. Every content change triggers a full re-parse and re-render. This works because:

1. **Custom memo comparator** (`areMessageRenderPropsEqual`): ~15 field comparisons; only re-renders when `text`, `error`, `unfinished`, or `content` actually change.
2. **No React key on streaming messages**: LibreChat deliberately omits keys from `MultiMessage` because `messageId` changes mid-stream (client UUID -> server ID), which would unmount/remount the entire subtree.
3. **Parse cost is negligible**: `react-markdown` parses <50KB in <1ms; the bottleneck is DOM reconciliation, not parsing.

### Code block streaming optimization

LibreChat's `useLazyHighlight` and `CodeBlock` handle incomplete code blocks during streaming by rendering plain `<code>` without highlighting. Full syntax highlighting is applied only when the message is marked `!unfinished`.

### AgentHub recommendation

**P0**: Full re-render + custom memo, copying LibreChat's proven pattern:

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

| Priority | Approach | Detail |
|----------|----------|--------|
| **P1** | Throttle to 20fps | Accumulate WS chunks in buffer, flush `requestAnimationFrame`-aligned batches |
| **P2** | Shiki streaming | Incomplete code blocks as plain `<pre>`, swap to Shiki-rendered HTML when block completes |
| **P2** | `useDeferredValue` | For messages >100KB, keep scroll responsive during streaming |

## 5. Mermaid Diagram Rendering

### LibreChat's implementation (reference pattern)

```
Mermaid code block → MarkdownComponents detects lang="mermaid"
  → <MermaidErrorBoundary> (catches parse errors)
    → <Mermaid> component
      → useEffect: mermaid.render("mermaid-diagram", content)
      → DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true } })
      → inject into DOM
```

Artifact full-screen mode uses `react-zoom-pan-pinch` with `TransformWrapper` + `TransformComponent`, toolbar (zoom in/out, reset, copy code), and pan boundary clamping.

**Two `htmlLabels` modes** (key implementation detail):
- Inline: `htmlLabels: false` — SVG rendered as blob URL `<img>`, browsers block `foreignObject` in `<img>`
- Artifact: `htmlLabels: true` — SVG injected directly into DOM, `foreignObject` works

**Contrast fix**: `fixSubgraphTitleContrast()` calculates BT.601 luminance of subgraph backgrounds and overrides text fill to maintain readability in dark/light themes.

### AgentHub recommendation

Use LibreChat's pattern directly:
- `mermaid` v11 + `dompurify` v3 + `react-zoom-pan-pinch` (for RightPanel Preview tab full-screen)
- Lazy load `mermaid` on first code block with `lang="mermaid"`
- `MermaidErrorBoundary` catches invalid syntax, shows raw code with error badge
- Security: `securityLevel: 'strict'` + DOMPurify SVG profile

## 6. AgentHub NPM Dependencies

### Production dependencies

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

### Size budget (gzip)

| Package | Size | Load strategy |
|---------|------|---------------|
| `react-markdown` v10 + `remark-gfm` v4 + `remark-math` v6 | ~25KB | Critical path (first paint) |
| `katex` v0.16 + `rehype-katex` v6 | ~280KB | Lazy (dynamic import after idle callback) |
| `mermaid` v11 | ~1.5MB | Lazy (dynamic import on first `lang="mermaid"` code block) |
| `shiki` v1 | ~0KB JS | Server/build pre-render; zero browser cost |
| `marked` v15 | ~20KB | Server-only (not in browser bundle) |
| `dompurify` v3 | ~10KB | Critical path (needed for Mermaid SVG sanitize) |

**Version notes from references**: LibreChat uses `react-markdown@^9.0.1`, `rehype-highlight@^6.0.0`, `remark-gfm@^4.0.0`, `mermaid@^11.15.0`. Claude Code Viewer uses `react-markdown@10.1.0`, `react-syntax-highlighter@16.1.1`, `remark-gfm@4.0.1`. Both are on the current major versions; AgentHub should start on the latest.

### What NOT to include

| Skip | Why |
|------|-----|
| `react-syntax-highlighter` | Shiki replaces it; zero JS runtime vs 30KB+ Prism bundle |
| `rehype-highlight` / `lowlight` | Shiki avoids dual code paths (rehype plugin + lazy highlight) |
| `remark-directive` | Only needed for custom `:artifact[...]` block syntax; defer to P1 |
| `remark-supersub` | Niche (^^superscript^^ / ~~subscript~~); add on demand |
| `rehype-raw` | Security risk (raw HTML passthrough); use DOMPurify if unavoidable |

## 7. Component Architecture

```
MessageBubble
  ├── ThinkingBlock (collapsed, dimmed Markdown)
  ├── MessageText
  │   └── <ReactMarkdown remarkPlugins={[gfm, math]} rehypePlugins={[katex]}
  │         components={{
  │           code → CodeBlockRouter
  │             ├── inline → styled <code>
  │             ├── lang="mermaid" → MermaidDiagram (lazy loaded)
  │             └── block → CodeBlock (Shiki HTML, isStreaming→plain <pre>)
  │           a → SafeLink, img → SafeImage, pre → PreWrapper, table → ScrollableTable
  │         }} />
  ├── ToolUseCard (collapsed: header always visible; params/result on expand)
  └── SiblingSwitch (visible only when siblingCount > 1)
```

## 8. Performance Optimization Strategy

| Technique | When | Why |
|-----------|------|-----|
| Custom `memo` comparator | Always | Field-level comparison prevents re-render on unchanged messages |
| Throttle to 20fps | Streaming | Cuts renders from 60/s to 20/s; imperceptible latency |
| `useDeferredValue` | Messages >100KB | Keeps scroll responsive during large message streaming |
| Plain text code blocks | During streaming | Skip Shiki/Prism on incomplete code |
| Virtual list (`@tanstack/react-virtual`) | Long conversations | Only mount visible messages |
| Manual Vite chunks | Build | Separate `katex-vendor`, `mermaid-vendor`, `markdown-vendor` |

## 9. Summary: Final Recommendation

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Markdown parser | `react-markdown` v10 | Both references converge here |
| GFM | `remark-gfm` | Tables, strikethrough, task lists — expected by users |
| Math | `remark-math` + `rehype-katex` + `katex` | LibreChat pattern; lazy load katex |
| Code highlighting | **Shiki** (server/build) | Zero JS, best quality, streaming-friendly; fallback to Prism-light |
| Mermaid | `mermaid` v11 + `dompurify` | LibreChat pattern; lazy load on first diagram |
| Streaming | Full re-render + memo + throttle | Simplest, proven in LibreChat |
| HTML export | `marked` v15 | Lighter than unified for static output |
| Theme | Tailwind CSS variables (dark/light) | Both projects use this approach |
| Bundle splitting | Manual Vite chunks | Separate and lazy-load katex, mermaid, markdown-parser |

**Key anti-patterns to avoid**:
1. `rehype-highlight` + `lowlight` dual path (LibreChat) -- Shiki is simpler
2. `highlight.js` over Prism/Shiki -- tree-shakes worse, grammars lower quality
3. `rehype-raw` for HTML passthrough -- security risk; use DOMPurify if unavoidable
4. Monolithic mermaid import -- always lazy load on first diagram encounter

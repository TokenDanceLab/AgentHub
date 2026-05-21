# AgentHub 主题系统设计

> 跨仓库对比：claude-code-webui (Tailwind dark: variant) vs opcode (OKLCH CSS Variables + React Context)
> 目标：为 AgentHub 设计统一的主题系统（OKLCH + CSS Variables + Zustand 持久化 + Monaco 同步）

---

## 1. 三系统机制对比

### 1.1 主题切换模式

| 维度 | claude-code-webui | opcode | AgentHub（本设计） |
|------|-------------------|--------|---------------------|
| 主题值 | `"light" \| "dark"` | `"dark" \| "gray" \| "light" \| "custom"` | `"dark" \| "light" \| "system"` |
| 系统跟随 | 仅首次加载时检测 `prefers-color-scheme`，之后无监听 | 不支持 | 支持：`matchMedia` 实时监听，OS 切换即时响应 |
| 持久化 | `localStorage`（key: `settings`，含 legacy key 迁移） | Tauri backend `api.getSetting` / `api.saveSetting` | Zustand `persist` 中间件 → `localStorage`（Web），Tauri `store` plugin（Desktop） |
| 状态管理 | React Context (`SettingsContext`) | React Context (`ThemeContext`) | Zustand `uiStore.theme` + `uiStore.setTheme()` |
| 定时切换 | 不支持 | 不支持 | P2 预留接口，P0 不实现 |
| 自定义颜色 | 不支持 | 支持：14 色 OKLCH 变量全量可覆写 | P1 预留（Plugin `slot: theme` 机制） |

### 1.2 切换触发流

```
claude-code-webui:
  用户点击 SunIcon/MoonIcon → setSettings({ theme }) → localStorage
  → document.documentElement.classList.add/remove("dark") → Tailwind dark: 变体自动生效

opcode:
  用户选择 ThemeSelect → setTheme(mode) → api.saveSetting
  → root.classList.remove("theme-*") → root.classList.add("theme-${mode}")
  → CSS 变量级联切换 → (custom 模式) JS setProperty 注入自定义色

AgentHub（本设计）:
  用户点击 ThemeToggle / 系统 media 变化 → uiStore.setTheme(mode)
  → Zustand persist → localStorage / Tauri store
  → resolveTheme() → document.documentElement.classList.toggle("dark", isDark)
  → Monaco: monaco.editor.setTheme(isDark ? "vs-dark" : "vs")
```

---

## 2. CSS 变量 vs Tailwind dark: 变体

### 2.1 方案对比

| 方案 | claude-code-webui | opcode | AgentHub（推荐） |
|------|-------------------|--------|-------------------|
| 机制 | 纯 `dark:` 变体 | CSS 变量 + class 级联 (`.theme-light` 等) | CSS 变量为主，`dark:` 为例外 |
| 组件写法 | `bg-white dark:bg-gray-900` | `bg-background` | `bg-background`（例外: `dark:bg-green-950/30`） |
| 全局换肤 | 改所有组件 | 改一套 CSS 变量 | 改 `:root` / `.dark` 两套变量 |
| 运行时动态自定义 | 不支持 | 支持（JS `setProperty`） | P1 通过 Plugin theme slot |
| 维护成本 | 高（重复 `dark:` 前缀） | 中（多套变量 + JS 桥接） | 低（两套变量，shadcn/ui 标准） |

### 2.2 AgentHub CSS 变量层

定义在 `packages/ui/src/styles/theme.css`，遵循 shadcn/ui 令牌命名：

```css
@import "tailwindcss";
@variant dark (.dark &);

:root {
  --background: oklch(0.98 0.01 260);
  --foreground: oklch(0.12 0.01 260);
  --primary: oklch(0.50 0.15 260);     --primary-foreground: oklch(0.98 0.01 260);
  --secondary: oklch(0.94 0.01 260);   --secondary-foreground: oklch(0.12 0.01 260);
  --muted: oklch(0.94 0.01 260);       --muted-foreground: oklch(0.45 0.01 260);
  --card: oklch(0.96 0.01 260);        --card-foreground: oklch(0.12 0.01 260);
  --accent: oklch(0.94 0.01 260);      --accent-foreground: oklch(0.12 0.01 260);
  --destructive: oklch(0.55 0.22 25);  --destructive-foreground: oklch(0.98 0.01 260);
  --border: oklch(0.88 0.01 260);      --input: oklch(0.88 0.01 260);
  --ring: oklch(0.50 0.15 260);        --radius: 0.5rem;
}

.dark {
  --background: oklch(0.12 0.01 260);  --foreground: oklch(0.95 0.01 260);
  --primary: oklch(0.70 0.15 260);     --primary-foreground: oklch(0.12 0.01 260);
  --secondary: oklch(0.18 0.01 260);   --secondary-foreground: oklch(0.95 0.01 260);
  --muted: oklch(0.18 0.01 260);       --muted-foreground: oklch(0.55 0.01 260);
  --card: oklch(0.16 0.01 260);        --card-foreground: oklch(0.95 0.01 260);
  --accent: oklch(0.18 0.01 260);      --accent-foreground: oklch(0.95 0.01 260);
  --destructive: oklch(0.55 0.22 25);  --destructive-foreground: oklch(0.98 0.01 260);
  --border: oklch(0.22 0.01 260);      --input: oklch(0.22 0.01 260);
  --ring: oklch(0.70 0.15 260);
}
```

色调 `260`（蓝紫色域）作为 AgentHub 品牌色基色。所有 token 使用 OKLCH 色彩空间，保证感知均匀性。

---

## 3. 代码编辑器主题同步

### 3.1 问题：Monaco Editor 有独立主题系统

Monaco 内置 `vs`（亮色）/ `vs-dark`（暗色）/ `hc-black`。当用户切换 AgentHub 主题时，Monaco 实例必须同步切换，否则出现 UI/编辑器颜色撕裂。

现状：claude-code-webui 无 Monaco；opcode 使用 `react-syntax-highlighter`（Prism），通过 `claudeSyntaxTheme.ts` 工厂函数（`getClaudeSyntaxTheme(theme: ThemeMode)`）为每个模式返回独立配色。但这不是 Monaco。

### 3.2 AgentHub 同步方案

```ts
// packages/ui/src/hooks/useMonacoTheme.ts
export function useMonacoTheme() {
  const monaco = useMonaco();
  const resolved = useUiStore((s) => s.resolvedTheme); // "dark" | "light"

  useEffect(() => {
    if (!monaco) return;
    monaco.editor.setTheme(resolved === "dark" ? "vs-dark" : "vs");
  }, [monaco, resolved]);
}
```

在 `App.tsx` 挂载 `<MonacoThemeBridge />` 一次全局生效。P2 可定义 `agenthub-dark` / `agenthub-light` 自定义主题与 OKLCH token 对齐。

### 3.3 代码块语法高亮

opcode 的 `claudeSyntaxTheme.ts` 模式值得复用：主题工厂根据 resolved theme 返回对应配色。若后续升级到 Shiki（见 `design-markdown-rendering.md`），Shiki 原生支持 `dualTheme`，构建时注入，无需运行时 JS 切换。

```ts
// packages/ui/src/lib/syntaxTheme.ts
export function getSyntaxTheme(mode: "dark" | "light") {
  return mode === "dark" ? darkPrismTheme : lightPrismTheme;
}
```

---

## 4. AgentHub 完整主题架构

### 4.1 数据流

```
uiStore.theme ("dark"|"light"|"system")
  → setTheme(mode) → persist (localStorage / Tauri store)
  → _resolveTheme() → resolvedTheme ("dark"|"light")
    ├─ system → matchMedia("(prefers-color-scheme: dark)") + live listener
    └─ dark/light → pass-through
  → useThemeClass() → document.documentElement.classList.toggle("dark")
  → useMonacoTheme() → monaco.editor.setTheme()
  → PluginContext.theme = resolvedTheme (插件接收 resolved 值)
```

### 4.2 Zustand Store 定义

```ts
// apps/web/src/stores/uiStore.ts
type ThemeMode = "dark" | "light" | "system";

// state: { theme: ThemeMode, resolvedTheme: "dark"|"light" }
// actions:
//   setTheme(mode): set({ theme: mode }); get()._resolveTheme();
//   _resolveTheme(): resolved = (theme === "system")
//     ? matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
//     : theme;
// persist: { name: "agenthub-ui" } → localStorage
```

### 4.3 `useThemeClass` Hook

```ts
// packages/ui/src/hooks/useThemeClass.ts
export function useThemeClass(resolved: "dark" | "light") {
  // 1. 同步 DOM class
  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

  // 2. 监听系统偏好变化（matchMedia change → uiStore._resolveTheme()）
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => useUiStore.getState()._resolveTheme();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
}
```

### 4.4 持久化策略

| 平台 | 存储后端 | 实现 |
|------|---------|------|
| Web (P0) | `localStorage` | Zustand `persist` 中间件，key: `agenthub-ui` |
| Tauri Desktop (P1) | Tauri `store` plugin | 替换 `persist` 的 `storage` 为 Tauri store adapter |
| PWA | `localStorage` + SW cache | 与 Web 一致；SW 不干预主题 |

---

## 5. 与 opcode 的主题系统差异

| 维度 | opcode | AgentHub |
|------|--------|----------|
| 主题数 | 4 (dark/gray/light/custom) | 3-mode (dark/light/system) |
| 状态管理 | React Context (`ThemeContext`) | Zustand (`uiStore`) |
| 持久化 | Tauri backend `api.getSetting` | Zustand `persist` (localStorage / Tauri store adapter) |
| 系统跟随 | 无 | `matchMedia` 实时监听 |
| 自定义颜色 | 内置：14 色完整 UI | P1 通过 Plugin `slot: theme` 实现 |
| 默认主题 | `gray`（柔和暗色） | `system`（尊重 OS 偏好） |
| Monaco 同步 | 无（使用 react-syntax-highlighter） | `useMonacoTheme()` 自动同步 |
| 语法高亮 | Prism 工厂 `claudeSyntaxTheme.ts` | Shiki（P1）或 Prism 工厂（P0 fallback） |
| HTML class | `.theme-dark` / `.theme-light` 等 | `.dark`（Tailwind v4 `@variant dark` 兼容） |

**不引入 opcode 的 `gray` / `white` / `custom` 主题的原因**：
- `gray` 和 `dark` 仅亮度差 0.08，用户感知区别极小，增加维护负担。
- `custom` 与 Plugin `slot: theme` 功能重叠，在 Plugin 层实现更合理（`design-plugin-marketplace.md` 已定义 theme slot）。
- P0 优先收敛到最小可行主题集，P1+ 按需扩展。

---

## 6. 实现清单

| 优先级 | 任务 | 位置 |
|--------|------|------|
| P0 | CSS 变量定义（`:root` + `.dark`） | `packages/ui/src/styles/theme.css` |
| P0 | `uiStore` theme + `setTheme` + `resolveTheme` | `apps/web/src/stores/uiStore.ts` |
| P0 | `useThemeClass` hook（DOM bridge + matchMedia 监听） | `packages/ui/src/hooks/useThemeClass.ts` |
| P0 | `useMonacoTheme` hook（Monaco theme sync） | `packages/ui/src/hooks/useMonacoTheme.ts` |
| P0 | ThemeToggle 组件（SunIcon/MoonIcon/MonitorIcon 三态） | `packages/ui/src/components/ui/theme-toggle.tsx` |
| P0 | 注入 `PluginContext.theme`（resolved 值） | `apps/web/src/stores/pluginStore.ts` |
| P1 | Tauri `store` plugin 适配 `persist` storage | `apps/web/src/lib/tauri-storage-adapter.ts` |
| P1 | Monaco 自定义主题（agenthub-dark / agenthub-light） | `packages/ui/src/lib/monaco-themes.ts` |
| P1 | Prism/Shiki 语法高亮主题工厂 | `packages/ui/src/lib/syntaxTheme.ts` |
| P1 | Plugin `slot: theme` CSS 注入 + 沙箱 | `apps/web/src/lib/plugin-theme-loader.ts` |
| P2 | 定时切换（日落后自动 dark） | `packages/ui/src/hooks/useScheduledTheme.ts` |

---

## 7. 参考

- `claude-code-webui.md` 2.3 — Tailwind dark: variant + localStorage 实现
- `opcode.md` 1.2 — ThemeContext + Tauri 持久化 + 4 主题模式
- `design-desktop-ux.md` 2.2.7 — `uiStore` 的 `theme` 状态字段 + `setTheme` action
- `design-frontend-monorepo.md` — Tailwind v4 + shadcn/ui 组件分层
- `design-plugin-marketplace.md` — Plugin `slot: theme` 机制定义
- `design-markdown-rendering.md` 3 — Shiki `dualTheme` 替代 react-syntax-highlighter
- `opcode/src/contexts/ThemeContext.tsx` — 完整 ThemeContext 实现（189 行）
- `opcode/src/styles.css` — 5 套 CSS 变量定义（dark/gray/light/white/custom）
- `opcode/src/lib/claudeSyntaxTheme.ts` — Prism 语法高亮主题工厂

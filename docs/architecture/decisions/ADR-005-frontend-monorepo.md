# ADR-005: 前端 Monorepo 架构

## Status

Accepted

## Context

AgentHub 前端需要同时支持多个平台：

- **Desktop**：基于 Tauri 的桌面应用，需要访问本地文件系统、进程管理等原生能力。
- **Web**：浏览器端应用，通过 Hub Server 访问远程资源。
- **Mobile**：移动端适配（规划中）。

这些平台共享大量 UI 组件（ChatBubble、AgentCard、ArtifactPreview、Button、Modal 等）、TypeScript 类型定义和工具函数。如果各平台独立维护代码，会导致：

1. 组件逻辑重复，bug 修复需要在多处同步。
2. 类型定义不一致，跨平台数据交换出错。
3. 设计规范难以统一执行。

## Decision

采用 **pnpm workspace monorepo** 架构，目录结构如下：

```
app/
  shared/        # 共享包：组件、类型、工具函数
    src/
      components/  # AgentCard, ChatBubble, ChatInput, ConversationList 等
      ui/          # Button, Card, Modal, Select, Tooltip 等基础 UI 原语
  desktop/       # Tauri 桌面端
    src/
      components/  # 桌面专属组件（SettingsPage, ChatView, PromptInput 等）
      styles/      # tokens.css, themes.css, presets.css
      views/       # IMView, TeamRunConsole 等
  web/           # 浏览器端
  mobile/        # 移动端
  e2e/           # Playwright E2E 测试
  pnpm-workspace.yaml  # workspace 配置
```

**共享策略：**
- `shared` 包含跨平台复用的组件（8+ 组件）、UI 原语（30+ 组件）和公共类型。
- `desktop`/`web`/`mobile` 各自引用 `shared`，只维护平台特定代码。
- 样式 token（`tokens.css`、`themes.css`）定义在 desktop 中，web/mobile 按需导入或复制。

**工具链：**
- `pnpm` 作为包管理器，利用 workspace 协议 (`workspace:*`) 管理内部依赖。
- `vitest` workspace 模式运行跨包测试。
- `eslint` 统一配置（`eslint.config.mjs`），覆盖所有包。
- `prettier` 统一代码格式。

**构建与验证：**
- `pnpm -r build` 构建所有包。
- `pnpm -r typecheck` 验证所有包的类型安全。
- `pnpm -r lint` 检查所有包的代码质量。
- 共享组件变更需同时验证 desktop 和 web 的编译通过。

## Consequences

**正面：**
- 共享组件修改一处生效多处，避免代码重复和不一致。
- 类型定义集中管理，跨平台数据交换有类型安全保障。
- 统一的 lint/test/build 工具链，开发体验一致。
- pnpm 的 workspace 链接避免了 npm publish 流程，迭代速度快。

**负面：**
- 共享组件变更需要同时验证所有消费端的编译和运行，CI 时间增加。
- Tauri 特有的原生能力（文件系统、进程管理）无法放入 shared，需要在 desktop 中维护 platform-specific 代码。
- `pnpm -r` 的拓扑排序构建可能在包间依赖复杂时出现意外行为。
- 样式 token 目前定义在 desktop 中，web/mobile 需要同步维护或建立 token 同步机制。
- 4 个包（shared/desktop/web/mobile）的 workspace 在依赖管理上需要谨慎处理 hoisting 和 peer dependencies。

# ADR-003: SettingsPage 渐进式拆分策略

## Status

Accepted

## Context

`desktop/src/components/SettingsPage.tsx` 在持续迭代中膨胀至 3153 行（截至 2026-06），成为项目中最大的单文件组件。该文件集中了：

- 多个独立的功能区域（Agent 管理、模型配置、MCP Server、权限设置、账户信息等）。
- 大量局部状态和表单逻辑。
- 内联或混合的样式定义。
- Agent 创建向导（`settings/agentCreation/`）已先行拆出。

直接影响了：
- **开发效率**：任何 settings 相关改动都需要在超大文件中定位上下文。
- **代码审查**：改动影响范围难以界定，PR diff 噪音大。
- **编译性能**：任何修改触发完整组件重新编译。

## Decision

采用三阶段渐进式拆分策略，每个阶段可独立提交和验证：

### Phase 1: 提取 Section 组件

将 SettingsPage 中的每个功能区域提取为独立组件：
- 已有：`settings/sections/` 目录（sections-agents.module.css 等）。
- 已有：`settings/primitives/` 目录（基础 UI 原语）。
- 目标：每个 section 对应一个 `<SectionName />` 组件，SettingsPage 退化为布局容器 + 路由/Tab 切换。
- 验证标准：各 section 组件可独立渲染，SettingsPage 行数降至 1500 行以下。

### Phase 2: CSS 模块化

- 将 `SettingsPage.module.css` 中的样式随 section 组件一起迁移到各自的 `.module.css` 文件。
- 已有 `sections-agents.module.css` 和 `primitives.module.css` 作为模式参考。
- 共享样式抽取到 `settings/settingsShared.ts`（已有）。

### Phase 3: Feature Flag / Lazy Loading

- 对非核心 section（如 MCP 配置、高级权限）使用 `React.lazy()` + `Suspense` 按需加载。
- 减少 SettingsPage 首屏渲染负担。
- 可选：根据用户角色/权限动态展示 section。

## Consequences

**正面：**
- 每个 phase 可独立合并、独立验证，不需要一次性完成全部拆分。
- Phase 1 完成后，单个 section 的改动不再需要触碰主文件，降低 PR 冲突。
- Phase 2 使样式与组件结构对齐，提高可维护性。
- Phase 3 提升首屏性能（懒加载）和可扩展性。

**负面：**
- Phase 1 拆分过程中可能发现 section 之间存在共享状态耦合，需要引入 context 或状态管理中间层。
- Phase 3 的懒加载会增加首屏切换 section 时的延迟（通常 < 100ms，但需权衡）。
- 拆分过程中需要持续确保 dark/light 主题兼容性和现有功能回归。

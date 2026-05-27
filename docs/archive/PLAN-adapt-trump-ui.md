# adapt-trump-ui 工作计划

> 分支：`worktree-adapt-trump-ui`（隔离 worktree）
> 源：Trump 的 5 页面 UI → 适配 Desktop + WebUI
> 目标：共享组件化、测试框架、工程规范

## Phase 1：提取共享 UI 组件（Trump 页面 → shared）

- [ ] 从 5 个 PageShell 提取品牌区（BrandingSection）→ `app/shared/src/components/Branding/`
- [ ] 提取 AgentCard 组件（AgentSquare 页面用）→ shared
- [ ] 提取 ProjectCard 组件 → shared
- [ ] 提取 ChatBubble 组件（PrivateChats 页面用）→ shared
- [ ] 统一 CSS 变量体系（tokens.css 合并）
- [ ] 确保组件在 Desktop 和 Web 都能渲染

## Phase 2：工程规范

- [ ] pnpm workspace 结构确认
- [ ] ESLint + Prettier 规则统一
- [ ] TypeScript strict mode
- [ ] 组件文件命名规范（PascalCase.tsx + .module.css）
- [ ] 导出 barrel（index.ts）

## Phase 3：测试框架

- [ ] Vitest 配置（Desktop + Web 共享）
- [ ] Playwright E2E 配置
- [ ] 组件单元测试模板
- [ ] Storybook 或 Ladle 组件文档

## Phase 4：WebUI 集成

- [ ] Web entry point 完善（vite.config + main.tsx）
- [ ] 路由系统（react-router）
- [ ] 共享组件在 Web 端验证

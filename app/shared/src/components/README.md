# 共享 UI 组件规范

## 文件结构
```
components/
  ComponentName/
    ComponentName.tsx       — React 组件（named export only）
    ComponentName.module.css — CSS Module
    ComponentName.test.tsx   — 单元测试（可选）
    index.ts                 — re-export
```

## 命名规则
- 目录/文件：PascalCase（`BrandingSection/`、`AgentCard.tsx`）
- Props 接口：`{ComponentName}Props`
- CSS class：`camelCase`（`brandingTitle`、`agentCard`）
- 只使用 named export，禁止 default export

## CSS 规则
- 所有颜色使用 OKLCH CSS 变量（`var(--brand)` 等），禁止硬编码色值
- 字体使用 `var(--font-sans)` 或 `var(--font-mono)`
- 圆角使用 `var(--radius-*)` token
- 禁止 `!important`
- 禁止使用 `position: absolute` 除非有对应的 `position: relative` 父容器
- 动画超过 200ms 需包裹在 `@media (prefers-reduced-motion: no-preference)` 中

## Props 规则
- 必须接受 `className?: string` 用于外部样式覆盖
- 复杂组件使用 `children` 而非硬编码内容
- 不使用 `any` 类型

# Desktop 前端交接 — 修复 + 测试

> **from**: Delicious233 (主 Agent) | **to**: 前端 Agent | **date**: 2026-05-24 | **branch**: `dev/delicious233`

---

## 1. 背景

过去 24 小时内完成了 60+ commits 的全栈推进（Edge/Hub/Desktop），Desktop 新增了大量功能。后端测试全部通过（Edge 12/12、Hub 12/12），`pnpm tsc --noEmit` 通过，`pnpm test` 572 tests 通过，`pnpm build` 成功。

**但是**：启动 `pnpm dev` 后浏览器加载 `http://127.0.0.1:5173`，React 报 "Maximum update depth exceeded" 无限重渲染循环。

## 2. 最近新增/改动（最可疑）

| 改动 | 文件 | 风险 |
|------|------|:--:|
| **viewRegistry 视图注册表** | `config/viewRegistry.ts`, `views/viewRegistry.tsx`, `views/MainView.tsx` | 高 |
| **Slot 防御 + Suspense** | `views/viewRegistry.tsx` (Slot 自动包装 lazy/ErrorBoundary) | 中 |
| **AuthPage 登录/注册** | `components/AuthPage.tsx`, `LoginForm.tsx`, `RegisterForm.tsx` | 中 |
| **IM 集成 + 视图切换** | `App.tsx` (新增 Chat/IM tab bar 切换), `views/IMView.tsx` | 高 |
| **Hub auth 状态** | `stores/hubStore.ts`, `api/hubAuth.ts` | 中 |
| **i18n 防御** | `i18n/index.ts` (try/catch fallback) | 低 |
| **root ErrorBoundary** | `main.tsx` (ErrorBoundary + Loading fallback) | 低 |

## 3. 当前状态

```
pnpm tsc --noEmit   ✅ 通过
pnpm test           ✅ 572 tests
pnpm build          ✅ 5.3s
pnpm dev            ⚠️ 渲染报 "Maximum update depth exceeded"
```

浏览器中 `#root` 有 1 child（ErrorBoundary 生效），但内容显示 "Maximum update depth exceeded... Retry"。

## 4. 可能原因

### 高概率

1. **App.tsx 的 useEffect 循环**
   - 新增了 `hubAuthenticated` 状态和 view mode 切换
   - `useEffect` 中 setState 触发了自身的 re-render
   - 检查 `hubStore.subscribe` 是否在 render 中直接调用而非 useEffect 中

2. **viewRegistry Slot 无限循环**
   - `MainView` 渲染 `<Slot name={viewMode}>` 
   - 如果 `viewMode` 变化 → Slot 重新渲染 → 触发某种条件改变 viewMode → 循环

3. **AuthPage hub connectivity check**
   - `AuthPage.tsx` 中的 `useEffect` ping Hub health
   - 如果 ping 结果 setState 触发了 auth state change → 触发 App 重新渲染 → AuthPage 重新 mount → 再次 ping → 循环

### 中概率

4. **useHubEventStream 订阅循环**
5. **Zustand store 的 subscribeWithSelector 触发循环**

## 5. 修复步骤

### Step 1: 定位循环源
- 打开浏览器 DevTools，查看完整的 component stack trace
- 或者临时注释掉 App.tsx 中新增的 Hub/IM/Auth 相关代码，逐块恢复

### Step 2: 修复
- 给所有 `useEffect` 补充正确的依赖数组
- 确保 store 订阅在 `useEffect` 中而非 render body 中
- `Slot` 组件避免在 render 中修改状态

### Step 3: 验证
```bash
cd app/desktop
pnpm tsc --noEmit   # 类型检查
pnpm test           # 所有测试（期望 572+）
pnpm build          # 构建
# 浏览器打开 http://127.0.0.1:5173 确认渲染正常
```

## 6. 关键文件速查

```
app/desktop/src/
├── App.tsx                    ← 主入口（view mode 切换 + Hub auth）
├── main.tsx                   ← ErrorBoundary + Loading
├── config/viewRegistry.ts     ← 10 个视图注册（含 im-view）
├── views/
│   ├── viewRegistry.tsx       ← Slot 渲染器（Suspense + ErrorBoundary 自动包装）
│   ├── MainView.tsx           ← 中心视图解析
│   └── IMView.tsx             ← IM 聊天视图
├── components/
│   ├── AuthPage.tsx           ← 登录/注册页面
│   ├── LoginForm.tsx
│   └── RegisterForm.tsx
├── hooks/
│   ├── useHubEventStream.ts   ← Hub WS 事件
│   └── useIMChat.ts           ← IM 状态管理
├── stores/
│   ├── hubStore.ts            ← Hub 连接状态
│   └── toastStore.ts          ← Toast 通知
└── api/
    ├── hubAuth.ts             ← JWT 认证
    └── hubClient.ts           ← Hub REST 客户端
```

## 7. 参考

- **LobeHub UI**: `docs/reference/projects/lobehub/`
- **IM UX 模式**: `docs/reference/cross-comparison/02-im-ux.md`
- **UI 美化计划**: `docs/reference/cross-comparison/08-ui-beautify-plan.md`
- **ADR 架构决策**: `docs/adr/`

## 8. 提交规范

```text
fix(desktop): 中文摘要
```

英文 type/scope + 中文描述。不改 AGENTS.md。

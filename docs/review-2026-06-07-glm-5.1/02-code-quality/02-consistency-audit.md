# 代码一致性审计报告

> 审计日期: 2026-06-07
> 审计范围: `app/desktop`, `app/web`, `app/shared`, `hub-server`, `edge-server`
> 审计方法: 静态扫描 + 模式对比 (严格只读)

---

## 1. 命名不一致

### 1.1 CSS class 命名

**结论: 🟢 基本统一为 camelCase，少量例外**

- **主流风格**: 全项目 CSS Modules 使用 camelCase (`base`, `submitButton`, `iconButton`, `workspaceTitle`)
- 所有 `.module.css` 文件的 class 命名均为 camelCase，符合 CSS Modules 的惯用模式

**例外**:

| 文件 | class 名 | 风格 |
|------|----------|------|
| `shared/src/ui/StatusBadge.module.css` | `.status_available`, `.status_configuring`, `.status_unavailable` | 🟡 snake_case |

**建议**: 将 StatusBadge 的 BEM+snake_case class 名改为 camelCase (`statusAvailable`, `statusConfiguring`, `statusUnavailable`)，保持全项目一致性。

### 1.2 文件命名

**结论: 🟢 高度统一**

- **组件 (PascalCase)**: `AgentList.tsx`, `AuthPage.tsx`, `ErrorBoundary.tsx` -- 全项目一致
- **Hooks (camelCase)**: `useAuth.ts`, `useMention.ts`, `useStreamingText.ts` -- 全项目一致
- **Stores (camelCase)**: `threadStore.ts`, `hubStore.ts`, `connectionStore.ts` -- 全项目一致
- **Utils (camelCase)**: `agentProfile.ts`, `loopDetector.ts`, `runStateMachine.ts` -- 全项目一致
- **API (camelCase)**: `hubClient.ts`, `hubAuth.ts`, `edgeClient.ts` -- 全项目一致
- **CSS Modules**: `ComponentName.module.css` 与组件同名 -- 一致
- **测试**: `Component.test.tsx` / `module.test.ts` -- 一致

无命名风格混用问题。

### 1.3 TypeScript 函数/变量命名

**结论: 🟢 一致**

- 函数/变量: camelCase
- 类型/接口: PascalCase
- 常量: UPPER_SNAKE_CASE (`SEGMENT_COLORS`, `MAX_CONTEXT_TOKENS`)
- 枚举: PascalCase (enum name) / PascalCase (member)

Go 代码同样遵循标准 Go 命名规范 (MixedCaps for exported, mixedCaps for unexported)。

---

## 2. 导出模式不一致

### 2.1 `export default` vs named export

**结论: 🟡 存在明显分野，但同一包内基本一致**

| 包 | `export default` 文件数 | 模式 |
|----|------------------------|------|
| `desktop/src/components` | 92 | 几乎全部 default |
| `web/src/components` | 24 | 几乎全部 default |
| `shared/src/ui` | 33 | 混合: 大部分 default，但 `index.ts` 通过 `export { default as ... }` 重导出 |
| `shared/src/workbench` | 0 | 全部 named export |
| `shared/src` (核心模块) | 0 | 全部 named export |

**关键发现**:

- `shared/src/workbench/` 下所有组件使用 **named export**，不使用 `export default`
- `shared/src/ui/` 下组件使用 **export default**，通过 barrel `index.ts` 转为 named re-export
- Desktop/Web 的页面组件使用 **export default** (符合 React 惯例)

```typescript
// shared/src/ui/index.ts — 将 default 转为 named
export { default as Modal } from './Modal';
export { default as ArtifactCard } from './ArtifactCard';
```

```typescript
// shared/src/workbench/index.ts — 直接 named export
export { AgentHubWorkbench } from './AgentHubWorkbench';
export { ConversationSidebar } from './ConversationSidebar';
```

**建议**: 在 `shared` 包内统一为 named export（workbench 的做法更优），避免 default re-export 的额外转换层。短期内可接受，但新增组件应统一为 named export。

### 2.2 Barrel export (index.ts)

**结论: 🟢 shared 包组织良好，desktop/web 缺少 barrel**

- `shared/src/ui/index.ts` -- 完善的 barrel，集中导出所有 UI 组件
- `shared/src/workbench/index.ts` -- 完善的 barrel
- `shared/src/transcript/index.ts` -- 完善的 barrel
- `shared/src/composer/index.ts` -- 完善的 barrel
- `desktop/src/components/IM/index.ts` -- 部分 barrel
- `web/src/components/IM/index.ts` -- 部分 barrel
- `desktop/src/components/` -- **无** barrel export
- `web/src/components/` -- **无** barrel export

**建议**: desktop/web 的 components 缺少 barrel export 不是严重问题（直接 import 路径更明确），保持现状即可。

---

## 3. CSS Modules 使用

### 3.1 Inline style 泄漏

**结论: 🟡 广泛使用 inline style，但多为动态值**

| 区域 | inline style 数量 | 典型用法 |
|------|-------------------|----------|
| `desktop/components` | ~20 处 | `style={{ transform: 'rotate(90deg)' }}`, `style={oneDark}` |
| `web/components` | ~20 处 | 同上 |
| `shared/ui` | ~20 处 | `style={{ width: \`${value}%\` }}` (动态), `style={{ color: 'var(--destructive, #dc2626)' }}` |
| `shared/workbench` | ~5 处 | `style={{ background: avatarColor }}` (动态) |

**分析**:
- 大部分 inline style 用于 **动态值**（百分比宽度、颜色变量、坐标定位），这些确实不适合写在 CSS Modules 中
- `CodeBlock.tsx` 的 `style={oneDark}` 是 Prism.js 主题对象，属于第三方库集成
- 少量硬编码值（如 `display: 'flex'`, `gap: 4`）本可以提取到 CSS Modules

**建议**: 仅对 `display: flex`, `gap`, `margin`, `padding` 等纯布局性质的 inline style 进行迁移，优先级低。

### 3.2 硬编码颜色值

**结论: 🟡 themes.css 集中定义了 token，但 module.css 中仍有散落的硬编码色值**

**themes.css 中已定义的 token 体系** (良好实践):
```css
--primary: #6985e8;
--success: #69c967;
--danger: #e87070;
--surface: #24242d;
--text-1: #e3e4e6;
```

**module.css 中的硬编码色值** (应迁移):

| 文件 | 硬编码值 | 应使用 token |
|------|----------|-------------|
| `shared/workbench/pages/ContactsPage.module.css:528` | `#f2f2f5` | `var(--surface-dim)` |
| `shared/workbench/pages/ContactsPage.module.css:533` | `#111827` | `var(--app-bg)` |
| `shared/workbench/pages/DocsPage.module.css:247` | `#ff7a1a` | 品牌色 token |
| `shared/workbench/blocks/PinnedAnnouncement.module.css:28-29` | `#ff7a1a`, `#ffffff` | 品牌色 / `var(--text-inv)` |
| `desktop/components/ApprovalCard.module.css:249` | `#ffffff` | `var(--text-inv)` |
| `desktop/components/AuthPage.module.css:240` | `#111827` | `var(--app-bg)` |
| `shared/ui/DiffReviewPanel.module.css:305` | `#e0e0e0` | `var(--text-2)` |
| `desktop/components/DiffViewer.module.css:559` | `#e0e0e0` | `var(--text-2)` |

此外，`AuthPage.module.css` (web) 大量使用 `rgba()` 作为 fallback 值：
```css
border: 1px solid rgba(255, 255, 255, 0.065);
background: rgba(37, 37, 45, 0.92);
```
这些虽然在 `var()` 的 fallback 位，但 fallback 值与 themes.css 中定义的 token 值不一致。

**建议**: 将所有硬编码色值替换为 CSS 变量引用。AuthPage 的 rgba fallback 值应与 themes.css 的 token 值对齐。

### 3.3 全局 CSS 文件

**结论: 🟢 受控**

全局 CSS 文件仅存在于 `styles/` 目录：
- `themes.css` — 主题变量定义 (正确)
- `tokens.css` — design token 定义 (正确)
- `presets.css` — 基础样式重置 (正确)

无意外的全局 CSS 泄漏。

---

## 4. 错误处理模式

### 4.1 前端错误处理

**结论: 🟡 try/catch 和 .catch() 并存，ErrorBoundary 仅 desktop 端完整**

| 模式 | 使用次数 | 主要位置 |
|------|----------|---------|
| `try {} catch` | ~289 处 / 112 文件 | API 层、hooks、组件事件处理 |
| `.catch()` | ~57 处 / 22 文件 | WebSocket、Promise 链、设备注册 |
| `ErrorBoundary` | 2 处 (desktop: 完整, web: 简单) | `main.tsx` 顶层 |

**Desktop ErrorBoundary** (270 行): 包含完整 UI（CSS Modules 样式、重试按钮、错误详情折叠）
**Web ErrorBoundary** (69 行): 仅基础 UI（inline style，无重试逻辑）

```typescript
// desktop — 有完整恢复机制
export default class ErrorBoundary extends Component<Props, State> {
  // ... 270 行，含 styled fallback UI
}

// web — 最小实现
export default class ErrorBoundary extends Component<Props, State> {
  // ... 69 行，纯 inline style
}
```

**建议**:
1. 将 ErrorBoundary 提取到 `shared/src/ui/`，两平台复用
2. Web 端的 ErrorBoundary 应获得与 Desktop 同等质量的恢复 UI

### 4.2 Go 后端错误处理

**结论: 🟢 设计良好，有统一 errcode 体系**

**共享错误码体系** (`pkg/errcode/`):
- `pkg/errcode/error.go` — 统一的 `Error` struct，含 Code/Message/HTTPStatus/TraceID
- `pkg/errcode/codes.go` — 通用错误码 (INTERNAL_ERROR, UNAUTHORIZED, NOT_FOUND 等)
- `hub-server/internal/errcode/` — re-export 共享 + 添加 Hub 域特定码
- `edge-server/internal/errcode/` — re-export 共享 + 添加 Edge 域特定码 (EXECUTOR_UNAVAILABLE 等)

**错误构造方式分布**:

| 服务 | `fmt.Errorf` | `errors.New` | 自定义 Error type | `var Err` sentinel |
|------|-------------|-------------|------------------|-------------------|
| hub-server | 110 处 / 24 文件 | 13 处 / 7 文件 | 0 (使用 `errcode.Error`) | 12 处 / 7 文件 |
| edge-server | 107 处 / 19 文件 | 47 处 / 11 文件 | 5 个 struct | 12 处 / 7 文件 |

**Edge-server 的自定义错误类型**:
- `ParseStreamError` (adapters)
- `codexError` / `codexItemError` (codex adapter 内部)
- `RunError` (lifecycle)
- `jsonrpcError` (MCP server)

**分析**:
- `fmt.Errorf` 是主流，用于构造带上下文的错误消息
- `errors.New` 主要用于 sentinel 错误和简单常量
- 自定义 struct 类型用于需要结构化数据的场景（如 RunError 需要 exitCode）
- 整体模式一致，errcode 体系设计良好

---

## 5. 类型安全

### 5.1 `any` 类型使用

**结论: 🟢 使用量极少，且集中在特定文件**

| 区域 | `any` 使用次数 | 主要文件 |
|------|---------------|---------|
| `shared/src` (源码) | **1** | `vendor-types.d.ts` (18处, 声明文件可接受) |
| `desktop/src` (源码) | **0** | — |
| `web/src` (源码) | **0** | — |
| `shared/src` (测试) | ~20 处 | `ToolTimeline.test.tsx` (大量 mock 类型) |

**建议**: ToolTimeline 测试中的 `any` 使用可以通过创建专用 mock 类型来改善，但优先级低。

### 5.2 `as` 类型断言

**结论: 🟡 使用适中，多为合理场景**

| 区域 | `as` 断言次数 | 分布 |
|------|-------------|------|
| 全项目 `.ts` 文件 | ~631 处 / 216 文件 | 以测试和 API 层为主 |
| 全项目 `.tsx` 文件 | ~39 处 / 15 文件 | 组件中少量使用 |

**shared/src 源码中的典型用法** (非测试):

```typescript
// API 响应解析 — 合理
return res.json() as Promise<T>;                          // apiClient.ts
const raw = JSON.parse(msg.data) as EventEnvelope;        // eventClient.ts

// 类型窄化 — 合理但可优化
const d = value as Record<string, unknown>;               // diff.ts
const err = (body as Record<string, unknown>).error;      // errors.ts

// 构建常量表 — 合理
) as Record<SurfaceStatus, SurfaceStatusMetadata>;        // surfaceMetadata.ts
```

**建议**: `diff.ts` 中的 `as Record<string, unknown>` 可以通过添加 runtime type guard 来替代，提高安全性。其余用法基本合理。

### 5.3 `!` 非空断言

**结论: 🟢 极少使用**

| 区域 | 非空断言次数 |
|------|------------|
| `shared/src` 源码 | **1 处** |
| `desktop/src` 源码 | **1 处** |
| `web/src` 源码 | **0 处** |

仅有的 2 处：
- `shared/workbench/WorkspaceHeader.tsx:105` — `activeConversation!.model`
- `desktop/src` — 非测试源码中 1 处

**建议**: `activeConversation!.model` 应改为可选链 `activeConversation?.model` 并处理 null case。

---

## 6. 重复实现

### 6.1 Desktop / Web 重复文件 (应提取到 shared)

**结论: 🔴 大量重复，是最大的代码一致性问题**

#### 重复的 Hooks (10 个)

| 文件 | Desktop vs Web 差异程度 |
|------|------------------------|
| `useAuth.ts` | 平台特定（OAuth vs Hub Token） |
| `useAutoScroll.ts` | 🟡 高度相似 |
| `useDeviceRegistration.ts` | 🟡 高度相似 |
| `useHealth.ts` | 🟡 高度相似 |
| `useHubEventStream.ts` | 🟡 高度相似 |
| `useInputDraft.ts` | 🟡 高度相似 |
| `useMediaQuery.ts` | 🟢 可能完全相同 |
| `useMention.ts` | 🟡 高度相似 |
| `useStreamingText.ts` | 🟡 高度相似 |
| `useToast.ts` | 🟡 高度相似 |

#### 重复的 Stores (10 个)

| 文件 | 备注 |
|------|------|
| `connectionStore.ts` | WebSocket 连接状态 |
| `hubStore.ts` | Hub 数据缓存 |
| `modelSettingsStore.ts` | 模型配置 |
| `notificationStore.ts` | 通知状态 |
| `runStore.ts` | 运行状态管理 |
| `searchStore.ts` | 搜索状态 |
| `taskBridgeStore.ts` | 任务桥接 |
| `threadStore.ts` | 会话状态 |
| `toastStore.ts` | Toast 通知 |
| `uiStore.ts` | UI 状态 |

#### 重复的 Utils (4 个)

| 文件 | Desktop vs Web 差异 |
|------|---------------------|
| `runStateMachine.ts` | 🔴 Desktop 有额外的 `DRAINING` 状态，其余相同 |
| `loopDetector.ts` | 🟡 Desktop 有防御性 null check，Web 使用 `!` 断言 |
| `agentProfile.ts` | 🟢 相同逻辑 |
| `fileReadCache.ts` | 🟢 相同逻辑 |

#### 重复的 API 层 (17 个)

| 文件 | 备注 |
|------|------|
| `agentQueries.ts` | Agent 查询 |
| `agentTeamQueries.ts` | 团队查询 |
| `deviceId.ts` / `deviceId.test.ts` | 设备 ID |
| `edgeClient.ts` | Edge 客户端 |
| `executionTargetQueries.ts` | 执行目标查询 |
| `hubAuth.ts` / `hubAuth.test.ts` | Hub 认证 |
| `hubClient.ts` | Hub 客户端 |
| `hubEvents.ts` | Hub 事件 |
| `hubTokenStorage.ts` / `hubTokenStorage.test.ts` | Token 存储 |
| `hubWS.ts` | WebSocket |
| `queryClient.ts` | React Query 配置 |
| `runQueries.ts` | Run 查询 |
| `threadQueries.ts` | Thread 查询 |
| `transport.ts` | 传输层 |

**建议**: 这是最需要优先解决的问题。建议分三步走：
1. **立即可提取**: `useMediaQuery.ts`, `agentProfile.ts`, `fileReadCache.ts`, `loopDetector.ts` — 这些文件逻辑几乎相同
2. **需统一后提取**: `runStateMachine.ts` — 先将 Desktop 的 `DRAINING` 状态合并到统一版本
3. **平台适配层**: hooks/stores/API 通过 `shared` 提供核心逻辑 + `Platform` 接口注入平台差异

### 6.2 Hub-server / Edge-server 重复

**结论: 🟡 少量重复，已有共享机制**

| 重复文件 | 说明 |
|----------|------|
| `internal/middleware/access_log.go` | hub (29行) vs edge (58行) — edge 版本更完整，含 recovery |
| `internal/jwtutil/` | hub 有 `jwt.go` + `tokendance.go`，edge 有 `validate.go` — 职责不同 |
| `internal/errcode/` | 两端各自 re-export `pkg/errcode` + 添加域特定码 — **设计正确** |

**已有的共享包**:
- `pkg/errcode/` — 统一错误码体系 (被两个服务引用)
- `pkg/uuidv7/` — UUIDv7 生成

**建议**: 将 `access_log.go` 的 edge 版本提取到 `pkg/middleware/access_log.go`，hub-server 复用它。jwtutil 差异较大，保持独立。

---

## 总结

| 审计项 | 评级 | 说明 |
|--------|------|------|
| CSS class 命名 | 🟢 | 几乎全 camelCase，仅 StatusBadge 有 snake_case |
| 文件命名 | 🟢 | PascalCase/camelCase 分工清晰，无混用 |
| 导出模式 | 🟡 | shared/ui(default) vs shared/workbench(named) 不统一 |
| CSS Modules 使用 | 🟢 | 全局 CSS 受控，token 体系完善 |
| 硬编码颜色 | 🟡 | 约 9 处硬编码 hex，应迁移到 token |
| Inline style | 🟡 | 约 60 处，多为动态值可接受 |
| 前端错误处理 | 🟡 | ErrorBoundary 未共享，web 版功能不完整 |
| Go 错误处理 | 🟢 | 统一 errcode 体系，设计良好 |
| `any` 类型 | 🟢 | 源码中极少使用 (1 处) |
| `as` 断言 | 🟡 | ~631 处，多为 API 解析和测试，合理 |
| `!` 非空断言 | 🟢 | 仅 2 处 |
| Desktop/Web 重复 | 🔴 | 10 hooks + 10 stores + 4 utils + 17 API 文件重复 |
| Go 服务重复 | 🟡 | 1 处 middleware 重复，已有共享 pkg 机制 |

**优先级排序**:
1. **🔴 P0**: Desktop/Web 重复实现提取到 shared（影响维护成本和一致性）
2. **🟡 P1**: 硬编码颜色值迁移到 CSS token
3. **🟡 P1**: ErrorBoundary 提取到 shared
4. **🟡 P2**: export default vs named export 统一
5. **🟢 P3**: StatusBadge CSS 命名、inline style 清理

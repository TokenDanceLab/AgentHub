# CI 遗留问题分析

> 日期：2026-06-24
> 分支：`dev/delicious233`
> 背景：SUPER 工程修复合并后 CI 失败，需修复以恢复 CI 全绿

## 问题总览

| 类别 | 数量 | 严重度 | 状态 |
|---|---|---|---|
| Go unparam | 4 | error — CI 阻断 | 待修 |
| Frontend web lint | 6 errors + 25 warnings | error — CI 阻断 | 待修 |
| Frontend desktop lint | 8 errors (unused-vars 相关) + 62 debt | error — CI 阻断 | 待修 |
| Mobile typecheck | 0 | ✅ 已通过 | 无需修 |
| Go coverage (63.8% < 75%) | — | 跳过 | 管理员批准延期 |

## 1. Go unparam（4 处）

golangci-lint `unparam` 检测到 4 个未使用参数：

| # | 文件 | 行 | 函数 | 未使用 |
|---|---|---|---|---|
| 1 | `edge-server/internal/adapters/surfacing.go` | 401 | `emitSurfacedPreview` | `snapshot *WorkdirSnapshot` |
| 2 | `edge-server/internal/api/diff_apply.go` | 380 | `applyHunkToContent` | 返回值 `error` 始终为 nil |
| 3 | `edge-server/internal/lifecycle/process_executor.go` | 1676 | `fireHubDone` | `runResp map[string]any` |
| 4 | `edge-server/internal/store/sqlite_store.go` | 742 | `deltaProjectionMap` | `tx *sql.Tx` |

### 修复策略

| # | 方式 | 影响范围 |
|---|---|---|
| 1 | `snapshot` → `_` 前缀 | 仅函数签名 |
| 2 | 移除 error 返回值，更新 1 处调用方 | 函数签名 + 1 个 caller |
| 3 | `runResp` → `_` 前缀 | 仅函数签名 |
| 4 | `tx` → `_` 前缀 | 仅函数签名 |

**原则**：最小修改，不改变逻辑。所有修复只涉及参数重命名/删除无意义的 error return。

## 2. Frontend web lint（6 errors）

文件：`app/web/src/stores/wsEventBridge.ts`（5 处）+ `app/web/src/stores/...`（1 处 runId）

| # | 行 | 问题 | 类型 |
|---|---|---|---|
| 1 | 19 | `HubNotification` import 未使用 | unused import |
| 2 | 21 | `HubFriendEventPayload` import 未使用 | unused import |
| 3 | 23 | `HubDeviceKickedPayload` import 未使用 | unused import |
| 4 | 248 | `runId` 赋值后未使用 | unused var |
| 5 | 352 | `data` 赋值后未使用 | unused var |
| 6 | 359 | `data` 赋值后未使用 | unused var |

### 修复策略

- 未使用的 import：删除 import 语句中的对应符号
- 未使用的 `runId`：改为 `_runId` 或删除赋值
- 未使用的 `data`：改为 `_data` 或删除赋值

**原则**：不改逻辑。如果变量用于解构/回调签名必须保留，用 `_` 前缀。

## 3. Frontend desktop lint（8 unused-vars errors）

文件：`app/desktop/src/views/TeamRunConsole.tsx`（7 处）+ `app/desktop/src/utils/threadTitle.ts`（1 处）

| # | 行 | 符号 | 类型 |
|---|---|---|---|
| 1 | 6 | `CheckSquare` | unused import |
| 2 | 12 | `Settings` | unused import |
| 3 | 13 | `ChevronRight` | unused import |
| 4 | 20 | `AgentTeam` | unused import |
| 5 | 24 | `TeamApprovalState` | unused import |
| 6 | 25 | `TeamConflictState` | unused import |
| 7 | 46 | `TeamRunStatus` | unused import |
| 8 | 99 | `\[` unnecessary escape | `threadTitle.ts` |

其余 62 个 desktop lint 错误（no-explicit-any 等）预判为 debt-visibility（CI 配置标记为不阻断）。本 spec 只修 unused-vars 阻断项。

### 修复策略

- 删除 7 个未使用的 import
- `\[` → `[`（正则中 `[` 不需要转义）

## 4. Mobile typecheck

`npx tsc --noEmit` 退出码 0，无错误。CI 之前的 3 个 `exactOptionalPropertyTypes` 错误已在 SUPER 修复中解决。

**结论：无需修。**

## 边界约束

1. 只修 lint/typecheck 阻断项，不动 logic/refactor
2. 不改 `.golangci.yml` / `.eslintrc` 配置
3. 不改 coverage 阈值
4. 每类问题一个 commit

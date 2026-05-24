# @agenthub/shared

`app/shared/` 是 Desktop 和 Web 共用的前端包，负责类型、事件、错误解析、树/Diff 工具、上下文统计和通用 UI 组件。它不是运行时控制面，不直接访问 Edge、Hub 或 Agent CLI。

## 职责

| 模块 | 路径 | 说明 |
|---|---|---|
| `@shared/types` | `src/types.ts` | Edge REST 响应、Run、Thread、Agent Runtime 能力等共享类型 |
| `@shared/events` | `src/events.ts` | Edge WebSocket typed events |
| `@shared/hubEvents` | `src/hubEvents.ts` | Hub WebSocket event 常量和类型 |
| `@shared/errors` | `src/errors.ts` | `api/conventions.md` 错误格式解析 |
| `@shared/tree` | `src/tree.ts` | 消息树和线程树工具 |
| `@shared/diff` | `src/diff.ts` | Diff 解析和展示辅助 |
| `@shared/context/*` | `src/context/` | 上下文用量和 token breakdown 工具 |
| `@shared/ui` | `src/ui/` | Desktop/Web 共用 UI 组件、测试和 Storybook story |

## 使用

Desktop 和 Web 通过路径别名导入：

```typescript
import type { AgentInfo, HealthResponse, RunInfo } from '@shared/types';
import type { EventEnvelope } from '@shared/events';
import { parseError } from '@shared/errors';
import { Button, Card, Pill } from '@shared/ui';
```

新增通用类型、组件或工具先放这里，再由 Desktop/Web 消费。不要在 `app/desktop/` 或 `app/web/` 内复制一套本地共享组件。

## AgentHub 术语

共享类型命名必须区分：

| 概念 | 推荐字段 |
|---|---|
| Agent Runtime | `runtimeId`, `adapterId`, `capabilities` |
| Agent Profile | `profileId`, `agentId`, `customAgentId` |
| Agent Configuration | `model`, `reasoningEffort`, `permissionMode`, `skillIds`, `mcpServerIds` |
| Execution Target | `targetId`, `edgeId`, `workspaceId`, `relayCommandId` |

如果旧接口仍使用 `agentId` 表示 adapter ID，应在 shared 类型或 API client 边界处做清晰注释，避免 UI 把 Runtime 当作用户可管理 Profile 展示。

## UI 规范

- 通用组件放 `src/ui/`，并从 `src/ui/index.ts` barrel export。
- 每个通用组件应有同目录 `*.test.tsx`；面向展示的组件补 `*.stories.tsx`。
- 样式使用 CSS Modules 和项目 OKLCH token，避免硬编码颜色。
- Desktop 的 Storybook 读取 shared UI story：`cd app/desktop && pnpm storybook`。

## 验证和已知限制

shared 本身没有独立 npm script；当前通过消费者验证：

```powershell
cd D:\Code\TokenDance\AgentHub\app\desktop
pnpm test
pnpm typecheck

cd ..\web
pnpm typecheck
pnpm build
```

已知限制：`app/shared/src/ui` 的 React 类型解析和 pnpm 跨包虚拟存储会影响部分 shared-ui 测试/typecheck。提交或交接时需要区分既有限制和本次新增错误。

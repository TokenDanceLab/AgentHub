# @agenthub/shared

`app/shared/` 是 Desktop 和 Web 工作台的共享类型与工具包。

## 内容

| 模块 | 路径 | 说明 |
|---|---|---|
| `@shared/types` | `src/types.ts` | REST API 响应类型：HealthResponse, Runner, ListResponse, RunInfo |
| `@shared/events` | `src/events.ts` | WebSocket 事件类型与 discriminated union |
| `@shared/errors` | `src/errors.ts` | `api/conventions.md` §5 错误格式解析（AppError, parseError） |

## 使用

Desktop 和 Web 通过 `@shared/*` 路径别名导入：

```typescript
import type { HealthResponse, Runner } from '@shared/types';
import type { EventEnvelope } from '@shared/events';
import { parseError } from '@shared/errors';
```

新增通用类型先放这里，两端一起维护。

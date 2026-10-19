# @agenthub/workbench

端级工作台（workbench shell）：`AgentHubWorkbench` 主壳、GlobalRail/会话侧栏/
右侧 Inspector、UnifiedComposer、WorkbenchRoutes 页面路由、agents/contacts/
docs/projects/tasks/settings 页面、mainchain 状态条、terminal host、floating
组件与 team subagent stream 等。

`workbench` 是端级 shell 层；`shared` 是跨端原语层，
workbench 是端级巨石，两者拆包后依赖方向固定为 **workbench → shared 单向**。

## 目录

根目录只放 shell 与跨域件：`AgentHubWorkbench*`、`WorkbenchFrame*`、
`WorkspaceHeader`、`GlobalRail`、`WorkbenchRoutes`、`index.ts` 入口、图标
registry、preferences/layout、以及 `pages/`、`auxPanel/`、`terminal/`、
`team/`、`floating/`、`mainchain/`、`sessionImport/`、`__tests__/`。

| 目录 | 内容 |
|---|---|
| `composer/` | UnifiedComposer 与其 picker / 附件 / mention / 审批 / dispatch queue 子件、纯 helper |
| `transcript/` | 会话转录与工程列：ConversationHost/Sidebar、ChatViewBridge、transcript chrome、goal banner、mainchain 状态条 |
| `routes/` | 每个 route 的 view + hook + helpers/planners/model（agents、tasks、docs、projects、settings、usage） |
| `inspector/` | 右侧 Inspector 面板、resizer、模式面板、自动展开 hook |

模块与测试同目录；移动文件时改相对导入即可，包外消费者只认
`package.json` 的 exports，不认内部路径。

## 边界

- 依赖方向：`workbench` 可以 import `shared`（深导入走 `@shared/*` 别名，
  与 web/desktop 约定一致）；**shared 永远不得 import workbench**
  （`pnpm lint:boundaries` 的 `no-restricted-imports` 阻塞）。
- 消费者：web / desktop 从 `@agenthub/workbench`（及显式子路径
  `./hubDataMapping`、`./pages`、`./designIcons`、`./desktopChromeEvents`、
  `./WorkbenchRoutes`）导入。
- mobile-rn 不依赖本包（Hub-only，boundary verifier 禁止 workbench 导入）。

## 常用命令

```bash
pnpm --filter @agenthub/workbench test          # vitest 全量
pnpm --filter @agenthub/workbench test:coverage # 覆盖率（门禁同源阈值）
pnpm --filter @agenthub/workbench typecheck     # tsc --noEmit
```

图标治理：workbench 内图标一律走 `designIcons.tsx` registry
（`icon-governance.test.ts` 机器把关，禁止直连 lucide-react/@lobehub/icons
或裸 `<svg>`）。

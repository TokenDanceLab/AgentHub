# v4 旧客户端遗留清单

> 日期：2026-06-07
> 范围：Desktop `5173`、Web `5174`、shared v4 workbench
> 目的：把仍留在源码树里的旧客户端文件定性为 delete / migrate / keep，避免后续 Agent 把旧系统重新接回 active path。

## 结论

Desktop/Web 当前 active UI 入口已经切到 shared v4 workbench：

- Desktop：`app/desktop/src/App.tsx` -> `DesktopChrome` -> `AgentHubWorkbench`
- Web：`app/web/src/App.tsx` -> `AgentHubWorkbench`
- shared：`app/shared/src/workbench/*`

旧 `ChatView`、`PromptInput`、`ThreadPanel`、`RunDetail`、旧 `viewRegistry`、旧 `useChatMessages/useIMChat` 已不应再出现为 active route。剩余风险不是旧主组件本体，而是旧客户端周边层仍在源码树里：旧 views、旧 panels、旧 stores/hooks、旧 Hub message adapter、旧 Diff/Artifact 工具和 Tauri `commands.rs` 巨石。

## 分类

| 分类 | 路径 | 当前状态 | 后续动作 |
|---|---|---|---|
| keep | `app/shared/src/workbench/*` | v4 唯一共享 UI 主线 | 继续按 `agenthub-design/desktop` 1:1 收口 |
| keep | `app/desktop/src/components/DesktopChrome.tsx` | Desktop-only 32px window chrome；5174 不使用 | 保留，但只包裹 Desktop 入口 |
| keep / rename later | `app/desktop/src/api/threadQueries.ts` | 当前 `useDesktopWorkbenchModel()` 仍用它读取 Local Edge threads/items/pins | 保留到 Desktop runtime facade 落地；后续可改名为 `localEdgeThreadQueries.ts` |
| keep / migrate | `app/web/src/platform/*` | 当前 Web v4 Hub-only adapter | 保留；继续用 `verify-web-hub-boundary.ps1` 阻断 Local Edge/Tauri 回流 |
| migrate | `app/web/src/utils/hubAdapters.ts` | 旧 `ChatMessage` 兼容和 runtime evidence 投影仍在 | 把有价值逻辑迁到 `app/shared/src/transcript/*`，再删除 Web-only 旧 adapter |
| migrate | `app/shared/src/types/chat.ts` | 旧 `ChatView.types` 兼容合同 | 只作为迁移层；目标是 `TranscriptBlock` / `EvidenceRef` |
| migrate | Desktop/Web `DiffViewer.tsx` | 旧完整 diff 面板素材；不在 v4 active App 入口 | 将 diff parsing/side-by-side 能力迁到 shared inspector / diff contract 后删除旧组件 |
| migrate | `app/desktop/src/components/ArtifactBrowser.tsx` | 旧 artifact gallery 素材；不在 v4 active App 入口 | 将 artifact preview/list 语义迁到 shared `FilePreview` / inspector 后删除 |
| migrate | `app/desktop/src-tauri/src/commands.rs` | 仍有 832 行、20 个 Tauri command，承载 Edge/fs/git/search/workspace | 按 `host/edge.rs fs.rs git.rs search.rs auth.rs window.rs system.rs` 拆分 |
| delete after migration | `app/desktop/src/views/TeamRunConsole.tsx`、`app/web/src/views/TeamRunConsole.tsx` | 旧 TeamRun/IM console 孤儿页；当前 App 不引用 | 需要的 team runtime event 迁到 shared pages/transcript 后删除 |
| delete after migration | Desktop/Web `components/IM/*` | 主要由旧 `TeamRunConsole` 消费 | 等 TeamRunConsole 删除后一起删除或迁入 shared 新槽位 |
| delete after migration | `HomeDashboard`、`ToolGroup`、`TaskList`、旧 `SettingsPage/AuthPage/WelcomeScreen/StatusBar` 等 Desktop/Web local components | 旧 shell / 旧面板遗留；当前 shared workbench 不应引用 | 确认无 active import 后按批删除 |
| delete after migration | Desktop/Web duplicate stores：`threadStore`、`runStore`、`uiStore`、`searchStore`、`taskBridgeStore` 等 | 旧客户端状态层；服务端状态已转 TanStack Query + platform model | 只迁移 UI preference，服务端状态不得回流到 Zustand |
| exclude from v4 PR | `edge-server/*` dirty files | 后端 pins/store 并行改动 | 独立 backend PR |
| exclude from v4 PR | `app/mobile/*` dirty files | Mobile 并行改动，非本轮 v4 主线 | 独立 mobile PR |

## 旧文件处理顺序

1. **先强化门禁**：继续保留 `scripts/verify-v4-old-ui-active-paths.ps1`，并把新发现的旧 `TeamRunConsole` / old local component active import 加入扫描候选。
2. **先迁数据合同，再删 UI**：把 Web `hubAdapters.ts`、旧 `ChatMessage/FileDiff/MessageBlock` 里仍有价值的投影逻辑迁到 shared transcript / inspector / diff contract。
3. **删除孤儿 views**：TeamRun/IM 能力有 shared 新槽位后，删除 Desktop/Web `views/TeamRunConsole.*` 和只被它使用的 IM 组件。
4. **删除旧 panels**：`ArtifactBrowser`、Desktop/Web `DiffViewer`、`ToolGroup` 等旧展示组件只能在 shared inspector 能力补齐后删除。
5. **拆 Tauri host**：`commands.rs` 不再接收新业务能力；新增能力必须进 `src-tauri/src/host/*`，旧 command 逐步迁为 shim。
6. **PR 拆分**：frontend v4、desktop platform、web platform、docs、backend、mobile 分开确认归属；不要用一个 PR 混进 backend/mobile 并行改动。

## 门禁命令

```powershell
.\scripts\verify-v4-old-ui-active-paths.ps1
.\scripts\verify-web-hub-boundary.ps1
git diff --check
```

生产接入前再补：

```powershell
cd app\desktop; corepack.cmd pnpm typecheck
cd app\web; corepack.cmd pnpm typecheck
cd app\shared; corepack.cmd pnpm exec vitest run src\workbench\AgentHubWorkbench.test.tsx src\workbench\designIcons.test.tsx --reporter=dot
cd app\desktop\src-tauri; cargo test
```

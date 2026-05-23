# AgentHub 路线图

最后更新：2026-05-23

## 当前总目标

Desktop M3 收口——已完成 M2 设计系统+状态管理+渐进展开，M3.1 消息树+DiffViewer。Edge AgentAdapter 已具备完整 NDJSON 协议。Web 前端 5 页面预览壳已上线。

## 当前活跃分支

```
dev/delicious233          ← 主 dev（Delicious233）: Desktop M3 + Edge + 共享
dev/trump                 ← Trump dev: Web 前端 + 同步 Desktop

feat/desktop-sidecar      ← Desktop 工作区 → dev/delicious233
feat/edge-adapters        ← Edge 工作区 → 已合入 dev/delicious233
feat/trump-webui          ← Web 工作区 → dev/trump

feat/frontend-page-preview ← 归档（Trump 旧 HTML mockup）
feat/frontend-webui        ← 归档（Trump 旧分支）
```

合并方向：`feat/* → dev/delicious233 → dev/trump → (review) → dev/delicious233 → master`

## 路线图分层

- 总路线图：`docs/roadmap.md`
- 前端路线图：`docs/roadmaps/frontend.md`
- 后端路线图：`docs/roadmaps/backend.md`
- 客户端路线图：`docs/roadmaps/client.md`
- 分支路线图：`docs/roadmaps/branches/<branch-name>.md`

## 基本原则

- Go 优先：Hub Server、Edge Server 使用 Go。
- 协议简单：REST JSON API + WebSocket typed events 是当前主线。
- UI 使用 React + TypeScript。Desktop 使用 Tauri v2。Web 使用 Vite。
- 设计系统：OKLCH 色彩空间、shadcn 语义 token、3 字号 + 2 字重 + 零阴影。
- 状态管理：Zustand 工厂模式（客户端状态）、WebSocket 事件只做增量。
- Runner 策略：AgentHub 不实现自己的 Agent 架构——Claude Code/Codex/OpenCode 作为 Runner。
- AgentHub 负责：进程管理、工作区隔离、CLI 输出解析、Diff 查看、审批桥接、IM 聊天。

## M2 完成项（Desktop 基础架构）

| 模块 | 内容 | 状态 |
|------|------|------|
| OKLCH tokens.css | hex→OKLCH, 3字号+2字重+零阴影, dark/light 双主题 | ✅ |
| CSS Module 迁移 | 9 文件旧 token→新 OKLCH, srgb→oklch | ✅ |
| Zustand stores | uiStore, connectionStore, threadStore, runStore | ✅ |
| App.tsx 重构 | useState→Zustand selectors | ✅ |
| 渐进展开 L0-L2 | 条件渲染替代 details/summary, ThinkingBlock+ToolUseBlock | ✅ |
| DiffCard 内联 | 文件头+统计+hunk预览, agenthub:open-diff 事件 | ✅ |

## M3 进行中（消息树 + 事件持久化）

| 模块 | 内容 | 状态 |
|------|------|------|
| message-tree | buildTree O(n), flattenActivePath, DIRECT_PATH/INCLUDE_BRANCHES fork | ✅ |
| SiblingSwitch | 分支导航 ← 2/5 → | ✅ |
| DiffViewer | unified diff, 折叠文件头, hunk 渲染 | ✅ |
| EventStore JSONL | 追加写入 + 2MB 快照 + zstd 压缩 | ⏳ |
| Context Builder | 6 步管线 + reserveRatio=0.05 | ⏳ |

## M4 计划

| 模块 | 内容 |
|------|------|
| 权限桥接 | ResolveOnce 竞速：CLI 触发→UI 响应 |
| 工作区隔离 | git worktree per run (Emdash WorktreeHost 模式) |
| Artifact 存储 | 抽象 `ArtifactStorageProvider` 接口，默认 Local 实现，预留 S3/R2/MinIO 等对象存储 backend |
| 文档同步 | system-architecture.md / implementation-guide.md 更新 |
| e2e 收口 | client-smoke.ps1 全链路 |

## 远期：对象存储接入 (S3 / R2 / MinIO)

> M4 只做接口抽象 + Local 实现。S3/R2 具体实现在 artifact 模块成型后接入。

### 接入点

1. **Artifact 内容存储**（优先）：`GET /v1/artifacts/{id}/content` → S3 presigned URL 302 重定向，API 契约已预留
2. **Checkpoint 远程存储**（P2+）：`ContentAddressedStorage` 以 SHA-256 为 key 写入 bucket
3. **Hub 缓存层**（P2+）：Hub Server 用 S3 做 artifact 中转缓存

### 技术选型

- Go SDK：`github.com/minio/minio-go/v7`（完整 S3 兼容，R2 只需改 endpoint）
- Key 策略：content-addressable（SHA-256），幂等上传 + 自动去重
- 本地优先：S3 不可用时自动降级到本地文件存储，保持 P0 离线可用
- 凭证：环境变量注入（`R2_ACCESS_KEY` / `R2_SECRET_KEY`），不进仓库

### 已有设计预留

- `docs/archive/data-plane.md`：`ArtifactLocation` 已定义 `{ type: "object-storage"; url: string }`
- `api/openapi.yaml`：`GET /v1/artifacts/{artifactId}/content` 已预留 302 presigned URL 响应
- `docs/reference/03-build/backend/12-workspace-lifecycle.md`：`ContentAddressedStorage` 内容寻址设计可复用

## Desktop 测试

当前 123/123 单测通过 (Vitest)。覆盖：
- API client / errors / hooks / eventClient（原有 30）
- ChatView / AgentList / PromptInput / ThreadPanel / RunDetail（新增 81）
- useChatMessages（新增 25，含 tool_use 层级嵌套）
- message-tree（新增 12，buildTree/flattenActivePath/fork/cycle detection）

# CloudCLI Source Adoption Map → AgentHub

> 从 CloudCLI (claudecodeui) 源码到 AgentHub Desktop/Web 的精确映射。
> 每项: CloudCLI file:line → AgentHub file:line → 具体变更 → P0/P1/P2。

---

## 1. Plugin System → AgentHub Extension Registry

### 1.1 Manifest 格式

```
CloudCLI: server/utils/plugin-loader.js:9-93
  { name, displayName, entry, version, type ("react"|"module"), slot ("tab"),
    server, permissions: ["fs.read", ...] }
  验证: entry 禁止路径穿越 (..)、禁止绝对路径; type 仅 "react"/"module"; slot 仅 "tab"

AgentHub: 无插件系统。Edge Server 的 AgentAdapter Registry 仅管理 agent 后端，无前端扩展机制。
```

**建议 P0**: 引入 `PluginManifest` 格式作为 AgentHub 的扩展注册标准。直接复用 `{name, displayName, entry, server, slot, permissions}` 字段。`slot` 类型需扩展为 `["tab", "sidebar", "toolbar", "overlay"]` 以支持比 CloudCLI 更丰富的嵌入点。

```go
// hub-server/internal/api/plugins.go 新增
type PluginManifest struct {
    Name        string   `json:"name"`
    DisplayName string   `json:"displayName"`
    Entry       string   `json:"entry"`
    Server      string   `json:"server,omitempty"`
    Slot        string   `json:"slot"`        // tab | sidebar | toolbar
    Permissions []string `json:"permissions"`  // fs.read, api.call, ...
}
```

### 1.2 子进程 Ready 协议

```
CloudCLI: server/utils/plugin-process-manager.js:15-105
  spawn node <server-entry> → stdout 输出 {"ready":true,"port":<number>} → 宣告就绪
  10s 超时无 ready → kill
  停止: SIGTERM (5s 后 SIGKILL)

AgentHub: app/desktop/src-tauri/src/edge_manager.rs:33-52
  EdgeManager.start() → Command::new(edge_path).spawn()
  无 ready 协商协议，仅检查 child.is_some()。
```

**建议 P1**: 在 `EdgeManager` 中引入 ready 协商。子进程启动后在 stdout 输出 JSON `{"ready":true,"port":3210}`，EdgeManager 在超时前等待此信号，超时后 kill 并返回诊断错误。

### 1.3 原子安装 (tmp + rename)

```
CloudCLI: server/utils/plugin-loader.js:250-368
  installPluginFromGit():
    1. clone 到 .tmp-<name>- 临时目录 (scanPlugins 跳过 tmp- 前缀)
    2. npm install --ignore-scripts (防 postinstall 攻击)
    3. npm run build (60s 超时)
    4. fs.renameSync 从临时目录移到正式位置

AgentHub: 无插件安装流程。
```

**建议 P2**: 在插件安装逻辑中实现原子化：先下载到 `.tmp-` 目录，验证完成后 rename 到正式位置。

---

## 2. Provider Registry 模式 → AdapterRegistry

### 2.1 IProviderSessionSynchronizer 接口

```
CloudCLI: server/modules/providers/list/claude/claude-session-synchronizer.provider.ts:33-37
  interface IProviderSessionSynchronizer {
      synchronize(since?: number): Promise<ProcessedSessionResult>
      synchronizeFile(filePath: string): Promise<ProcessedSessionResult>
  }
  Promise.allSettled 并行调用所有 provider

AgentHub: edge-server/internal/adapters/registry.go:1-92
  type Registry struct { adapters map[string]AgentAdapter }
  Register / Get / List / SetDefault / Resolve
```

**差异**: CloudCLI 的 Provider 是 CLI session 发现层（扫描 JSONL 文件发现历史对话）。AgentHub 的 Registry 是 adapter 运行时注册。两者职责不同，但接口抽象模式可以直接复用。

**建议 P1**: 在 hub-server 中引入 `SessionDiscoveryProvider` 接口，用于自动发现用户已有的 CLI session 历史。

```go
// hub-server/internal/session/discovery.go 新增
type SessionDiscoveryProvider interface {
    Discover(ctx context.Context, since *time.Time) ([]DiscoveredSession, error)
}
```

### 2.2 JSONL 增量扫描

```
CloudCLI: server/shared/utils.ts:629+
  findFilesRecursivelyCreatedAfter(dir, ext, since) → 递归遍历, mtime > since
  extractFirstValidJsonlData() → 从 JSONL 提取第一条有效数据
  buildLookupMap() → 读取 history.jsonl 构建 display name 映射

AgentHub: 无 session 发现。所有 session 由 API 显式创建。
```

**建议 P2**: 实现 Claude session JSONL 扫描器。路径 `~/.claude/projects/<project>/*.jsonl`，按 mtime 过滤增量，提取 sessionId + cwd + firstUserText。

---

## 3. Git Panel → AgentHub Git 能力

### 3.1 14 端点 Git API

```
CloudCLI: server/routes/git.js (1494 行)
  status / diff / commit / branches / checkout / create-branch / delete-branch /
  commits / commit-diff / generate-commit-message / remote-status /
  fetch / pull / push / publish / discard / delete-untracked

AgentHub: 无 Git API。Agent 通过 CLI 的 Bash tool 操作 Git，无专用 API。
```

**建议 P1**: 在 hub-server 中新增 Git API 端点。优先实现 `status / diff / commit / branches / pull / push` 6 个核心端点。所有路径参数通过 DB projectId 解析，防路径穿越。

### 3.2 AI 生成 Commit Message

```
CloudCLI: server/routes/git.js:920-1013
  generate-commit-message:
    - Prompt 指定 conventional commit 格式
    - 支持 Claude SDK 和 Cursor CLI 两种 provider
    - 响应清洗: 移除 markdown code blocks → 匹配 conventional commit 正则截取
    - 降级: AI 失败时返回 "chore: update N files"

AgentHub: edge-server/internal/adapters/orchestrator.go:72-95
  DefaultOrchestratorPrompt 是协调器 system prompt，具备任务分解能力但无 Git commit 专用 prompt。
```

**建议 P1**: 在 hub-server 中实现 `POST /api/git/generate-commit-message`。使用已有的 Claude Code adapter 作为 provider，注入 conventional commit prompt 模板。复用 CloudCLI 的响应清洗逻辑（移除 markdown fences + 正则截取）。

---

## 4. Mobile UI Patterns → AgentHub Web

### 4.1 visualViewport 键盘适配

```
CloudCLI: src/components/app/AppContent.tsx:125-138
  useEffect(() => {
      vv.addEventListener('resize', () => {
          document.documentElement.style.setProperty(
              '--keyboard-height', `${Math.max(0, window.innerHeight - vv.height)}px`
          );
      });
  }, []);

AgentHub: app/web/src/App.tsx
  无 iOS 键盘适配逻辑。
```

**建议 P2**: 在 Web App 根组件中加入 visualViewport 键盘适配。仅 13 行代码，零外部依赖，解决 iOS Safari/WebView 输入框被键盘遮挡问题。

### 4.2 Drawer Overlay 移动端侧边栏

```
CloudCLI: src/components/app/AppContent.tsx:147-172
  移动端: fixed inset-0 z-50 overlay + backdrop blur + touch 关闭
  宽度 85vw (max-w-sm 384px), 150ms ease-out transition

AgentHub: app/web/src/components/
  无移动端侧边栏 drawer 覆盖层。
```

**建议 P2**: 在 Web App 中实现移动端 drawer 侧边栏。关键要素：backdrop overlay + touch 事件关闭 + translate-x 滑入动画。

---

## 5. Session 双缓存策略

### 5.1 serverMessages + realtimeMessages → merged

```
CloudCLI: src/stores/useSessionStore.ts
  serverMessages (REST API) + realtimeMessages (WebSocket) → merged (去重合并)
  去重: 按 id 去重; 相邻相同文本的 assistant echo 合并 (行 138-166)
  Optimistic local: 用户消息先以 local_ 前缀 ID 写入 realtime
  流式更新: 🍡-streaming_<sessionId> well-known ID
  过期: 30s STALE_THRESHOLD_MS 触发刷新

AgentHub: app/web/src/state/ (Zustand stores)
  前端直接消费 WebSocket 事件流，无 REST fallback 缓存层。
```

**建议 P2**: 引入 REST API session 数据回填作为 WebSocket 流式数据的补充。WebSocket 断连时用 REST 拉缺失的事件。

---

## 6. Tauri EdgeManager → Plugin 进程管理

### 6.1 EdgeManager 子进程管理

```
CloudCLI: server/utils/plugin-process-manager.js:111-136
  stopPluginServer(name):
    1. SIGTERM → 等待 5s
    2. 仍未退出 → SIGKILL force kill
    3. 清理 port/child 记录

AgentHub: app/desktop/src-tauri/src/edge_manager.rs:55-70
  stop(): child.kill().await → child.wait().await
  直接 kill，无优雅关闭等待期。
```

**建议 P2**: 在 `EdgeManager.stop()` 中增加两段式关闭：先 SIGTERM 优雅退出（5s 超时），超时后 SIGKILL。防止 agent 进程数据未持久化就被强杀。

---

## 摘要：实现优先级

| # | 发现 | 优先级 | 涉及 AgentHub 文件 |
|---|------|--------|-------------------|
| 1 | 插件 Manifest 格式引入 | **P0** | 新增 `hub-server/api/plugins.go` |
| 2 | Provider Registry session 发现 | **P1** | 新增 `hub-server/session/discovery.go` |
| 3 | 子进程 Ready 协商协议 | **P1** | `app/desktop/src-tauri/src/edge_manager.rs` |
| 4 | Git API 核心端点 | **P1** | 新增 `hub-server/api/git.go` |
| 5 | AI 生成 Commit Message | **P1** | 新增 `hub-server/api/git.go` |
| 6 | JSONL 增量 session 扫描 | **P2** | `hub-server/session/discovery.go` |
| 7 | visualViewport 键盘适配 | **P2** | `app/web/src/App.tsx` |
| 8 | Drawer overlay 移动端侧边栏 | **P2** | `app/web/src/components/` |
| 9 | Session 双缓存 (REST + WS) | **P2** | `app/web/src/state/` |
| 10 | 两段式进程关闭 | **P2** | `app/desktop/src-tauri/src/edge_manager.rs` |

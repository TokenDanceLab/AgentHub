# CloudCLI 深度调研报告

> 来源仓库: [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui) (aka CloudCLI)
> 调研日期: 2026-05-21
> 版本: 主线 HEAD (npm `@cloudcli-ai/cloudcli`)

---

## 1. 产品设计与移动端借鉴

### 1.1 响应式布局架构

CloudCLI 使用 **单一断点策略**，以 `768px` 为移动/桌面分界线。

```typescript
// src/hooks/useDeviceSettings.ts:9-15
const getIsMobile = (mobileBreakpoint: number): boolean => {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < mobileBreakpoint;
};
```

移动端侦测通过 `useDeviceSettings` hook（默认 breakpoint `768`）注入整个组件树，`src/App.tsx:41` 处 `AppContent` 将 `isMobile` 一路传递到 `Sidebar`、`MainContent`、`ChatInterface`、`GitPanel` 等所有 UI 组件。

### 1.2 移动端侧边栏（Drawer Pattern）

桌面端侧边栏用 `flex-shrink-0 border-r` 常驻左侧 (`src/components/app/AppContent.tsx:143-145`)；移动端转为 **overlay drawer**：

```tsx
// src/components/app/AppContent.tsx:147-172
// 移动端: 固定定位 overlay，translate 动画滑入
<div className={`fixed inset-0 z-50 flex transition-all duration-150 ease-out
  ${sidebarOpen ? 'visible opacity-100' : 'invisible opacity-0'}`}>
  <button className="fixed inset-0 bg-background/60 backdrop-blur-sm"
    onClick={() => setSidebarOpen(false)}
    onTouchStart={(e) => { e.preventDefault(); setSidebarOpen(false); }} />
  <div className="relative h-full w-[85vw] max-w-sm transform border-r border-border/40 bg-card
    transition-transform duration-150 ease-out sm:w-80
    ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}">
    <Sidebar {...sidebarSharedProps} />
  </div>
</div>
```

关键要点：
- **Backdrop overlay** + touch 事件同时支持，click 和 touch 都触发关闭
- 宽度 85vw 上限 max-w-sm (384px)，兼顾小屏与平板
- 过渡动画 150ms ease-out，无拖拽手势

### 1.3 PWA 支持

- `src/hooks/useDeviceSettings.ts:17-29` -- 检测 `display-mode: standalone` + iOS `navigator.standalone` + `android-app://` referrer
- `src/components/sidebar/view/Sidebar.tsx:130-137` -- 全局 CSS class `pwa-mode` 切换
- `public/manifest.json` + `public/sw.js` -- 完整 PWA manifest + Service Worker

### 1.4 iOS 虚拟键盘适配

```typescript
// src/components/app/AppContent.tsx:125-138
useEffect(() => {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const kb = Math.max(0, window.innerHeight - vv.height);
    document.documentElement.style.setProperty('--keyboard-height', `${kb}px`);
  };
  vv.addEventListener('resize', update);
  return () => vv.removeEventListener('resize', update);
}, []);
```

通过 Visual Viewport API 计算键盘高度并设为 CSS 变量，根容器 `bottom: var(--keyboard-height, 0px)` 确保输入框不被键盘遮挡。仅监听 `resize` 而不监听 `scroll`，避免滑动内容时输入框跳动。

### 1.5 多 Session 管理界面

侧边栏 (`src/components/sidebar/view/Sidebar.tsx`) 采用 **Project > Session 二级结构**：

1. 按项目分组，每个项目展开后显示 session 列表
2. 支持 session 重命名、删除确认、分页加载更多
3. 搜索功能支持按 `conversationResults` 搜索内容，直接跳转到命中 session
4. 已归档项目/会话分离视图 (`archivedProjects` / `archivedSessions`)
5. `isSidebarCollapsed` 支持最小化侧边栏（仅图标 + 徽章）

主内容区 (`src/components/main-content/view/MainContent.tsx`) 通过 Tab 切换 Chat / Files / Shell / Git / Tasks / Plugin:
- 移动端 Tab 使用水平可滚动容器 (`MainContentHeader.tsx:53-63`)
- 滚动边缘使用渐隐遮罩 (`bg-gradient-to-r from-background to-transparent`)

### 1.6 对 AgentHub 的设计建议

1. **复用 Drawer Pattern**: 移动端侧边栏 overlay + backdrop blur + touch 关闭的模式可直接搬用
2. **visualViewport 键盘适配**: iOS WebView 必选项，代码仅 13 行，依赖零外部库
3. **PWA 准备好**: manifest + sw 骨架可在初期就加入，不影响 Web 版使用
4. **768px 断点足够**: 无需多级断点（md/lg/xl），单断点大幅简化组件逻辑

---

## 2. 插件系统架构

### 2.1 总体架构

插件系统由三层组成：

| 层 | 文件 | 职责 |
|---|------|------|
| Manifest & 扫描 | `server/utils/plugin-loader.js` | manifest 解析、安装、更新、卸载 |
| 进程管理 | `server/utils/plugin-process-manager.js` | 子进程启停、端口发现、生命周期 |
| API 路由 | `server/routes/plugins.js` | REST API (CRUD + RPC 代理) |
| 前端 Context | `src/contexts/PluginsContext.tsx` | React 状态管理 |
| 前端容器 | `src/components/plugins/view/PluginTabContent.tsx` | 动态加载插件 JS 并挂载 |

### 2.2 Manifest 格式与验证

**存储位置**: `~/.claude-code-ui/plugins/<plugin-dir>/manifest.json`
**配置**: `~/.claude-code-ui/plugins.json`

**Manifest 结构** (`server/utils/plugin-loader.js:9-93`):

```json
{
  "name": "my-plugin",          // 必填，正则 ^[a-zA-Z0-9_-]+$
  "displayName": "My Plugin",   // 必填，UI 显示名
  "entry": "index.js",          // 必填，前端入口，相对路径（禁止 .. 和绝对路径）
  "version": "1.0.0",           // 可选，默认 "0.0.0"
  "description": "...",         // 可选
  "author": "...",              // 可选
  "icon": "Puzzle",             // 可选，默认 "Puzzle"（Lucide 图标名）
  "type": "react",              // 可选，默认 "module"。可选: "react" | "module"
  "slot": "tab",                // 可选，默认 "tab"。当前仅 "tab"
  "server": "server.js",        // 可选，后端子进程入口
  "permissions": ["fs.read"]    // 可选，字符串数组
}
```

**验证规则** (`plugin-loader.js:52-94`):
- 必填字段: `name`(字母/数字/连字符/下划线), `displayName`, `entry`
- `entry` 禁止路径穿越 (`..`) 和绝对路径 (行 77)
- `server` 同规则 (行 81-85)
- `type` 仅允许 `react` 或 `module` (行 23)
- `slot` 仅允许 `tab` (行 24)
- `permissions` 必须为字符串数组 (行 87-91)

### 2.3 Slot 机制

当前版本 slot 类型仅 `"tab"` (`ALLOWED_SLOTS`, 行 24)。插件在侧边栏 Tab 条中以新标签页形式出现。

前端通过 **动态 import** 加载插件 JS (`PluginTabContent.tsx:90`):

```typescript
// 通过 Blob URL 动态导入（绕过 Vite 编译，保持动态性）
const jsText = await res.text();
const blob = new Blob([jsText], { type: 'application/javascript' });
const blobUrl = URL.createObjectURL(blob);
const mod = await import(/* @vite-ignore */ blobUrl);
```

插件通过 `mount(container, api)` / `unmount(container)` 生命周期函数与宿主交互。

### 2.4 插件 API（宿主注入）

`src/components/plugins/view/PluginTabContent.tsx:95-115`:

```typescript
const api = {
  get context(): PluginContext { return contextRef.current; },
  onContextChange(cb: (ctx: PluginContext) => void): () => void { ... },
  async rpc(method, path, body): Promise<unknown> { ... }
};
```

- `context` 包含 `theme`(dark/light)、`project`(name + path)、`session`(id + title)
- `onContextChange` 订阅主题/项目/会话变化
- `rpc` 代理到插件后端子进程 (`/api/plugins/:name/rpc/*`)，注入 per-plugin secrets 作为 `X-Plugin-Secret-*` 头

### 2.5 进程管理

`server/utils/plugin-process-manager.js`:

- **启动**: `startPluginServer()` (行 15-105) -- spawn `node <server-entry>`，子进程通过 stdout 输出 JSON 行 `{"ready":true,"port":<number>}` 来宣告就绪
- **超时**: 10s 未收到 ready 信号则 kill (行 44-50)
- **并发控制**: `Map<name, Promise>` 防止重复启动 (行 21-23)
- **停止**: SIGTERM (5s 后 SIGKILL force kill) (行 111-136)
- **环境隔离**: 仅注入 `PATH`、`HOME`、`NODE_ENV`、`PLUGIN_NAME`，不泄露宿主 secrets (行 32-37)
- **启动引导**: `startEnabledPluginServers()` (行 167-184) 在服务器启动时自动启动所有 enabled + 有 server entry 的插件

### 2.6 安装流程

`plugin-loader.js` 的 `installPluginFromGit()` (行 250-368):

1. 从 URL 提取 repo 名，验证合法性 (行 260-265)
2. 路径穿越检查 (`targetDir.startsWith(pluginsDir + path.sep)`) (行 271-273)
3. 存在性检查 -- 不允许重复安装 (行 275-277)
4. **原子安装**: 先 clone 到 `.tmp-<name>-` 临时目录，scanPlugins 会跳过 `tmp-` 前缀目录 (行 162, 280)
5. `git clone --depth 1` (行 296-298)
6. Manifest 验证 (行 309-335)
7. 名称去重检查 (行 331-335)
8. `npm install --ignore-scripts`（防 postinstall 攻击）(行 341)
9. `npm run build`（如 package.json 有 build script，60s 超时）(行 96-143, 351)
10. `fs.renameSync` 从临时目录移到正式位置 (行 288)

### 2.7 RPC 代理

`server/routes/plugins.js:207-283` 实现 `ALL /:name/rpc/*`:
- 懒启动: 如插件 server 未运行，先 `startPluginServer`
- 注入 per-plugin secrets 为 `x-plugin-secret-<key>` 请求头 (行 244-246)
- 代理到 `127.0.0.1:<port>/<rpcPath>` (行 251-257)
- 502/503 错误状态码区分

### 2.8 对 AgentHub 的建议

1. **Manifest 设计**: 直接复用 `{name, displayName, entry, server, slot, permissions}` 格式，字段精炼
2. **Slot 扩展**: CloudCLI 仅有 `tab`，AgentHub 可增加 `sidebar`、`toolbar`、`overlay` 等 slot
3. **原子安装**: tmp 目录 + rename 模式保证 `scanPlugins` 不会看到半成品 -- 适用于插件市场下载场景
4. **进程超时**: 10s ready 超时 + 5s SIGTERM → SIGKILL 两段式关闭是成熟模式
5. **RPC 代理**: 简单的 `http.request` proxy 比引入 gRPC/WebSocket 代理轻量得多，适用于插件调后端

---

## 3. CLI Session 同步机制

### 3.1 整体架构

```
Provider Registry (provider.registry.ts)
    └─ IProvider.sessionSynchronizer: IProviderSessionSynchronizer
          ├─ ClaudeSessionSynchronizer
          ├─ CursorSessionSynchronizer
          ├─ CodexSessionSynchronizer
          └─ GeminiSessionSynchronizer
                └─ sessionSynchronizerService.synchronizeSessions()
                      └─ projectsDb / sessionsDb (SQLite)
```

### 3.2 Claude Session 自动发现

文件: `server/modules/providers/list/claude/claude-session-synchronizer.provider.ts`

**路径**: 扫描 `~/.claude/projects/` 目录下所有 `.jsonl` 文件

```typescript
// claude-session-synchronizer.provider.ts:33-37
const files = await findFilesRecursivelyCreatedAfter(
  path.join(this.claudeHome, 'projects'),  // ~/.claude/projects/
  '.jsonl',                                // 扩展名过滤
  since ?? null                            // 增量时间戳
);
```

**核心工具函数** (`server/shared/utils.ts:629+`):
- `findFilesRecursivelyCreatedAfter()` 递归遍历目录，返回在 `lastScanAt` 之后修改的 JSONL 文件
- `buildLookupMap()` 读取 `~/.claude/history.jsonl` 构建 session display name 映射
- `extractFirstValidJsonlData()` 从 JSONL 中提取第一条有效数据

**Session 元数据提取** (`claude-session-synchronizer.provider.ts:91-132`):
- `sessionId`: 从 JSONL 第一条记录的 `data.sessionId` 字段提取
- `projectPath`: 从 `data.cwd` 字段提取
- `sessionName`: 优先从 `history.jsonl` 的 `display` 字段获取，其次从 JSONL 末尾的 `ai-title` / `last-prompt` / `customTitle` 事件提取

**Session 名称提取策略** (行 134-175):
1. 从文件末尾反向扫描 JSONL 行
2. 查找 `type === 'ai-title'` (含 `aiTitle` 字段) 或 `type === 'last-prompt'` (含 `lastPrompt` 字段) 或 `type === 'custom-title'` (含 `customTitle` 字段)
3. 根据会话 ID (`sessionId`) 匹配

### 3.3 同步调度

`synchronizeSessions()` (`session-synchronizer.service.ts:17-57`):
1. 从 `scanStateDb` 读 `last_scanned_at` 时间戳
2. `Promise.allSettled` 并行调用所有 provider 的 `synchronize()`
3. 仅在所有 provider 成功时才更新 `last_scanned_at`
4. 返回 `{ processedByProvider, failures }`

**时序**: 每次 `GET /api/projects` (前端加载项目列表) 时触发:
```typescript
// projects-with-sessions-fetch.service.ts:210
if (!options.skipSynchronization) {
  await sessionSynchronizerService.synchronizeSessions();
}
```

### 3.4 前端 Session Store

`src/stores/useSessionStore.ts` 实现纯内存 session-keyed 消息存储:

- **三层数据**: `serverMessages`(REST API) + `realtimeMessages`(WebSocket) → `merged`(去重合并)
- **去重策略**: 按 `id` 去重; 相邻相同文本的 assistant echo 合并 (行 138-166)
- **Optimistic local**: 用户消息先以 `local_` 前缀 ID 写入 realtime，服务端同步后去重
- **流式更新**: `updateStreaming()` 通过 `__streaming_<sessionId>` well-known ID 实时更新流式文本
- **过期策略**: 30s 阈值 (`STALE_THRESHOLD_MS`)，超过后标记为 stale 触发刷新
- **Session Alias**: `sessionAliasesRef` 支持 session ID 迁移时的别名映射
- **无 localStorage**: 所有消息数据仅存内存，JSONL 为 SSOT

### 3.5 对 AgentHub 的建议

1. **Provider Registry 模式**: 接口 `IProviderSessionSynchronizer` 统一抽象，新增 CLI 工具只需实现 `synchronize` + `synchronizeFile` 两个方法
2. **增量扫描**: `since` 参数 + `last_scanned_at` 时间戳避免每次全量扫描，对大量项目关键
3. **Promise.allSettled**: 单个 provider 失败不影响其他 -- 关键容错模式
4. **Session 命名**: 反向扫描 JSONL 找 AI 生成标题的策略比纯用首条消息摘要智能得多
5. **SSOT**: JSONL 为唯一事实源，前端内存仅做缓存 -- AgentHub 可对齐此原则

---

## 4. Git/文件树前端实现

### 4.1 Git Panel 架构

**路由层** (`server/routes/git.js`, 1494 行):
API 端点完整覆盖 Git 工作流：

| 端点 | 方法 | 功能 |
|------|------|------|
| `/git/status` | GET | 获取工作区状态 (modified/added/deleted/untracked) |
| `/git/diff` | GET | 单文件 diff (区分 untracked/deleted 用 /dev/null 模拟) |
| `/git/file-with-diff` | GET | 文件当前内容 + HEAD 旧内容 (用于 CodeEditor 对比) |
| `/git/commit` | POST | 暂存指定文件并提交 |
| `/git/revert-local-commit` | POST | 撤销最近一次本地提交 (soft reset，保留变更在 stage) |
| `/git/branches` | GET | 本地 + 远程分支列表 (去重) |
| `/git/checkout` | POST | 切换分支 |
| `/git/create-branch` | POST | 创建并切换分支 |
| `/git/delete-branch` | POST | 删除本地分支 (防当前分支删除) |
| `/git/commits` | GET | 最近 N 条 commit (带 stat) |
| `/git/commit-diff` | GET | 单条 commit 的 diff (50万字符截断限制) |
| `/git/generate-commit-message` | POST | AI 生成 conventional commit 消息 (Claude SDK / Cursor CLI) |
| `/git/remote-status` | GET | ahead/behind 计数 + 智能远程检测 |
| `/git/fetch` | POST | fetch |
| `/git/pull` | POST | pull (含冲突/未暂存变更等错误分类) |
| `/git/push` | POST | push (含 rejected/non-fast-forward/认证失败等错误分类) |
| `/git/publish` | POST | 设置 upstream 并 push |
| `/git/discard` | POST | 根据文件状态 (??/M/D/A) 自动选择 restore/reset/删除 |
| `/git/delete-untracked` | POST | 删除未追踪文件/目录 (仅限 ?? 状态) |

**安全特性**:
- 所有路径参数均验证防穿越 (`validateFilePath` + `path.resolve` + `startsWith` 检查，行 65-79)
- commit/branch/remote 名称正则校验 (`/^[a-zA-Z0-9._~^{}@\/-]+$/` 等，行 50-86)
- 路径解析使用 DB `projectId` 查表 (`getActualProjectPath`, 行 113-119)，不依赖客户端传路径

**AI 生成 Commit 消息** (行 920-1013):
- Prompt 指定 conventional commit 格式
- 支持 Claude SDK 和 Cursor CLI 两种 provider
- 响应清洗: 移除 markdown code blocks、headers、引号，匹配 conventional commit 模式截取
- 降级: AI 失败时返回 `"chore: update N files"`

### 4.2 Git Panel 前端

**组件树** (`src/components/git-panel/`):
```
GitPanel.tsx
  ├─ GitPanelHeader        -- 分支名、操作按钮 (fetch/pull/push/revert)
  ├─ GitViewTabs           -- Changes / History / Branches 三视图切换
  ├─ ChangesView           -- 文件变更列表 + diff 预览
  ├─ HistoryView           -- commit 历史 + commit diff
  ├─ BranchesView          -- 本地/远程分支管理
  ├─ GitRepositoryErrorState -- 非 Git 仓库的错误提示
  └─ ConfirmActionModal    -- 危险操作确认弹窗
```

**关键 hooks**:
- `useGitPanelController` -- 统筹所有 Git 状态和数据拉取
- `useRevertLocalCommit` -- 撤销提交封装

**移动端适配**: 所有子组件接收 `isMobile` prop (`GitPanel.tsx:14`)，传递到 ChangesView/HistoryView/BranchesView

**Error 处理**: `gitStatus.error` 存在时显示 `GitRepositoryErrorState`（如 "Not a git repository" 时引导用户做 initial commit）

### 4.3 文件树 (FileTree)

**组件树** (`src/components/file-tree/`):
```
FileTree.tsx
  ├─ FileTreeHeader           -- 搜索 + 视图切换 + 新建/刷新
  ├─ FileTreeDetailedColumns  -- 详细视图列头
  ├─ FileTreeBody             -- 文件列表（树形/详细/紧凑三种视图）
  │   ├─ FileTreeDirectory    -- 目录节点（展开/折叠）
  │   └─ FileTreeItem         -- 文件节点
  ├─ FileTreeLoadingState     -- 加载骨架屏
  ├─ ImageViewer              -- 图片预览弹窗
  └─ 删除确认 Dialog          -- 内联 Confirm 弹窗
```

**核心 hooks**:
- `useFileTreeData` -- `api.getFiles(projectId)` 获取文件树 JSON
- `useFileTreeSearch` -- 搜索过滤 + 自动展开命中目录
- `useFileTreeOperations` -- 新建/重命名/删除/下载/复制路径
- `useFileTreeUpload` -- 拖拽上传（dragenter/dragover/dragleave/drop + 蓝色 overlay）
- `useFileTreeViewMode` -- 树形/详细/紧凑视图切换
- `useExpandedDirectories` -- 目录展开/折叠状态

**文件树与 Git 的钩子解耦**:
- FileTree 和 GitPanel 通过**共同的 `selectedProject`** 独立工作
- FileTree 取 `selectedProject.projectId` 调 `/api/projects/:id/files`
- GitPanel 取 `selectedProject.projectId` 调 `/api/git/status?project=:id`
- 两者无直接数据依赖，仅在 `MainContent` 层通过 `activeTab` 切换
- 代码编辑器通过 `useEditorSidebar` hook 独立管理，以 `editingFile` 状态驱动

**文件图标系统** (`src/components/file-tree/constants/fileIcons.ts`):
- 基于文件扩展名匹配 Lucide 图标 + 颜色
- `getFileIconData()` 返回 `{icon, color}`，统一尺寸 `ICON_SIZE_CLASS`

### 4.4 对 AgentHub 的建议

1. **Git API 设计**: 14 个端点覆盖完整 Git 工作流，security-first（所有参数验证 + 防穿越 + DB projectId 解析），直接参考端点和验证模式
2. **AI Commit 生成**: `generate-commit-message` 模式是"用 Agent 辅助 Git 操作"的范例，AgentHub 的 Git 能力应内置此功能
3. **错误分类**: `pull`/`push` 返回细分错误类型（冲突/未暂存/网络/认证/分支分叉），前端可按类型显示不同 UI -- 这对用户体验提升极大
4. **文件树与 Git 解耦**: FileTree 和 GitPanel 通过同一 projectId 独立工作，互不污染；其中 `useFileTreeData` 的 `abortController` + `isActive` 模式防止竞态 -- 对多面板架构是标准做法
5. **视图模式**: 树形/详细列/紧凑三种视图提供不同密度选择，详细列模式尤其适合大项目

---

## 5. 对 AgentHub 的具体建议

### 5.1 产品设计

| 建议 | 优先级 | 理由 |
|------|--------|------|
| 单断点 768px 响应式 | 高 | 简化组件逻辑，足够覆盖手机/平板/桌面 |
| Drawer Overlay 移动端侧边栏 | 高 | 代码简洁 (20 行)，体验成熟 |
| visualViewport 键盘适配 | 高 | iOS 必选，仅 13 行代码 |
| PWA manifest + SW | 中 | 初期加入成本低 |
| Project > Session 二级侧边栏 | 高 | 已验证的多项目多会话管理模式 |
| Tab 切换 + 可滚动 Tab 条 | 中 | 适合移动端 Tab 溢出场景 |

### 5.2 插件系统

| 建议 | 优先级 | 理由 |
|------|--------|------|
| 复用 Manifest 格式 | 高 | `{name, displayName, entry, server, slot, permissions}` 已成为事实标准 |
| 扩展 Slot 类型 | 中 | CloudCLI 仅有 `tab`，可增加 `sidebar`、`toolbar`、`overlay` |
| 原子安装 (tmp + rename) | 高 | 避免扫描到半成品插件 |
| 子进程 ready 协议 | 高 | JSON 就绪信号 + 超时 + SIGTERM/SIGKILL 两段关闭 |
| 动态 import via Blob URL | 中 | 绕过 bundler 编译，保持插件动态性 |
| RPC HTTP 代理 | 高 | 比 gRPC/WS 代理轻量，投入产出比高 |
| per-plugin secrets 注入 | 中 | `X-Plugin-Secret-*` header 模式干净 |

### 5.3 CLI 自动发现

| 建议 | 优先级 | 理由 |
|------|--------|------|
| IProviderSessionSynchronizer 接口 | 高 | 新增 CLI 工具仅需实现 2 个方法 |
| Provider Registry 模式 | 高 | 运行时注册，Promise.allSettled 容错 |
| 增量扫描 (since + lastScanAt) | 高 | 避免每次全量扫 `~/.claude/projects/` |
| JSONL 为 SSOT | 高 | 前端只做缓存，不存储到 localStorage |
| AI 生成 Session 标题 | 中 | 反向扫描 JSONL 末尾的 title 事件 |

### 5.4 Git 与文件树

| 建议 | 优先级 | 理由 |
|------|--------|------|
| 14 端点 Git API 完整覆盖 | 高 | 状态/diff/commit/branch/remote/push/pull/discard 全套 |
| Security-first 参数验证 | 高 | 防路径穿越 + 正则校验 + DB projectId 解析 |
| AI 生成 Commit Message | 高 | AgentHub 的自有 Agent 可原生提供此功能 |
| 细分错误类型 | 中 | pull/push 错误按类型返回不同 UI |
| FileTree / GitPanel 钩子解耦 | 高 | 通过共同 projectId 独立工作，不相互依赖 |
| 三种文件树视图 | 低 | 树形/详细/紧凑，可按需实现 |

### 5.5 架构关键模式总结

1. **Provider 抽象层**: `IProvider` 接口统管 auth/mcp/skills/sessions/synchronizer 五个维度，新增 CLI 工具即插即用
2. **Session 双缓存策略**: serverMessages(REST) + realtimeMessages(WS) → merged(去重)，兼顾实时性和持久性
3. **JSONL SSOT**: 所有 session 数据以 CLI 原生的 JSONL 为准，前端仅做展示缓存
4. **Plugin RPC Proxy**: 简单的 HTTP 反向代理替代复杂的进程间通信协议
5. **移动端渐进增强**: isMobile boolean 贯穿所有组件，移动/桌面用同一套代码

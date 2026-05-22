# AgentHub 数据面

日期：2026-05-21

## 原则

控制面决定应该发生什么。数据面提供大流量或延迟敏感的资源。

AgentHub 不能让 UI 直接访问任意远程 Runner 进程。

```text
UI -> 最近的 Edge
UI -> Local Runner Fast Path，仅在 Edge 授权时
UI -> Hub proxy 兜底
```

## 访问规则

1. UI 不直接访问远程 Runner。
2. UI 只能在同机 Desktop 模式下访问 Local Runner。
3. Local Runner Fast Path 需要 Edge 签发的短期 token。
4. 远程 Desktop 和 Cloud 的数据面必须经过 Remote Edge 或 Hub proxy。
5. Web/Mobile 访问始终从 Hub 开始。

## Local Fast Path

Local Fast Path 是一种优化，不是另一种权威模型。

```text
Desktop UI -> Edge
Edge -> 短期 token
Desktop UI -> Local Runner data endpoint
```

允许的资源：

- 实时 stdout/stderr 流
- 本地 preview iframe
- diff 文件读取
- 小 artifact 下载

禁止的资源：

- 未经 Edge 审批的任意 workspace 路径读取
- 命令执行
- 远程 Runner 访问
- 长期 bearer token 重用

## Preview 路由

```ts
type PreviewRoute =
  | { mode: "local"; url: "http://127.0.0.1:5173" }
  | { mode: "direct"; url: "http://100.x.x.x:5173" }
  | { mode: "ssh-tunnel"; localUrl: "http://127.0.0.1:5173" }
  | { mode: "hub-proxy"; url: "https://hub.example.com/preview/run_123" }
```

| 场景 | Preview 路由 |
|---|---|
| Desktop local | `local` |
| Desktop -> SSH remote | `ssh-tunnel` |
| Desktop -> Tailscale remote | `direct`，经 Remote Edge |
| Desktop -> Hub relay remote | `hub-proxy` 或 Remote Edge proxy |
| Web -> Desktop | `hub-proxy` |
| Web -> Cloud | `hub-proxy` 或 Cloud Edge 公网路由 |
| Mobile -> Desktop | `hub-proxy` |

## Artifact 位置

```ts
type ArtifactLocation =
  | { type: "edge-local"; edgeId: string; path: string }
  | { type: "edge-url"; edgeId: string; url: string }
  | { type: "hub-cache"; url: string }
  | { type: "object-storage"; url: string }
```

规则：

- Artifact 元数据同步到 Hub。
- Artifact 字节留在 Edge，除非缓存或导出。
- Hub 可以在 UI 无法到达 Edge 时代理 artifact 读取。
- 大日志和 workspace 文件按需获取。
- Workspace 树默认绝不上传。

## 各拓扑数据面路径

| 拓扑 | 首选数据路径 | 兜底 |
|---|---|---|
| Desktop local | UI -> Edge，可选 Local Runner Fast Path | 无 |
| Desktop local online | UI -> Edge | Hub cache 用于同步的元数据 |
| Desktop direct remote | UI -> Local Edge -> Remote Edge | SSH tunnel |
| Desktop relay remote | UI -> Local Edge/Hub -> Hub proxy -> Remote Edge | Hub cache |
| Desktop direct Cloud | UI -> Local Edge -> Cloud Edge | SSH/Tailscale tunnel |
| Desktop relay Cloud | UI -> Hub proxy -> Cloud Edge | object storage |
| Web relay Desktop | UI -> Hub proxy -> Desktop Edge | Hub cache |
| Web relay Cloud | UI -> Hub proxy -> Cloud Edge | object storage |

## 安全注意事项

- 数据 token 应限定到单个 run/artifact 且快速过期。
- Preview proxy 应按 run 隔离 origin。
- 文件读取应限定在 workspace 根目录下。
- Diff/日志视图应优先使用不可变的 artifact ID 而非原始路径。
- Hub relay 应审计远程 Desktop 和 Cloud Edge 的数据面访问。

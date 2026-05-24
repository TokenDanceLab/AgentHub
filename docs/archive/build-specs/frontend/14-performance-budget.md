# AgentHub 性能预算与基准指标

> 日期: 2026-05-21 | 范围: P0 仅桌面（Edge+Runner 在 127.0.0.1 上同机部署）
> 依据: design-observability.md、design-go-services.md、design-desktop-ux.md、design-micro-interactions.md、roadmap-research-to-implementation.md

---

## 1. 概述

P0 完全运行在本地 loopback 上 -- 网络延迟可忽略。性能瓶颈为：
SQLite 串行写入、React 虚拟列表渲染和子进程启动。

| 约束 | 值 | 理由 |
|-----------|-------|-----------|
| 预算范围 | P0 桌面 loopback | WAN/Hub 延迟不在 P0 范围内 |
| 目标硬件 | 4+ 核、16GB RAM、SSD | 开发者笔记本配置 |
| 置信度 | P50 为主；P95 为辅 | P50 可稳定复现；P95 随 GC/OS 波动 |

---

## 2. P0 性能预算

### 2.1 前端

| 指标 | 预算 | 测量方式 |
|--------|:------:|------------|
| FCP | < 600ms | 首次加载时 `web-vitals` |
| TTI | < 1.2s | hydrate + store init 后 `web-vitals` |
| Thread 切换延迟 | < 100ms | 点击 ThreadCard 到首条消息可见 |
| Message bubble 渲染（单个） | < 16ms | React Profiler 每次 MessageNode mount |
| Message list 滚动 | 60fps（<16ms/帧） | 200 项虚拟列表滚动 |
| 流式文本追加 | < 16ms/chunk | WS 事件到 DOM 更新（16ms 防抖合并，design-micro-interactions.md 6.5） |
| 全局搜索（Ctrl+K） | < 300ms | 防抖结束到结果渲染（P1） |
| DiffCard 展开（L2） | < 200ms | max-height transition（P1） |

### 2.2 后端（Go 服务）

| 指标 | P50 | P95 | 测量方式 |
|--------|:---:|:---:|------------|
| SQLite message INSERT | < 5ms | < 20ms | `DBWriteLatency` histogram |
| SQLite FTS5 search | < 10ms | < 25ms | `DBQueryLatency` histogram，10K 消息 |
| SQLite SELECT history（50 行） | < 3ms | < 10ms | 分页消息加载 |
| WS broadcast（5 人房间） | < 5ms | -- | hub.Broadcast() 到最后 SendCh append |
| WS ping/pong round-trip | < 2ms | -- | coder/websocket 内置，15s 间隔 |
| Agent subprocess start | < 200ms | < 500ms | Cmd.Start() 到第一条 stdout |
| Git worktree add | < 100ms | < 300ms | 已有仓库，本地 SSD |
| Edge `/healthz` | < 1ms | -- | 仅进程存活检测 |
| Edge `/readyz` | < 100ms | -- | SQLite ping + 本地 WS 检查 |

### 2.3 AgentRun 端到端生命周期

| 阶段 | 预算 | 备注 |
|-------|:------:|-------|
| 用户 Enter 到 Edge WS 接收 | < 5ms | Loopback，可忽略 |
| Edge orchestrator 分发 | < 10ms | RouteMessage 到 POST /runs |
| Runner 启动 agent 子进程 | < 200ms | queueLatency histogram 段 |
| 首个 agent 输出到 UI（端到端） | < 250ms | Enter 键到首个 content_block_start 可见 |
| 工具结果显示 | < 50ms | agent stdout 之后；ToolUseCard mount + ToolResult render |

---

## 3. 关键路径指标

### 3.1 浏览器时间线

```
TTI Budget（1200ms）:
  0──FCP（600ms）──hydrate──store_init（900ms）──idle（1200ms）

Thread Switch（100ms 预算）:
  0──setActiveThread（10ms）──loadMessages（40ms）──virtual_mount（80ms）──paint（100ms）

Streaming（16ms/chunk）:
  0──WS→store（2ms）──React_batch（14ms）──paint（16ms）
```

关键使能因素:
- FCP < 600ms: code-split Monaco editor + 懒加载 DiffViewer
- TTI < 1.2s: Zustand store init 同步，必须在 post-hydrate 300ms 内完成
- Thread < 100ms: `@tanstack/react-virtual`，3 个 overscan（design-desktop-ux.md 1）
- Streaming 16ms: coalesce debounce window（design-micro-interactions.md 6.5，Kanna 模式）

### 3.2 Message Bubble 渲染预算

| 子组件 | 预算 | 备注 |
|--------------|:------:|-------|
| MessageHeader | < 2ms | 头像 + 名称 + 时间戳，纯展示 |
| TextContent（500 字符） | < 8ms | react-markdown + remark-gfm |
| ThinkingBlock（L1 折叠） | < 1ms | 不可见内容；仅切换按钮 |
| ToolUseCard（L2 折叠） | < 2ms | 仅标题（图标 + toolName + 参数摘要） |
| ToolResult（L2 展开） | < 10ms | Diff/Bash/Read 结果解码 + 渲染 |
| Subagent Sidechain（L3） | < 15ms | 递归 MessageNode，仅展开时 |
| **Total L0 可见** | **< 12ms** | Header + TextContent |
| **Total L0+L1+L2 展开** | **< 25ms** | 最坏情况单消息展开 |

Memo 策略: MessageBubble 上自定义 `areEqual`（浅比较 id + content hash）；流式容器上无 React `key`；markdown AST 解析上 `useMemo`。

---

## 4. Go 服务基准

### 4.1 SQLite（WAL 模式、`?_busy_timeout=5000`、`SetMaxOpenConns(1)`）

| 操作 | P50 | P95 |
|-----------|:---:|:---:|
| INSERT message | < 5ms | < 20ms |
| INSERT 100 批量 | < 50ms | < 100ms |
| SELECT messages LIMIT 50 | < 3ms | < 10ms |
| FTS5 search（10K 语料） | < 10ms | < 25ms |
| UPDATE conversation | < 2ms | < 5ms |
| SELECT conversations（20） | < 2ms | < 5ms |
| Schema migration 每步 | < 500ms | < 1s |

### 4.2 WebSocket Hub（coder/websocket）

| 操作 | P50 | 上下文 |
|-----------|:---:|---------|
| Client register + room join | < 1ms | Channel 发送到 hub.Register（buffer 256） |
| Broadcast 5 clients | < 5ms | 每客户端 SendCh append（buffer 64） |
| Broadcast 50 clients | < 20ms | 线性扩展 |
| Write pump 单次发送 | < 1ms | conn.Write 在 loopback 上 |
| Ping/pong RTT | < 2ms | 15s 间隔 |
| Room cleanup | < 1ms | delete(h.rooms, roomID) |

### 4.3 子进程 / 工作区

| 操作 | P50 | P95 |
|-----------|:---:|:---:|
| git worktree add | < 100ms | < 300ms |
| Agent binary check | < 5ms | < 10ms |
| Agent start 到首行 | < 200ms | < 500ms |
| Agent 优雅关闭（SIGTERM） | < 2s | < 5s |
| Agent 强制杀死（SIGKILL） | < 500ms | < 1s |
| Checkpoint SHA-256 + zstd | < 50ms | < 200ms |

---

## 5. 回归检测策略

### 5.1 管线

Go MetricsCollector（15s 循环）导出到 `/api/metrics`（Prometheus 文本格式）。两个消费者：
- **CI benchmark job**: `go test -bench . -count=5` + `benchstat` 与上次提交对比
- **本地开发**: `make bench-compare` 用于 PR 前手动回归检查

### 5.2 CI 基准（go test -bench）

```
BenchmarkSQLiteInsert          BenchmarkSQLiteInsertBatch100
BenchmarkSQLiteSelectHistory   BenchmarkSQLiteFTS5Search
BenchmarkWSBroadcast5          BenchmarkWSBroadcast50
BenchmarkWSRegister            BenchmarkGitWorktreeAdd
BenchmarkAgentStartup          BenchmarkMessageSerialize
BenchmarkAgentEventParse
```

### 5.3 通过/警告/失败阈值

| Benchmark | 通过（P50） | 警告（P50） | 失败（P50） |
|-----------|:----------:|:----------:|:----------:|
| SQLite insert | < 5ms | 5-10ms | > 10ms |
| SQLite FTS5 search | < 10ms | 10-20ms | > 20ms |
| WS broadcast 5 clients | < 5ms | 5-10ms | > 10ms |
| Git worktree add | < 100ms | 100-200ms | > 200ms |
| Agent startup | < 200ms | 200-400ms | > 400ms |

`benchstat` 以 p < 0.05 检测显著性。退化 >20% 警告；>50% 失败。

### 5.4 前端回归

- **Vitest**: React Testing Library 渲染预算断言（MessageBubble < 12ms，展开 < 25ms）
- **Lighthouse CI**: FCP < 800ms（限速）、TTI < 1.5s、主 chunk < 300KB gzipped
- **运行时**: `/api/metrics` histogram 在滚动 5 分钟窗口内对比

### 5.5 CI 失败策略

- 警告: PR 评论，P0 非阻塞（P1+ 变为阻塞）
- 失败: 阻止合并，需要记录覆盖原因
- Lighthouse FCP/TTI 失败: 阻止 P0 页面合并

---

## 6. 可观测性集成

现有指标（design-observability.md）直接支持所有预算：

| 预算指标 | SystemMetrics 字段 | 类型 |
|--------------|---------------------|------|
| SQLite query latency | `DBQueryLatency` | Histogram（P50/P95/P99） |
| SQLite write latency | `DBWriteLatency` | Histogram |
| AgentRun queue latency | `QueueLatencyHist` | Histogram |
| AgentRun duration | `RunDurationHist` | Histogram（P50/P95/P99） |
| WS connections | `WSConnections` | Gauge（atomic.Int64） |
| Goroutine count | `Goroutines` | Gauge |
| Heap usage | `HeapInUseMB` | Gauge |

健康检查预算绑定: `/readyz` SQLite < 10ms、Workspace < 50ms、WS ping < 2ms RTT。

---

## 7. 决策摘要

| 决策 | 选择 | 理由 |
|----------|--------|-----------|
| 预算范围 | 仅 P0 桌面 loopback | WAN/Hub 延迟无关 |
| 测量基础 | P50 为主 | P95 在开发硬件上不稳定 |
| 前端指标 | `web-vitals` + React Profiler | 标准，零配置 |
| 后端基准 | `go test -bench` + `benchstat` | 无外部依赖 |
| 回归检测 | 统计 p < 0.05 | 避免 CI 方差误报 |
| Histogram | 自定义 reservoir sampling（10K） | design-observability.md 6.3 |
| 告警 | 仅本地开发 | P0 无远程监控 |
| CI 阻塞 | P0 仅警告；P1+ 阻塞 | P0 是快速迭代阶段 |
| 动画预算 | 推迟到 micro-interactions.md | 仅 CSS 保障，独立关注点 |

# ADR-004: Go 进程编排 + Adapter 模式

**日期**: 2026-05-24
**状态**: 已采纳
**决策者**: Delicious233, Johnny, Trump

## 背景

Edge Server 需要管理多个 Agent CLI 进程（Claude Code、Codex、OpenCode），每个 CLI 有不同的命令行参数、输出格式和 stdin 控制协议。同时需要限制最大并发数、支持优雅取消、收集 Prometheus 指标，并在进程崩溃时正确标记 Run 失败。

## 决策

采用 **Go `os/exec` + Adapter 模式 + 内存 store**，不引入外部进程管理器：

- `ProcessExecutor` 使用 `os/exec` 直接管理子进程，通过 Context 和 CancelFunc 实现超时和取消。进程映射（running、stdins、runOutputs）使用 `sync.Mutex` 保护的内存 map。
- `AgentAdapter` 接口定义 `BuildCommand()`（构建命令行参数）、`ParseStream()`（解析输出流）、`NeedsStdin()`（是否需要 stdin 控制）。三种 CLI 各自实现该接口。
- `Registry` 支持按 AgentID 动态选择 Adapter，允许同一 Edge 运行不同类型的 Agent。
- 取消策略：先通过 stdin 发送 `interrupt` 控制消息（让 CLI 优雅退出），再 cancel context（兜底杀死进程）。
- `defaultRunTimeout = 30min` 硬超时防止僵死进程，`maxConcurrentRuns = 5` 限制并发。

## 后果

- 进程泄漏风险：Context 取消后子进程可能未及时退出。通过 `finish()` 的 defer 清理 + `defaultRunTimeout` 硬超时 + 锁保护的 CancelFunc map 来缓解。
- 跨平台适配：部分 CLI 仅支持 macOS/Linux，Windows 需通过 `runtime.GOOS` 做条件编译或降级提示。
- 无外部依赖：内存 store 在 Edge 重启后丢失运行中进程的追踪信息，需要在重启时扫描残留子进程。
- Adapter 层有 32 个单元测试（覆盖 24 种 NDJSON 消息类型）和 14 个集成测试，覆盖端到端执行、工具调用、取消和 stdin 控制。

## 备选方案

- **Docker 容器隔离**：每个 Agent 运行在独立容器中。被否决——桌面场景下 Docker 太重，本地 workspace 文件共享和权限模型复杂，且冷启动延迟不可接受。
- **Node.js child_process**：用 TypeScript 直接管理子进程。被否决——Go 的 goroutine 模型更适合多进程并发管理，且 Go 二进制部署比 Node.js 运行时更省资源。
- **systemd / launchd**：委托给操作系统进程管理器。被否决——跨平台一致性差（Windows 无 systemd），且无法精细控制 stdin 和实时输出流解析。

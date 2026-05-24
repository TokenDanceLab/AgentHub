# ADR-003: Zustand + TanStack Query 状态管理

**日期**: 2026-05-24
**状态**: 已采纳
**决策者**: Delicious233, Johnny, Trump

## 背景

Desktop UI 需要管理两类截然不同的状态：**服务端状态**（Runs、Threads、消息列表——需要缓存、后台刷新、乐观更新）和**客户端 UI 状态**（isStreaming、selectedThreadId、侧边栏宽度、主题——只在客户端存在，无需与服务端同步）。单一状态库很难同时优雅地处理这两类需求。

## 决策

采用 **TanStack Query**（原 React Query）管理服务端状态 + **Zustand** 管理客户端 UI 状态，各司其职：

- **TanStack Query**：负责 `useThreads`、`useRenameThread` 等 hooks，自动管理缓存、后台轮询（`refetchInterval`）、乐观更新（`onMutate`）、错误回滚。替代了之前用 `setInterval` 轮询 + 手动写回 Zustand 的模式。
- **Zustand**：负责 `useUIStore`（sidebar 宽度、主题、移动端折叠状态）、`useToastStore`（通知队列）等纯客户端状态。采用 `subscribeWithSelector` 中间件支持细粒度订阅。

## 后果

- 两个库的职责边界需要团队纪律：服务端数据（threads、runs、messages）走 TanStack Query，UI 临时状态走 Zustand。不能混用。
- Zustand 选择器需使用 `useShallow` 避免不必要的重渲染（如从 store 中提取多个 scalar 值时）。
- TanStack Query 的 `queryClient` 配置了 `staleTime: 30s` 和 `retry: 2`，在本地 Edge 通信场景下频率合理。
- 新增数据源时需先在两个库之间做出明确选择，这增加了设计决策的时间成本。

## 备选方案

- **Redux Toolkit Query**：Redux 全家桶提供统一的 store + 缓存方案。被否决——样板代码过多（slice、reducer、action、selector），且服务端缓存的过期/重试/乐观更新逻辑不如 TanStack Query 成熟。
- **纯 Context + useReducer**：零依赖方案。被否决——Context 的 value 变化会导致所有消费者重渲染，不适用于高频更新的 Agent 输出流（每秒数十个事件）。
- **纯 Zustand 管理一切**：将 API 数据也存入 Zustand 并手动处理缓存和轮询。被否决——手动实现缓存失效、后台刷新、乐观回滚等逻辑工作量大且易出错。

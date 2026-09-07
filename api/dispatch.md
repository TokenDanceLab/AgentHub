# Hub→Edge 任务投递契约

> 最后更新：2026-09-07。事件索引见 [events.md](events.md)，REST 字段见 [openapi.yaml](openapi.yaml)。

本页定义跨通道执行输入、admission 回执和结果回传方；它不代表真实登录、模型 E2E、部署或进程恢复已验证。

### Hub→Edge `delivery_id` admission 契约（#2101 G2 / #2347）

Hub 的 WS `agent.dispatch` 与 outbox HTTP POST `/v1/runs` 共享同一 `delivery_id`。Desktop 将事件中的 `delivery_id` / `deliveryId` 转交为 Edge 请求的 `deliveryId`；空值保留既有无去重路径。

- **原子接收**：先保留 pending claim；仅在 run 接收成功后提交含原 `runId` 的回执，失败或放弃则释放 claim，允许同 ID 重试。
- **容量与有效期**：进程内缓存默认共容纳 4096 个 pending claim / accepted receipt。成功回执从提交起保留 5 分钟，也可因 LRU 容量压力被淘汰；重放不续期。pending claim 不因 TTL/LRU 被移除，避免首个请求未完成时重复执行。
- **绑定**：非空 `hubTaskId` 是业务绑定。同一 Hub task 的 HTTP 本地线程与 Desktop 会话线程可以不同，但回执指向同一个原 run；无 `hubTaskId` 的遗留请求按 `projectId` / `threadId` 绑定。缓存内同 delivery ID 的不同绑定返回 409 `delivery_conflict`。
- **成功重放**：有效回执返回原 run 的正常 202 envelope，包括 `data.runId`、`data.deduplicated: true` 和 `data.deliveryId`；不新建 run、timeline 或 executor。原 run 已删除则返回 404 `not_found`，不静默重建。每次请求先通过 capability 校验；重放还按原 run 实际 project/thread scope 复验。
- **临时拒绝**：同 ID 正在接收，或容量被 pending claim 占满时，返回 503 `delivery_busy` + `Retry-After`（秒），而不是成功回执。409 `active_run_exists` 表示线程被其他活动 run 占用，也不能当作本次投递成功。Desktop 对这两类拒绝不 ACK、不 FAIL，由现有 Hub outbox 负责重投。
- **ACK 与业务状态**：每次成功接收或重放都幂等重发 task / relay ACK，以修复丢失的确认；已建立的 run 映射、输出和 running/terminal 状态不因重复投递而回退，业务接收通知只触发一次。
- **Hub task 接收证据**：非空 `hubTaskId` 在启动执行器前，与 `admissionState: pending` 一起写入 run；File/SQLite 在返回前同步保存。执行器返回后只允许转为 `accepted` 或带 `admissionErrorCode` 的 `rejected`，不改写执行状态。没有 Hub task 的本地/MCP 请求保留原路径。
- **冷重放**：进程缓存丢失或 delivery ID 改变时，按 Hub task 查最新 attempt，并复验原 run scope。`accepted` 返回原 run，不重新执行；上次最终证据保存失败时只重试保存。已接收 run 后续 `failed` 不等于接收拒绝。
- **拒绝与未决**：429 `too_many_concurrent_runs` 是执行器持有执行权之前的容量拒绝；503 `admission_persist_failed` 是证据保存失败（执行器可能已经接收），两者都不应 ACK/FAIL，由 Hub 重投向 Edge 核对。只有明确的容量拒绝或调用 Start 之前的保存失败，才允许创建新 attempt；普通 `executor_start_failed` 保持拒绝，不伪装成功。
- **结果不明**：同一 Hub task 的当前接收者仍在处理时返回 503 `delivery_busy`。恢复后的 `pending`、未知 admission state、无 `startedAt` 的旧 run 返回 409 `admission_uncertain`；Desktop 保持待核对错误并通过现有通知提示用户，同一原因不重复提示，不 ACK/FAIL、不自动启动。旧 run 只有明确 `startedAt` 才能按原身份重放。`GET /v1/runs/{runId}` 暴露已记录的 `admissionState` / `admissionErrorCode` 供核对。
- **恢复边界**：缓存不是恢复日志；持久化接收证据证明的是是否接收，不保证进程仍在运行，也不提供自动进程恢复。`queued`/`failed` 本身不能证明没有外部副作用。未决 admission 不参与终态自动清理；原 run 因显式删除或正常 retention 消失后，不宣称永久保留 Hub task 的幂等身份。


### 跨投递通道的执行输入与回调归属

同一 Hub task 的直接 HTTP 与 Desktop WS/relay 投影共用 `tests/fixtures/dispatch/execution-intent.json`。执行输入不能因通道改变：model、reasoning/thinking、permission、workDir、system/append prompt、tools、config/ephemeral、messages/pinned 和 structured output schema 均保留；显式 `false` / `0` 不当作缺失值。未指定模型或工作目录时不替用户编造默认值，新的执行仍须通过 Edge workspace allowlist。

- **输入优先级**：运行参数取 `model_params` 的 snake/camel 别名；顶层 system prompt / tool whitelist 优先于嵌套回退。schema 的 JSON 候选（含对象、布尔值）或字符串统一转为 Edge 字符串，合法性仍由 Edge 校验；消息历史和 pinned 内容保留 role/content/timestamp。Hub `session_id` 是会话身份，不充当 runtime session；只有 model params 的显式 session_id/sessionId、continue/fork 才映射为运行时续接参数；只有 continue 缺省时 Edge 才按本地历史自动续接，显式 false 不被历史覆盖。
- **允许的通道差异**：Hub HTTP 使用本地 project/thread，Desktop 使用对应会话线程；同 Hub task 的 admission 身份合流不变。直接通道请求 `callbackOwner: edge`，Desktop 请求 `callbackOwner: desktop`。Edge 在 pending admission 中保存首次选择，重放始终返回原 run 的真实 owner，不因新请求换人。
- **执行前能力检查**：`GET /v1/health` 的 `capabilities.runCallbackOwnership` 证明该版本执行 owner 契约；`directHubCallbacks` 仅表明 Edge 已配置目的地和当前凭据，不证明远端连通或 token 有效。Hub direct 要求两者为 true，且 health 的 `edgeId` 与配置的真实 `device_id` 相同、该注册设备归属于任务 Agent 的邀请用户；Desktop 要求 ownership 支持（sidecar 无直接回调是正常）。缺失/未知能力时不发送 run POST，不以旧端会忽略新字段为兼容策略。Edge 仍在新接收时校验 direct callback 配置，未就绪返回 503 `callback_unavailable`，不创建 run。
- **单一结果回传方**：edge-owned run 由 Edge 发 task ACK/stream/done/fail；Desktop 只更新本地 run 状态，不发第二套任务回调。desktop-owned run 的 Edge 不建立直接 callback 映射。relay delivery ACK 仍由接收 Desktop 负责，不能与任务结果回调混同。Hub direct 遇到 desktop-owned receipt 时只向该原设备投递，让 Desktop 恢复 bridge；不能改选邀请用户的另一台 Desktop。
- **Team 控制边界**：typed route/result stream 是事件记录，不等同于调用 Team 的权威 route-decision 接口。带 Team 上下文的任务继续走 Desktop callback owner 与现有控制流程；Hub direct 在 POST 前退出，不把事件透传宣称为 Team 自动调度。
- **direct 路由保留**：只有执行前能力检查失败、且尚未绑定设备的任务可以走普通 fallback。Hub 在 run POST 前持久化真实设备绑定；POST 超时、连接中断、错误或未知 owner 响应不证明未执行，现有 outbox 只能向原设备核对，不改投另一执行器。成功回执补记原 run ID；迟到回执不得回退已经 running/done/failed 的任务。
- **旧回执与恢复**：现代请求碰到无法确定 owner 的旧 run，或收到缺失/非法 owner 的接收响应，按未决结果处理，不猜测、不自动重启。该契约不迁移正在执行的旧进程、不转交已接受任务的 owner，也不宣称跨重启恢复已完成。

# AgentHub 四份核心文档交叉 Review 合并报告

## Review 目录规范

`docs/review/` 用于保存阶段性项目审查、文档审查、代码审查和架构建议。规范如下：

1. 每次新审查必须在 `docs/review/` 下新建一个按日期时间戳命名的子目录，格式为 `yyyyMMdd-HHmmss`，例如 `20260523-000150`。
2. 每位审查者在该时间戳目录内单独写一个 Markdown 文件，文件名使用小写审查者编号，例如 `reviewer1.md`、`reviewer2.md`。
3. 审查文件开头必须写清审查人、模型、时间、范围和审查依据。
4. 正文中文为主；代码标识、路径、API 字段和命令保留英文。
5. 审查内容应基于仓库当前事实，区分已实现、未实现、风险和建议，不把猜测写成结论。
6. 不在审查文件中写入本机绝对路径、密钥、真实服务器信息、私人账号、生产数据或敏感日志。
7. 多个 Reviewer 的文件互不覆盖；如需统一结论，另建 `summary.md`，不要改写单个 Reviewer 的原始意见。

## 本次审查信息

审查人：1号评委 / Reviewer1  
模型：gpt-5.5  
时间：2026-05-23 00:01  
范围：对 `README.md`、`docs/architecture/product-requirements.md`、`docs/architecture/system-architecture.md`、`docs/architecture/implementation-guide.md` 四份核心文档做交叉 Review，并合并为一份统一报告。  
审查依据：四份核心文档、`docs/operations/client-roadmap.md`、`api/` 契约、Edge/Runner/Desktop 当前实现、测试与 CI 配置。

## 1. 交叉 Review 结论

四份核心文档的主线一致，已经形成了清楚的产品叙事：

```text
AgentHub = 本地 Agent 工作台 + IM 式多 Agent 协作 + Hub 网络同步与中继
```

它们共同指向的架构也是一致的：

```text
Desktop UI -> Edge Server -> Runner -> Claude Code / Codex / OpenCode
                   ⇅
              Hub Server
```

但是四份文档之间存在一个明显错位：`README.md` 仍像调研阶段入口，产品需求描述完整 P0/P1 愿景，系统架构给出未来完整 Hub-Edge-Runner 模型，实现文档仍写成 API foundation 起步，而当前仓库实际已经进入客户端 M1 收口阶段。

统一后的判断应该是：

```text
当前阶段：客户端 M1 收口。

已跑通：
Desktop UI -> Local Edge Server -> Mock Run -> WebSocket events -> UI EventLog

还不是完整 P0：
Project / Thread / Item 持久化、真实 Runner adapter、Diff / Artifact、Apply / Discard、Approval、Preview 尚未闭环。
```

因此，这四份文档不应分别扩写，而应围绕同一个事实口径合并校准：对外展示、产品需求、架构说明和实现计划都要明确“当前 M1”和“完整 P0”的边界。

## 2. 四份文档合并后的统一口径

建议四份文档统一使用以下阶段定义。

### M1：客户端 mock 链路

目标：证明 Desktop、Local Edge、WebSocket events、Mock Run 和 UI 展示链路成立。

当前仓库已经基本具备：

- Local Edge health API。
- Runner list mock 数据。
- `POST /v1/runs` 触发 mock run。
- WebSocket 推送 `run.queued`、`run.started`、`run.output.batch`、`run.finished`。
- Desktop UI 展示 Edge online/offline、Mock Runner 和 EventLog。
- Go tests、Vitest、Playwright e2e、smoke 脚本正在收口。

M1 的完成标准：

```powershell
git diff --check

cd edge-server
go test ./...

cd ..\runner
go test ./...

cd ..\app\desktop
pnpm test
pnpm build
pnpm test:e2e

cd ..\..
.\scripts\client-smoke.ps1
```

### M2：Edge 本地权威数据层

目标：让 Edge 从 mock event server 变成本地工作台权威。

最小范围：

- Project store。
- Thread store。
- Run store。
- Item store。
- EventStore。
- REST snapshot 与 WebSocket cursor 恢复。

完成标准：

- Edge 重启后 Project / Thread / Run / Item 可恢复。
- WebSocket 断线后能用 cursor 继续。
- cursor 过期时客户端能拉 REST snapshot 重建状态。
- UI 不再只依赖内存事件。

### M3：真实 Runner adapter

目标：从 Edge 内部 mock run 切到 Edge 调 Runner，再由 Runner 调一个真实 Agent CLI。

最小范围：

- Runner adapter interface。
- 先接 Codex CLI 或 Claude Code 二选一。
- stdout/stderr 聚合成 `run.output.batch`。
- exit code 映射为 `run.finished` / `run.failed`。
- cancel run 能停止子进程。

完成标准：

- Agent CLI 不存在时有稳定错误码和清晰 UI 提示。
- 不打印 token、cookie、本机私有配置或敏感日志。
- 取消 run 后不留下孤儿进程。

### M4：Artifact / Diff / Apply / Discard / Preview

目标：形成开发工作台闭环。

最小范围：

- 每个 run 有隔离 workspace 或 worktree。
- run 结束后检测 changed files。
- 生成 diff artifact。
- Desktop 展示 changed files 和 diff。
- Apply / Discard 可执行。
- Preview 启动并发送 `preview.ready`。

完成标准：

- 用户能看到 Agent 改了什么。
- 用户能选择应用或丢弃。
- 用户能打开预览。
- 文件路径保护和审批边界可测试。

## 3. 交叉发现的不一致

### 3.1 README 状态和代码状态不一致

`README.md` 仍写“状态-调研中”和“运行入口会随 P0 代码 PR 补上”。但当前仓库已经有 Local Edge、Runner mock、Desktop UI、测试和 smoke 脚本。

合并建议：

- README 改成“客户端 M1 开发中”。
- 快速开始补 Local Edge + Desktop Web UI 的真实启动方式。
- 明确 M1 已跑通 mock 链路，但完整 P0 未完成。

### 3.2 产品需求的 P0 范围缺少验收口径

`docs/architecture/product-requirements.md` 的 P0 必须具备项是正确的，但缺少“每项怎样算完成”。这会导致 M1 mock、完整 P0、P1 能力混在一起。

合并建议：

- 在产品需求中增加“M1 不等于完整 P0”的说明。
- 把 P0 必须具备列表改成带验收标准的表格。
- 增加非功能需求：安全、可审查、可恢复、本地优先、adapter 可扩展。

### 3.3 系统架构缺少 P0 本地拓扑和数据权威

`docs/architecture/system-architecture.md` 的 Hub-Edge-Runner 总体架构正确，但对当前 P0/M1 实现者来说，还缺少更具体的边界。

合并建议：

- 增加 P0 本地拓扑：Desktop UI -> Local Edge -> Local Runner。
- 明确 Hub 在 P0 不是依赖项。
- 增加数据权威表：Project、Thread、Item、Run、Artifact、Approval、Preview 分别由谁写、存在哪里、未来如何同步。
- 增加 EventStore 语义：先写持久事件，再投递 WebSocket；断线用 cursor 恢复；失败拉 REST snapshot。

### 3.4 实现文档没有同步当前 M1 状态

`docs/architecture/implementation-guide.md` 仍写“先完成 API foundation，然后进入 Go 服务和 UI 实现”。现在这句话已经落后于实际进度。

合并建议：

- 把当前目标改成“客户端 M1 收口”。
- 后续路线拆成 M1/M2/M3/M4。
- 每个阶段写清写入范围、接口影响、验收命令。
- 把测试要求从“后续有代码后追加”改成当前固定要求。

### 3.5 API 契约和实现计划存在超前风险

`api/openapi.yaml` 已列出大量 P0-P4 endpoint，但多数 request / response schema 仍泛化。实现文档又要求“先改 API 再写代码”，两者结合后容易产生“路径有了但契约不够”的问题。

合并建议：

- 允许 P1-P4 endpoint 保持规划占位。
- 进入 M2/M3/M4 实现的 P0 endpoint 必须补齐 request body、response schema、error code、owner、phase、会触发的 event。
- `app/shared` 的 TS 类型应跟这些 P0 schema 对齐。

## 4. 合并后的主文档修改建议

### README.md 应保留对外入口，不塞开发细节

建议只补四类内容：

1. 当前状态：客户端 M1，已跑通 mock 链路。
2. 当前可运行方式：Edge + Desktop Web UI + 可选 Tauri。
3. 当前未完成：Project/Thread/真实 Runner/Diff/Approval/Preview。
4. 文档导航增加 `docs/operations/client-roadmap.md` 和 `docs/operations/client-handoff.md`。

README 不应加入大量任务拆解，避免变成实现文档。

### product-requirements.md 应负责“做什么”和“怎么算完成”

建议补：

- 当前阶段说明。
- M1 与完整 P0 的区别。
- P0 验收表。
- 三个核心用户场景。
- 非功能需求。
- 比赛演示验收。

产品需求不应写过多 Go package 或文件写入范围。

### system-architecture.md 应负责“谁负责什么”和“状态归谁”

建议补：

- P0 本地拓扑。
- Edge/Runner/Desktop 内部模块。
- 数据权威和存储位置。
- EventStore 和 cursor 恢复语义。
- 安全边界。
- 失败恢复场景。

架构文档不应写具体 PR 命令和短期分支细节。

### implementation-guide.md 应负责“怎么分阶段写”

建议补：

- 当前 M1 收口状态。
- M1/M2/M3/M4 阶段表。
- 每阶段写入范围。
- API schema 完成要求。
- 当前固定测试命令。
- PR 验收模板。

实现文档不应重复产品愿景和完整架构解释，只引用前两份主文档。

## 5. 建议的改文档顺序

1. 先改 `README.md`：修正状态和快速开始，避免入口误导。
2. 再改 `docs/architecture/product-requirements.md`：补 M1/P0 边界和 P0 验收表。
3. 再改 `docs/architecture/system-architecture.md`：补 P0 拓扑、数据权威、EventStore、失败恢复。
4. 最后改 `docs/architecture/implementation-guide.md`：按 M1-M4 拆任务和验收。
5. 同步检查 `docs/operations/client-roadmap.md`，确保它作为阶段路线图，不和实现文档冲突。
6. 如阶段定义影响 API，再同步 `api/openapi.yaml` 和 `api/events.md` 的 phase / owner 标记。

## 6. 建议合并成的统一摘要

如果需要把四份文档口径压成一段，可以使用以下摘要：

```text
AgentHub 是 IM 形态的多 Agent 协作平台，P0 先做本地 Desktop Command Center，跑通 Desktop UI -> Local Edge -> Local Runner -> Agent CLI 的执行闭环。当前仓库处于客户端 M1 收口阶段，已具备 Local Edge、Mock Run、WebSocket events 和 Desktop EventLog 的最小链路；完整 P0 仍需补齐 Project / Thread / Item 持久化、真实 Runner adapter、Diff / Artifact、Apply / Discard、Approval 和 Preview。Hub Network、Web/Mobile 和团队 IM 属于 P2 之后能力，不应阻塞 P0 本地离线闭环。
```

## 7. 1号评委最终建议

四份文档现在不需要各自扩写成更长的版本，而要先统一当前阶段事实。我的建议是以“客户端 M1 收口”为锚点，把文档职责重新压实：

- README 讲清当前能跑什么。
- 产品需求讲清 P0 要完成什么。
- 系统架构讲清谁是权威、数据在哪里。
- 实现文档讲清下一步按什么阶段写、怎么验收。

只要这四份文档完成这次合并校准，后续三条开发线就能围绕同一条主线推进，而不是在“愿景、架构、实现、当前进度”之间来回解释。


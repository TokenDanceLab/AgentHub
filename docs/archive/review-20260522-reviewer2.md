# AgentHub 项目审查 - Reviewer2

## 本次审查信息

审查人：Reviewer2
模型：Claude Opus 4.7 (claude-opus-4-7, 1M context)
时间：2026-05-22 23:57
范围：项目文档分层、API 契约、Git 工作流状态、客户端 M1 mock 链路、Edge Server、Runner、Desktop UI、仓库卫生、安全边界。
审查依据：`AGENTS.md`、`README.md`、三份主文档、`docs/operations/client-roadmap.md`、`api/openapi.yaml`、`api/events.md`、`edge-server/` 与 `runner/` 与 `app/desktop/` 当前代码与 git 状态、reviewer1 的审查结论。

## 0. 与 Reviewer1 的关系

Reviewer1 的总体判断（路线已收敛 / 先收口 M1 / 暂不启动 Hub 与 Web）我都同意，不重复论证。本文聚焦 Reviewer1 没充分覆盖、但我认为应当被同等重视的角度：

1. Git 工作流当前已经有累积债务，不只是"未提交改动"。
2. 仓库里混入了不应入库的本机产物，已经污染 worktree。
3. Runner 接真 CLI 之前，"输出 sanitizer"必须先成为契约级别的红线，而不是事后再补。
4. Desktop 启动编排（M2）有一些 Tauri sidecar 的实际选型需要早决定。
5. 文档体系的"已实现 / 待实现"双轨标注缺失，导致后续 Agent 容易把契约当事实。

下面只展开本文新增的观点。

## 1. 已实现现状的事实核对

为后续讨论建立公共事实基线，对 Reviewer1 §2 做几点补充与核对：

- `app/shared/src/` 已经提取出 `types / events / errors / index`，前端通过 `@shared/*` alias 引用。这是后端、客户端、前端共享契约的关键基础，已经成立。
- `edge-server/internal/` 拆分为 `api / events / httpserver / runners`，均带 `*_test.go`。`GET /v1/events` 已实现 cursor 重放 + 30s 心跳。
- `runner/` 仍只有 `--mock` 模式，**未接任何 Agent CLI**，HTTP 监听地址参数尚未生效。
- `hub-server/` 仍然只有 `README.md`，零代码。
- `app/web/src/` 是空目录，未启动。
- `api/openapi.yaml` 已覆盖 ~30+ endpoint（含 P1-P4），`api/events.md` 列出 ~30 事件分四类。
- `feat/client-dev` 工作区有 14 个 unstaged 改动，集中在 Desktop e2e、Playwright config、a11y 增强、Tauri 图标、handoff 文档。

## 2. Reviewer1 未充分覆盖的风险

### 2.1 Git 工作流债务已经在累积

不仅是"未提交改动"，还有两笔后续会越来越痛的债：

- `master` 比 `feat/client-dev` 多一个 commit `919d470 docs: 确定数据库选型 Hub 用 PostgreSQL 和 Edge 用 SQLite`，**未 rebase 进 `feat/client-dev`**。这个决策直接影响 Edge SQLite store 的实现起点，越晚回流越容易让 client-dev 上的实现与 master 上的设计出现偏差。
- 远程仍有 `feat/client-edge-foundation`、`feat/client-runner-mock`、`feat/client-desktop-shell` 三条已合并进 `feat/client-dev` 的子分支。按 `AGENTS.md` §4 "合并后执行 `git worktree remove`" 与一般 PR 礼仪，这三条分支应该删除，避免后续 Agent 在错的分支上继续 commit。

建议：M1.1 收口前，把 `919d470` rebase 进来，并清理三条已合并的远程分支。

### 2.2 仓库混入了本机二进制产物

当前 `feat/client-dev` 已跟踪以下三个 `.exe` 文件：

```text
edge-server/agenthub-edge.exe
edge-server/agenthub-edge-tmp.exe
runner/agenthub-runner.exe
```

这些是本机 `go build` 产物，违反 `AGENTS.md` §6 "新增本地生成目录、缓存、数据库、日志、私钥或 Agent 状态目录时，先更新 `.gitignore`" 的精神。后果：

1. 仓库体积不可控增长，每次重新编译都会产生 diff。
2. CI 上的 Edge 和 Runner 应该来自 `go build`，不是仓库里的二进制。
3. 本机产物可能携带本机路径、调试信息或符号表。

建议：M1.1 阶段就把 `*.exe`、`*.exe~`、`*-tmp*` 加入 `.gitignore`，并把这三个文件从 git 跟踪中移除（不需要清理历史，commit 一次即可）。

### 2.3 Runner 输出 sanitizer 必须先于真 CLI 接入定义

Reviewer1 §3.3 提到了"Agent CLI 不存在时返回清晰错误"，但更高优先级的安全红线是：**Runner 把真 CLI 的 stdout/stderr 转成 `run.output.batch` 时，必须先经过 sanitizer**。

真 CLI 的输出会含：

- 用户 token、API key（CLI 错误信息常会回显）
- 本机绝对路径（`C:\Users\<name>\...`）
- 历史命令、shell 提示符
- 环境变量 dump

如果直接转发，这些字段会通过 WebSocket 流回 Desktop UI，并被 `EventLog` 持久化到本机 SQLite——一旦后续接 Hub 同步，相当于把用户本机敏感信息上行到云端。

建议：在 `runner/internal/` 加 `sanitizer/` package，定义最小红线集合（token 格式、path 前缀、env-like KEY=VALUE 行），并在 `api/events.md` 给 `run.output.batch` 加一句"Runner 必须在发出前过滤敏感字段"。这条规则要在 M3 启动前就落到契约里，不是事后补。

### 2.4 Desktop 启动编排（M2）的选型决策点

`docs/operations/client-roadmap.md` §5 列了 M2 的拆分，但没说怎么打包 Edge 二进制。在 Tauri 2 里有两条路：

- **Sidecar binary**（推荐）：把 `agenthub-edge.exe` 声明在 `tauri.conf.json` 的 `bundle.externalBin`，跨平台路径由 Tauri runtime 管。优点：用户体验最像"原生应用"；缺点：CI 需要为三个平台分别 `go build` Edge。
- **用户手动启动 Edge**：Desktop 只检测端口、不负责生命周期。优点：开发期最简单；缺点：永远到不了"双击就能用"的产品体验。

建议：M2.1 先做"Desktop 检测 Edge 在线 + 明确状态提示"（不需要选型），M2.2 启动 sidecar 路线之前先在 `docs/operations/client-roadmap.md` 单独 200-300 行写清楚 cross-platform 打包方案。否则后期返工成本极高。

### 2.5 API 契约缺"已实现 / 待实现"双轨标注

`api/openapi.yaml` 当前对 P0-P4 endpoint 一视同仁列出，但实际上：

- Edge 真正实现的只有 `/v1/health`、`/v1/runners`、`/v1/runs`、`/v1/runs/{id}:cancel`、`/v1/events`。
- 其他 25+ endpoint 是契约级占位。

任何新接手的 Agent 读 `openapi.yaml` 会默认"这些都能调用"。建议在 `api/conventions.md` 或 OpenAPI 的 `tags` 元数据上加一列 status（`implemented` / `contract-only` / `planned`），或者更简单：在 `api/README.md` 顶部维护一张"当前已实现 endpoint 清单"，5 行就够，但能挡掉很多误解。

同理 `api/events.md` 现在列了 ~30 事件，但 Edge 实际发出的只有 4 个 run 类事件 + 2 个 runner 类事件，也建议加状态标注。

### 2.6 `docs/operations/client-handoff.md` 的生命周期红线

`AGENTS.md` §5 明确：`docs/operations/client-roadmap.md` 完成后可归档进 `docs/archive/`，"不要长期扩写成第二套实现文档"。`client-handoff.md` 性质相同——它是"当前客户端接手方式"，不是制度。

当前实际情况：handoff 还在被持续扩写，且工作区里还有未提交的 handoff 改动。建议在 M1.1 收口的同一个 PR 里：

- 给 `client-handoff.md` 顶部明确写"lifetime：M1 收口后归档至 `docs/archive/`"。
- 把不属于"接手手册"的长期内容（比如安全约束、命令清单）回收进三份主文档。

否则一个月后这份文档就会膨胀成第二个 `AGENTS.md`，违背三份主文档收敛原则。

## 3. 建议路线（增量补充 Reviewer1 §4）

Reviewer1 给的"M1 收口 → Edge SQLite → Runner adapter → Diff → Preview"主线我赞同。在此之上加两条本文独有的次序调整：

### 3.1 M1 收口必须包含"仓库卫生"任务

在 Reviewer1 §4 第一优先级的验收命令前，先做：

```powershell
# 1. 把 .exe 从跟踪中移除并加入 .gitignore
git rm --cached edge-server/agenthub-edge.exe
git rm --cached edge-server/agenthub-edge-tmp.exe
git rm --cached runner/agenthub-runner.exe

# 2. 把 master 上的 DB 选型 rebase 进来
git fetch origin
git rebase origin/master

# 3. 清理已合并的远程分支
git push origin --delete feat/client-edge-foundation feat/client-runner-mock feat/client-desktop-shell
```

这三步加起来不到 15 分钟，但延后到 M2/M3 就会变成"分支历史不干净" + "二进制冲突" + "CI build 与 repo 二进制版本错位"等综合症。

### 3.2 Runner adapter 选型建议：Codex CLI 优先

Reviewer1 §3.3 说"Codex CLI 和 Claude Code 先选一个"，没给方向。我的建议是 **Codex CLI 优先**，理由：

1. Codex CLI 的 stdout/stderr 协议在外部社区已经被多个 wrapper（codex2api 等）验证过，错误模式相对稳定，适合先趟通 adapter 抽象。
2. Claude Code 有官方 Agent SDK，未来可以作为更深的集成，但 SDK 集成与 CLI subprocess 是两个抽象层次，混在一起会污染 adapter 接口设计。先用 CLI 接 Codex，把 adapter 抽象做对，第二个再接 Claude Code 既能验证泛化，又能为后续 SDK 集成铺路。
3. Codex CLI 在 Windows 上的运行情况相对成熟，与当前主要开发环境一致，能减少 P0 阶段的环境问题。

不强求；如果团队对 Claude Code 更熟悉，先接 Claude Code 也合理。**关键是只接一个，先把 adapter 抽象做对**。

### 3.3 Edge SQLite 与 Runner adapter 并行的可能性

Reviewer1 把 Edge 数据层放在 Runner adapter 之前，按"基础先行"逻辑合理。但客户端方向是三人分工里"Desktop + Runner + Edge 调度"一肩挑，如果只有一个开发者推进，可以考虑：

- **顺序做**：先 Edge SQLite store（M4 前置），再 Runner adapter（M3）。
- **并行做**：Edge SQLite schema 设计是文档工作（1-2 天），代码实现期间 Runner adapter 可以独立推进，两者只在 `runs / items` 两张表上交汇。

如果团队带 subagent，可以让一个 subagent 起 Edge SQLite schema 草案（只写 `docs/edge-store-schema.md`，不动代码），主 Agent 同时推 Runner adapter，两条线在 M3 末尾汇合。

## 4. CI 扩展的具体建议

Reviewer1 §3.4 说 CI 要扩到 Go test + pnpm test + pnpm build，我同意。补两点：

1. **CI 不要用仓库里的 `.exe`**：上一节已说要从跟踪移除。CI 应该自己 `go build`。
2. **Playwright e2e 拆成可选 job**：在线用例需要先启动 Edge，离线用例可以独立跑。建议 PR CI 只跑离线 + 单测，nightly 或手动触发跑完整 e2e。这样 PR 反馈时间不会被 e2e 拖到 5 分钟以上。

## 5. 暂不建议（与 Reviewer1 §5 一致，补充一条）

5. **暂不建议在 `feat/client-dev` 上做"大重构"**。当前分支已经领先 master 19 个 commit，PR #26 还在 Draft。继续在同分支堆功能只会让 PR 越来越难审。M1 收口后建议立即合并到 master（即使保留为长期集成分支也要先做一次合并），然后再从 master 切 M2/M3/M4 短分支。

## 6. Reviewer2 结论

AgentHub 当前最大的资产是"路线收敛 + 客户端 mock 链路成立"，最大的风险是"工程债开始累积"——14 个未提交改动、3 个误入库的 .exe、1 个 master 未回流的 commit、3 条应清理的远程分支、契约领先实现 25+ endpoint 但无状态标注。这些都不是单独的大问题，但叠加起来会让 M2/M3 推进速度逐步下降。

建议本周节奏：

```text
今天/明天：M1 收口（review + commit + rebase + 清理 .exe + 删冗余分支 + 更新 PR #26）
本周末：起草 Runner adapter 设计稿 + Edge SQLite schema 草案
下周：M3.1 Runner sanitizer + 接入第一个真 CLI（Codex 优先）
下下周：M4.1 Edge SQLite store 落地，跑通 projects/threads/runs/items 持久化
```

特别强调一点：**Runner 接真 CLI 之前必须先有 sanitizer 契约**。这条不是优化，是安全红线，应该在 M3 之前就写进 `api/events.md`。

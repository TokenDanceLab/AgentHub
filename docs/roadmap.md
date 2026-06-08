# AgentHub 路线图

> 最后更新：2026-06-08 11:51 +08:00
> 当前主线：`origin/dev/delicious233`，以最新远端 dev 为开发事实源
> 稳定候选：`v0.3.0-rc.1 @ 0c79f277`
> 历史流水已归档：[archive/roadmap-pre-refresh-20260608-1008.md](archive/roadmap-pre-refresh-20260608-1008.md)、[archive/roadmap-full-history-20260605.md](archive/roadmap-full-history-20260605.md)

## 目标

AgentHub 要完成一个可运行、可解释、可演示的多 Agent 协作平台：IM 聊天、单聊/群聊、多 Agent 调度、上下文连续、代码/Diff/网页/文件产物预览与操作，以及 Desktop、Web、Hub、Edge、CLI adapter 的真实端到端闭环。

比赛需求入口：`D:\Code\TokenDance\docs\competition\bytedance.md`。AgentHub 当前证据入口：[competition/teamrun-e2e-evidence.md](competition/teamrun-e2e-evidence.md)。该证据只证明桥接链路与打包路径，不代表最终 3 分钟视频或两 runtime 实跑完成。

## 当前基线

| 项 | 状态 |
|---|---|
| dev | `origin/dev/delicious233`；具体 HEAD 以 `git log -1 origin/dev/delicious233` 为准 |
| 稳定候选 | `v0.3.0-rc.1 @ 0c79f277` |
| 主工作树 | `D:\Code\TokenDance\AgentHub @ a4b27d63`，behind 23 且 dirty；只读，不直接 pull/merge/stage |
| 后端线程 | 已关闭；后续 backend/API/Edge 由主线程按短切片派 subagent/worktree |
| 已合入主干 | shared v4 workbench、Web Hub-only 主链路、Contacts/AgentProfile/Projects read-through、AgentProfile mutation、Hub Projects P1、ExecutionTarget contract、Edge pins/store/event contracts、TeamRun fixture/evidence gate |
| 仍未完成 | Edge SQL 后续 migration、Desktop Edge mapper、登录端到端、Tauri 内测安装包/正式签名发布、TeamRun 真实演示、Artifact/Diff/Preview 生产化、Projects mutation UI、D1b/D2/D3 gate |
| 外部依赖 | 后端旧整合线合并由 backend merge Agent 负责；本路线图只记录其状态和对后续切片的影响，不接管合并 |

## P0 执行顺序

| 顺序 | 切片 | 边界 | 最低门禁 |
|---:|---|---|---|
| 1 | Roadmap/tag/worktree 收口 | `v0.3.0-rc.1` 已打；roadmap 压缩；分支清理先审计不批量删 | docs diff-check、root governance、worktree audit |
| 2 | Edge SQL/store migration | G0 contract 已覆盖 memory/file/sqlite；`codex/edge-sql-store` 新增 SQLite opt-in snapshot backend，并显式支持 memory/file/sqlite backend 值；留空 backend 继续按旧规则自动选择 memory/file；后续再拆 relational migration | Edge store contract、cmd store config tests、edge short gate |
| 3 | Desktop Edge mapper / ExecutionTarget | Desktop 只经 Local Edge；Web 不动；给安装包提供可运行侧车基线 | Desktop platform、Edge focused、Rust host tests |
| 4 | 登录链路联调 | 先 fake/local；真实登录另批窗口；覆盖 Web session、Desktop loopback/keyring、Hub state expiry/replay | Web/Desktop auth tests、Hub OIDC tests、OIDC script `-LocalOnly` gate |
| 5 | Tauri 内测安装包 | Windows NSIS + portable zip 先做内部可安装包；版本对齐；updater metadata 从“可选复制”改为 gate | Tauri build/package dry run、installer artifact 检查、release policy |
| 6 | ByteDance / TeamRun demo | IM 群聊、多 Agent 调度、证据 inspector、录屏脚本 | readiness script、manifest、截图/视频/接口导出 |
| 7 | Artifact/Diff/Preview 生产化 | 去掉 demo evidence，补真实 artifact/diff/preview API | Edge API、shared inspector、Desktop/Web smoke |
| 8 | Projects create/update UI | Web/Hub only；不做 delete；排在存储/安装/登录之后 | Web focused、shared focused、Web typecheck、Web boundary |
| 9 | Release signing / macOS | Windows Authenticode；macOS arm64 DMG proof 后再做 Developer ID signing、entitlements、notarization、staple | `Get-AuthenticodeSignature`、`codesign`、`spctl`、`stapler` |
| 10 | D1b/D2/D3 gates | 先 policy；D3 继续 opt-in | CI policy、release review、artifact redaction |

## P1 后续

- Contacts mutation/schema。
- Agent marketplace、publish、install。
- Tasks/TeamRun 页面正式映射。
- Settings DB-backed preferences。
- Projects create/update UI 与 delete/soft-delete/orphan policy。
- Release workflow、Windows installer、updater metadata gate、macOS signing/notarization 自动化。
- Mobile v4 IM / remote client 支线。

## 分支和 Worktree

| Worktree / branch | 处理 |
|---|---|
| main `D:\Code\TokenDance\AgentHub` | behind + dirty，只读；不要直接开发 |
| `.worktrees/roadmap-release-readiness` / `codex/roadmap-release-readiness` | 当前 docs 切片；完成后推 dev，再清理 |
| `.worktrees/backend` / `feat/backend-edge-hub` | 旧整合线；`git cherry -v origin/dev/delicious233 feat/backend-edge-hub` 仍有未吸收提交；由 backend merge Agent 继续处理，本路线图只跟踪风险和依赖 |
| `backend-api-contract-0607`、`backend-cli-e2e-0607`、`backend-docs`、`backend-johnny-pick`、`backend-oidc-log-0607`、`backend-openapi`、`backend-release-artifact-0607` | 历史候选；逐个 `status` + `cherry` 后归档或抽取 |
| `backend-edge-split`、`backend-tests` | dirty 风险；保留，先审独有改动 |
| `integrate-codex-adapter-precheck` | 复核是否已被 A0+A 吸收后清理 |
| mobile worktrees | 低优先级支线，不混主线 |

清理规则：每个 worktree 清理前必须记录 `git status --short --branch` 和 `git rev-list --left-right --count HEAD...origin/dev/delicious233` 或等价 cherry 证据；dirty worktree 不批量删。

## 工程规则

- 所有实现用独立 worktree；主工作树只读到专门清理计划完成。
- 分支清理必须先由 subagent 出只读报告，主负责人逐项删除；禁止“一把删”。
- 主负责人管分支、合并、验证、roadmap；subagent 做明确实现切片或只读审计。
- Web 不引入 Local Edge/Tauri/filesystem；Desktop 不绕过 Edge 直接启 CLI。
- mock/demo 只能做预览和 fixture；生产项必须定义 owner/schema/mutation/loading/error/empty。
- 不提交 token、生产日志、本机 CLI 输出、私有服务器地址、个人路径截图或模型响应全文。
- 真实 CLI/model gate 只在 runner、预算、approval、artifact redaction 明确后运行。

## 下一步

1. 提交并推送本轮 roadmap/governance 刷新。
2. Review/merge Edge SQLite opt-in backend；下一片再拆 relational schema/migration。
3. 并行开 Desktop Edge mapper worker 和登录 fake/local gate worker，为安装包提供可运行前置条件。
   - 登录 fake/local gate 已补 Hub stale state `created_at` 拒绝和 `verify-oidc-flow.ps1 -LocalOnly` fake/static gate；该 gate 不连接 live Hub 或 TokenDance ID。
4. 开 Tauri Windows installer/updater metadata worker；macOS 正式签名另起 proposal。
5. 开 ByteDance/TeamRun demo evidence worker。

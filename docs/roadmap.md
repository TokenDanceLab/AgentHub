# AgentHub 路线图

> 最后更新：2026-06-08 16:19 +08:00
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
| 已合入主干 | shared v4 workbench、Web Hub-only 主链路、Contacts/AgentProfile/Projects read-through、AgentProfile mutation、Hub Projects P1、ExecutionTarget contract、Edge pins/store/event contracts、Edge SQLite opt-in + relational migration、TeamRun fixture/dry evidence gate、Artifact/Diff/Preview read-only Edge 前置 |
| 仍未完成 | Desktop target preference/Tauri host 集成、登录端到端、Tauri 正式签名发布与 macOS 打包、TeamRun 真实演示、Artifact/Diff/Preview runtime evidence 写入与生产化、Projects mutation UI、D1b/D2/D3 gate |
| 当前候选切片 | `codex/desktop-target-tauri-host`：Desktop-owned Local Edge target preference 与 Tauri host readiness，待 rebase/verify/merge |
| 外部依赖 | 后端旧整合线合并由 backend merge Agent 负责；本路线图只记录其状态和对后续切片的影响，不接管合并 |

## P0 执行顺序

| 顺序 | 切片 | 边界 | 最低门禁 |
|---:|---|---|---|
| 1 | Roadmap/tag/worktree 收口 | `v0.3.0-rc.1` 已打；roadmap 压缩；分支清理先审计不批量删 | docs diff-check、root governance、worktree audit |
| 2 | Edge SQL/store migration | SQLite opt-in snapshot backend 和 relational migration v2 已合入；后续只做 runtime evidence 写入和真正 artifact lifecycle，不再把 schema 混进 UI 切片 | Edge store contract、cmd store config tests、edge short gate |
| 3 | Desktop Edge mapper / ExecutionTarget | Desktop 只经 Local Edge；Web 不动；mapper 首片已合入，当前收口 Local Edge target preference / Tauri host readiness | Desktop platform、Edge focused、Rust host tests |
| 4 | 登录链路联调 | 先 fake/local；真实登录另批窗口；已补 Hub state expiry/replay 与 OIDC `-LocalOnly` gate；后续覆盖 packaged Desktop loopback/keyring | Web/Desktop auth tests、Hub OIDC tests、OIDC script `-LocalOnly` gate |
| 5 | Tauri 内测安装包 | Windows NSIS + portable zip 先做内部可安装包；`codex/tauri-package-readiness` 已补版本对齐、独立 release readiness workflow 和 updater metadata gate；正式签名发布仍后置 | `scripts/verify-tauri-package-readiness.ps1`、installer artifact 检查、release dry policy |
| 6 | ByteDance / TeamRun demo | dry fixture evidence pack 已合入；真实 IM 群聊、多 Agent 调度、证据 inspector、录屏脚本仍待 runtime/UI 证据 | readiness script、manifest、截图/视频/接口导出 |
| 7 | Artifact/Diff/Preview 生产化 | read-only Edge API 首片已补 `GET /v1/runs/{runId}/diff`、`GET /v1/artifacts`、`GET /v1/previews`；下一步再补 runtime evidence 写入、preview lifecycle、artifact content/apply/discard | Edge API、shared inspector、Desktop smoke；Web 仍不直连 Edge |
| 8 | Projects create/update UI | Web/Hub only；不做 delete；排在存储/安装/登录之后 | Web focused、shared focused、Web typecheck、Web boundary |
| 9 | Release signing / macOS | Windows Authenticode；macOS arm64 dry validation 另起 proposal 后再做 Developer ID signing、entitlements、notarization、staple | `Get-AuthenticodeSignature`、`codesign`、`spctl`、`stapler` |
| 10 | D1b/D2/D3 gates | 先 policy；D3 继续 opt-in | CI policy、release review、artifact redaction |

## P1 后续

- Contacts mutation/schema。
- Agent marketplace、publish、install。
- Tasks/TeamRun 页面正式映射。
- Settings DB-backed preferences。
- Projects create/update UI 与 delete/soft-delete/orphan policy。
- `release.yml` 保留 tag release 语义；`release-readiness.yml` 只做内测 dry package policy。Windows Authenticode 与 macOS Developer ID/notarization 自动化另起 proposal。
- Mobile v4 plan 已收敛到 `app/mobile/docs/mobile-v4-plan.md`；低优先级支线，主参考飞书 IM mobile、辅参考 Codex mobile chat，后续不混入 Desktop/Web v4 主门禁。

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
2. Edge SQLite opt-in backend、Edge relational schema/migration、登录 fake/local gate、Tauri Windows installer/updater metadata readiness、TeamRun dry evidence 和 Artifact/Diff/Preview read-only Edge 前置已合入；真实登录、runtime evidence 写入和正式签名继续拆独立 proposal。
3. Desktop Edge mapper 首切片已合入：已接入 Edge agents/model catalog/Local Edge target mapper，并在 review 修正 StartRunRequest adapter id 映射、移除 provider 提交字段、阻断 Desktop live 空线程/demo transcript fallback；`codex/desktop-target-tauri-host` 正在收口 Desktop-owned Local Edge target preference、Tauri host readiness command 和 sidecar launch args 测试，安装包联调后置。
4. macOS 正式签名、notarization、staple 另起 proposal，不混入 Windows readiness。
5. 下一片 Artifact/Diff/Preview 只接 runtime evidence 写入和 inspector snapshot，不碰 preview start/stop 或 artifact apply/discard。
6. TeamRun 下一步从 dry fixture evidence 升级到真实 runtime/UI 证据，但仍不跑未批准的 D3 real CLI/model gate。

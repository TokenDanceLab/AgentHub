# Integration Worktree Notes

最后更新：2026-05-26

本文只记录 integration sweep 的仓库事实和合并约束，不记录私有绝对路径或生产秘密。

## 已核对事实

- 当前 integration 分支：`feat/team-integration-sweep`；本轮已合入四个候选分支并追加 follow-up 修复，具体 HEAD 以 `git log -1` 为准。
- 当前保存进度见 `docs/handoff/integration-sweep-2026-05-26.md`；远端 draft PR 为 https://github.com/TokenDanceLab/AgentHub/pull/197。
- 主开发基线：`dev/delicious233`，主 worktree HEAD `69085d5`。
- 主 worktree dirty，仍有 UIUX、OIDC、Web 相关并行改动；integration 文档不能把这些改动写成已合并或已验证。
- 当前登记的 worktree 以 `git worktree list` 实时输出为准；本轮用于验证的是 `.worktrees/team-integration-verify`。
- Web parity 分支 `worktree-feat+web-desktop-parity` 仍保留；具体 worktree 路径需实时核验，旧 `feat/webui-desktop-port` 不能代表当前 Web 状态。
- 不强制整理或提交正在开发的 `dev/delicious233` 主工作树；integration branch 只保存本代理负责的合并、验证、issue/PR 记录。

## 候选分支状态用语

在 integration sweep 结束前，候选分支统一写作“integration 中处理”。该状态只表示候选改动已进入集成视野，或已进入 integration 分支但还没有完成最终验收，不表示：

- 冲突已经解决。
- 分支已经合入 `dev/delicious233`。
- 测试、构建、lint 或 Playwright 已通过。
- Web worktree 可以删除。

完成态必须同时具备：合并 diff、冲突处理说明、fresh 验证命令和 `git status --short --branch` 证据。

## 当前已进入 integration 的分支

| 分支 | 当前 integration 状态 |
|---|---|
| `feat/team-adapter-compat` | 已合入 `feat/team-integration-sweep`；adapter targeted test 已通过 |
| `feat/team-hub-reliability` | 已合入 `feat/team-integration-sweep`；Hub affected packages targeted test 已通过 |
| `feat/team-hub-authz` | 已合入 `feat/team-integration-sweep`；Hub affected packages targeted test 已通过 |
| `feat/team-johnny-merge` | 已合入 `feat/team-integration-sweep`；conflicts resolved in `api/events.md` and `edge-server/internal/lifecycle/process_executor_test.go`; Go/OpenAPI validation passed; schema smoke pending before release |

## 本轮 follow-up 修复

- `api/events.md`：修复 Johnny conflict resolution 后断开的 implementation status 句，并把 `run.agent.file_change` 记录为 adapter union payload。
- `edge-server/internal/lifecycle/process_executor.go`：adapter mode 直接传完整 `RunProcessContext`，避免 Codex/OpenCode/Claude 新 runtime 参数在真实 run 链路丢失。
- `edge-server/internal/adapters/control_protocol.go`：`ChannelPermissionDecider` 支持按 `RequestID` 匹配 decision；空 `RequestID` 仍兼容 legacy single-flight 调用。
- `hub-server/internal/ws/manager.go` 与 `hub-server/internal/app/app.go`：同类型多设备只在 `device_id` 相同时替换旧连接，避免第二台 desktop 登录误踢第一台 desktop。

## 本轮验证

- `edge-server && go test ./... -short -count=1`
- `hub-server && go test ./... -short -count=1`
- `python -c "import pathlib, yaml; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('openapi yaml ok')"`
- migration `.up.sql` 版本前缀唯一性检查
- `git diff --check`

## PR / Issue 保存状态

- Draft PR: https://github.com/TokenDanceLab/AgentHub/pull/197
- Migration smoke blocker: https://github.com/TokenDanceLab/AgentHub/issues/196
- CI triage 已记录在 PR 评论中；Web/UI conflict markers、Go lint toolchain、Linux-only store test failure 不从本 integration branch 静默代修。

## Migration 状态

`hub-server/migrations` 当前有 28 个 `.up.sql` 文件。`dev/delicious233` 的 migration sequence 修复已合入 integration；最终连续后缀如下：

| 新编号 | 文件 |
|---|---|
| `0020` | `0020_token_dance_sub.up.sql` |
| `0021` | `0021_devices_allow_multiple_same_type.up.sql` |
| `0022` | `0022_agent_profiles.up.sql` |
| `0023` | `0023_execution_targets.up.sql` |
| `0024` | `0024_message_attachments.up.sql` |
| `0025` | `0025_skills.up.sql` |
| `0026` | `0026_mcp_servers.up.sql` |
| `0027` | `0027_provider_bindings.up.sql` |
| `0028` | `0028_audit_events.up.sql` |

处理要求：

- `.down.sql` 已随同 `.up.sql` 重命名；后续如果修改 migration 文件名，必须保持 up/down 配对。
- 更新引用旧 `0019_token_dance_sub`、`0020_agent_profiles`、`0021_execution_targets` 或 integration 临时 `0022_token_dance_sub` 名称的文档和验证记录。
- 重新跑 migration 相关测试或最小 schema smoke 后，才能写“migration chain clean”。
- 在确认目标环境 `schema_migrations` 状态前，不要把 renumber 直接用于生产回滚说明。

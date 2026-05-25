# 分支路线图：chore/repo-agent-loop

最后更新：2026-05-23

## 分支目标

在 `chore/repo-agent-loop` 上整理仓库级 `set-goal` skill、Agent 开发循环、路线图体系和 `.codex` 白名单规则。

## 写入范围

- `.codex/skills/set-goal/`
- `docs/roadmap.md`
- `docs/roadmaps/**`
- `AGENTS.md`
- `.gitignore`

## 已完成

- [x] 将 `set-goal` 复制为仓库级 skill。
- [x] 只放行 `.codex/skills/set-goal/**`，继续忽略其它 `.codex` 本机状态。
- [x] 将路线图移动到 `docs/` 下。
- [x] 拆分总路线图、前端路线图、后端路线图、客户端路线图和当前分支路线图。
- [x] 将 Agent 开发 Loop、交叉 review、验证和 git 收口规则内嵌到仓库级 skill references。
- [x] 在根 `AGENTS.md` 中明确持续推进类任务必须加载仓库级 `set-goal` skill。

## 下一步

- [x] 中文化 `.codex/skills/set-goal/`。
- [x] 同步 `AGENTS.md` 的路线图路径说明。
- [x] 运行文档和 API 最小校验。
- [x] 提交当前仓库治理增量。
- [x] 推送分支并创建 PR 到 `master`。

## 验收记录

- 通过：`git diff --check`
- 通过：`python -c "import yaml, pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8')); print('yaml ok')"`
- 已检查：`git status --short --branch`
- 已检查：只放行 `.codex/skills/set-goal/**`，未放行其它 `.codex` 本机状态。
- PR：`https://github.com/TokenDanceLab/AgentHub/pull/27`

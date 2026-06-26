# Archived Project Skills

这些 skill 已从 active `.agents/skills/` 移出，只保留历史参考。Agent 不应从这里加载执行流程；当前可用仓库级 skill 以根目录 `AGENTS.md` 的白名单为准。

| Skill | 归档原因 | 替代入口 |
|---|---|---|
| `ui-screenshot` | 旧截图脚本和 mock 注入口径过窄，容易把 Vite renderer 截图误写成真实 Desktop/Tauri 证据 | `.agents/skills/real-e2e-acceptance/` + app 内 `test:visual:*` |
| `dev-team` | 旧并行团队 SOP 与当前 spec-driven/dev-loop/workflow 规则重复 | `AGENTS.md` 并行协作策略 + `.agents/skills/dev-loop/` |
| `dev-team-codex` | 旧 Codex 队形和模型命名已过时，容易和实际可用模型/权限冲突 | `AGENTS.md` 并行协作策略 + `.agents/skills/dev-loop/` |

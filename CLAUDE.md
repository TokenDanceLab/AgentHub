# CLAUDE.md — AgentHub (Claude Code 专用)

> 完整开发规范见 `AGENTS.md`。本文件是 Claude Code 特化规则，不重复 AGENTS.md。

## 0. 入口
1. 先读 `AGENTS.md`，再读本文件。
2. 长程任务默认走 spec-driven-develop；短任务（单文件修复、typo）直接做。
3. 涉及 `../` workspace 治理时，同步读 `../AGENTS.md` 和 `../docs/`。

## 1. 当前进度
- 如果 `docs/progress/MASTER.md` 存在，活跃任务、分支、阶段和验收以它为准。
- 如果不存在活跃 MASTER，先读 `docs/roadmap.md`、`docs/architecture.md` 和 `docs/archives/README.md`；不要把归档专项当成当前任务。
- 不在本文件硬编码某个历史 Phase 或分支；过期任务完成后归档到 `docs/archives/`。
- UI 改动必须有明确任务、SPEC/验收和测试证据；模式、mock、manifest 状态留在状态区或设置区，不进主聊天流。

## 2. 关键命令
```powershell
# 同步基线
git checkout dev/delicious233 && git pull --ff-only

# Go 后端
cd hub-server && go test ./... -short -count=1
cd edge-server && go test ./... -short -count=1

# 前端
cd app/desktop && pnpm test && pnpm typecheck && pnpm build
cd app/web && corepack.cmd pnpm typecheck && corepack.cmd pnpm exec vite build

# API 校验
python -c "import yaml,pathlib; yaml.safe_load(pathlib.Path('api/openapi.yaml').read_text(encoding='utf-8'))"

# 提交前自检
git diff --check; git status --short --branch

# 治理门禁
.\scripts\verify-ci-gates.ps1
.\scripts\verify-project-skills.ps1
```

## 3. Claude 特化规则
- **不猜测**：不确定的路径、配置、状态先读文档或问，禁止基于假设修改。
- **小步提交**：每个独立改动完成后立即 commit + push，不攒变更。
- **范围锁**：只改任务卡允许的路径；发现范围不够停下报告，不自行扩大。
- **验收证据**：完成声明附测试输出、typecheck 结果或截图，禁止空口声称。
- **CI 不降级**：不通过降低阈值、放宽规则、跳过步骤来让 CI 变绿。
- **冲突标记零容忍**：提交前 `git diff --check` 必须干净。

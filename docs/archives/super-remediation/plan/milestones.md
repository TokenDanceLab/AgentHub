# AgentHub SUPER 修复 — 里程碑

> 生成日期：2026-06-19 | Phase 3 | Spec-Driven Develop

| 里程碑 | Phase | 任务数 | 目标 |
|---|---|---|---|
| **M1** 后端安全基线 | 1 | 12 | 进程崩溃路径清零、密钥泄漏清零、CI 恢复 |
| **M2** Edge 安全边界 | 2 | 7 | 远程执行生产级授权、子进程硬化 |
| **M3** 架构债务清偿 | 3 | 5 | S.U.P.E.R 违规热点消除、可靠交付 |
| **M4** 前端与 Mobile 质量 | 4 | 7 | Web 不白屏、Mobile @shared、分支同步 |
| **M5** 文档一致与平台完备 | 5 | 17 | 文档=代码、bash 平台、Mobile CI |
| **M6** 发布就绪 | 1-5 | 48 | SUPER ≥80、release gate 通过 |
| — | 6 | 4 | 延后项（不阻断发布） |

## M1: 后端安全基线

**验收命令**:
```bash
# 零 panic 崩溃
cd hub-server && go test ./... -short -count=1
# Docker 无密钥泄漏
docker inspect agenthub-postgres agenthub-redis 2>/dev/null | grep -i password || echo "clean"
# 测试全通过
cd app/desktop && pnpm test  # 150/150 files pass
cd app/web && pnpm test       # 21/21 files pass
# release.sh 功能完整
bash scripts/release.sh 0.5.1-rc.1 --dry-run --skip-tests --skip-build --skip-upload
```

## M2: Edge 安全边界

**验收命令**:
```bash
# Edge 远程读路由按资源授权
cd edge-server && go test ./internal/httpserver -run TestRemoteRead -count=1 -v
# Run-start 双 token
cd edge-server && go test ./internal/api -run TestRunStartDualToken -count=1 -v
# 子进程 env 范围化
cd edge-server && go test ./internal/lifecycle -run TestEnvAllowlist -count=1 -v
```

## M3: 架构债务清偿

**验收命令**:
```bash
# app.go <50 行
wc -l hub-server/internal/app/app.go  # expected: <50
# agent_team 拆分为 6 文件
ls hub-server/internal/service/agent_team_*.go | wc -l  # expected: 6
# 零循环引用
rg -n "SetControlService|SetTeamRouteHandler|SetRelayService|SetDesktopTargetRegistrar" hub-server/internal/service/*.go  # expected: 0 results
# Outbox 测试
cd hub-server && go test ./internal/service -run TestOutbox -count=1 -v
```

## M4: 前端与 Mobile 质量

**验收命令**:
```bash
# Web ErrorBoundary
rg -n "ErrorBoundary" app/web/src/main.tsx  # expected: match
# HubClient timeout
rg -n "AbortController" app/web/src/api/hubClient.ts app/desktop/src/api/hubClient.ts
# Mobile @shared
rg -n "@agenthub/shared" app/mobile-rn/package.json  # expected: match
# Mobile typecheck 零错误
cd app/mobile-rn && npx tsc --noEmit  # expected: exit 0
# 分支同步
git log origin/dev/delicious233..origin/master --oneline | wc -l  # expected: 0
```

## M5: 文档一致与平台完备

**验收命令**:
```bash
# API doc 零不匹配
python scripts/verify-openapi-routes.py  # expected: 0 mismatches
# 阶段命名统一
rg -n "Phase [A-D]" AGENTS.md docs/contributing.md  # expected: 0 results
# bash 等价脚本
bash -n scripts/verify-ci-gates.sh && echo "syntax ok"
bash -n scripts/verify-release-gate.sh && echo "syntax ok"
# Mobile CI job
rg -n "mobile-rn" .github/workflows/checks.yml  # expected: match
```

## M6: 发布就绪

**验收命令**:
```bash
# Release gate 通过
powershell -NoProfile -File scripts/verify-release-gate.ps1 -RepoRoot . -SkipRefCheck
# SUPER 总分
# 预期: ≥80/100
```

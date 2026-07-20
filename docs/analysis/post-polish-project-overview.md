# Post-Polish Project Overview

> last-updated: 2026-07-20  
> program: post-visual-polish engineering residual (SDD Phase 1)  
> authority: does **not** replace `AGENTS.md` / `docs/architecture.md` / live `docs/progress/MASTER.md`  
> prior program: Visual polish Phases 73–78 closed · gate **89 Ship** · tip `a0392dae`+

## Preliminary Direction (Phase 0)

**结论：不写 rewrite；在 Visual QA 89 收官后，做 knowledge-first + strangler 的工程残差清理。**

| 已完成 | 残余焦点 |
|---|---|
| Visual QA gate 89 · 7/9 维度满分 | Type/Motion/Empty 静态方法论天花板（非主线） |
| hubClient Desktop/Web thin re-export (#432/#433) | Mobile hubClient 仍 ~685 LOC 兼容层 |
| Edge handlers / ProcessExecutor / Workbench 已大幅削薄 | 巨型 **测试** 文件与 agentteam 浓度 |
| CI 统一 `changes` 路径筛选 | docs 中历史 plan 指针漂移 |
| Backend perf/leak gate 脚本 **绿** | 多数 High 安全项需 deploy/client 证据，非纯代码 |

## Current Architecture (stable)

```text
Desktop/Web/Mobile → shared workbench → Hub (control) → Edge (execution) → adapters
```

- **Hub**: 身份、IM/同步、路由、审计、TeamRun  
- **Edge**: lifecycle、adapters、store、workspace  
- **Shared**: transcript、workbench、hubClient SSOT  
- **CI**: `checks.yml` 统一 `changes` job（desktop/web/shell/go）

## Entry / Build

| Surface | Entry | Port |
|---|---|---:|
| Desktop Vite | `app/desktop` | 5173 |
| Web Vite | `app/web` | 5174 |
| Hub | `hub-server` | 8080 |
| Local Edge | `edge-server` | 3210 |

## Tracking Mode

**GITHUB_FULL**（`gh` + `repo` + `project` scopes 已具备）。

## Out of Scope for Next Program

- Big-bang rewrite / 全量 Mobile UI 重构  
- 需要 staging secret / live OIDC / packaged Desktop 证据的发布关闭  
- 纯静态截图再冲 90+（方法论天花板）

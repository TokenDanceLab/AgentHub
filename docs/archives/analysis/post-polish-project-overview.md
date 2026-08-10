# Post-Polish Project Overview

> pending external archive — see docs/history.md
> last-updated: 2026-07-21
> program: post-visual-polish engineering residual — **delivered** (Phases 79–80 · #1340–#1342)
> authority: does **not** replace `AGENTS.md` / `docs/architecture.md` / live `docs/progress/MASTER.md`
> prior program: Visual polish Phases 73–78 closed · gate **89 Ship**

## Outcome (2026-07-21)

| Delivered | Result |
|---|---|
| Docs authority (Phase 79) | cleanup `docs/plan/*` HISTORICAL banners; MASTER sole index; perf-gate PASS noted · #1340 |
| Mobile hubClient thin (Phase 80) | Proxy over shared SSOT · ~737→~342 LOC · Hub-only boundary in AGENTS + mobile README · #1341 |
| Closeout | MASTER/roadmap phases closed · #1342 |

## Preliminary Direction (Phase 0 snapshot — historical)

**结论：不写 rewrite；在 Visual QA 89 收官后，做 knowledge-first + strangler 的工程残差清理。** — **已完成**。

| 已完成 | 残余（程序启动时）→ 现状 |
|---|---|
| Visual QA gate 89 · 7/9 维度满分 | Type/Motion/Empty 静态方法论天花板（仍非主线） |
| hubClient Desktop/Web thin re-export (#432/#433) | Mobile hubClient **已 thin**（#1341） |
| Edge handlers / ProcessExecutor / Workbench 已大幅削薄 | 巨型 **测试** 文件与 agentteam 浓度（可选） |
| CI 统一 `changes` 路径筛选 | 历史 plan 指针漂移 **已修**（#1340） |
| Backend perf/leak gate 脚本 **绿** | 多数 High 安全项仍需 deploy/client 证据，非纯代码 |

## Current Architecture (stable)

```text
Desktop/Web/Mobile → shared workbench → Hub (control) → Edge (execution) → adapters
```

- **Hub**: 身份、IM/同步、路由、审计、TeamRun
- **Edge**: lifecycle、adapters、store、workspace
- **Shared**: transcript、workbench、hubClient SSOT（Desktop/Web/Mobile thin shells）
- **CI**: `checks.yml` 统一 `changes` job（desktop/web/shell/go）

## Entry / Build

| Surface | Entry | Port |
|---|---|---:|
| Desktop Vite | `app/desktop` | 5173 |
| Web Vite | `app/web` | 5174 |
| Hub | `hub-server` | 8080 |
| Local Edge | `edge-server` | 3210 |

## Tracking Mode

**GITHUB_FULL**。当前无 open residual SPEC；下一步从 `docs/roadmap.md` P0/P1 选取。

## Still out of scope (unchanged)

- Big-bang rewrite / 全量 Mobile UI 重构
- 需要 staging secret / live OIDC / packaged Desktop 证据的发布关闭
- 纯静态截图再冲 90+（方法论天花板）

# AgentHub 归档索引

| 项目 | 描述 | 时间 | 归档路径 |
|---|---|---|---|
| branch-hygiene | 分支混乱清理：删除 fork/* 48 个历史分支 + origin/dev/* 3 个早期 dev 分支，保留分支曾存在的痕迹；PR [#1501](https://github.com/TokenDanceLab/AgentHub/pull/1501) | 2026-08-02 | [branch-hygiene.md](./branch-hygiene.md) |
| docs-hygiene | 历史 analysis/plan 收拢：post-polish 双轨、一次性 inventory、rescore 系列移入 archives | 2026-08-02 | [analysis/](./analysis/) · [plan/](./plan/) |
| wiki-consolidation | wiki 孤儿知识面处置：14 个文件（pages/ 10 + 根 4）；module-hub 鉴权增量并入 01-hub-server、module-edge lifecycle/store 增量并入 02-edge-server，其余为重复/过时编译层归档；`wiki/` 目录移除 | 2026-08-02 | 详见 commit message（wiki/ 已删除，无独立归档目录） |
| api-deprecations | `api/deprecations.md` 孤儿删除（#1677）：全仓零引用；命名迁移已完成（AGENTS.md §3 术语表即现状 SSOT），Migration Plan（Q3/Q4 2026 加 `/v1/runtimes`）与 ACP 收敛现实脱节（edge 实际走 ACP，无新双轨；`runner_offline` Go 已无） | 2026-08-15 | 已删除，见 commit 8ecad0517 |
| e2e-test-fixtures | `app/e2e/test-fixtures.md` 孤儿删除（#1677）：旧 monorepo 快照（旧包名/旧命令），全仓零引用，与根 README 重复 | 2026-08-15 | 已删除，见 commit 8ecad0517 |
| backend-perf-gates | `docs/reference/backend-performance-gates.md` 归档：判据 (a) Gate Matrix 引用已重组包结构与已改名 benchmark（Hub EventBus 测试迁 `internal/bus/`、`BenchmarkEventBus`→`BenchmarkEventBusPublish`、OIDC 行为测试迁 `service/oidc/` 子包、Edge `BenchmarkBus`→`BenchmarkBusPublish*`）；判据 (c) Gate Matrix/Current Scope 与机器门禁 `scripts/verify/verify-backend-perf-leak-gates.py` 重复（脚本为 verifier-map 登记的 CI 执行者） | 2026-08-19 | [reference/backend-performance-gates.md](./reference/backend-performance-gates.md) |

## 15-verifier disposition

`scripts/verify/` 评估记录（2026-08-02 `chore/rule-enforcement`，#1515）：

- 评估后撤销归档 — 均有活跃执行引用，git mv 未执行，脚本仍保留在 `scripts/verify/`。
- OIDC 配置形状门禁 `verify-oidc-readiness.py` 已退役（#1653）；OIDC 真实流验证非 CI 静态门禁，见 `docs/governance/security-risk-register.md` AH-SR-035。
- `verify-edge-cli-json-readiness.ps1` 于 2026-08-04 #1610 零引用清理时删除。
- `.ps1` verifier 已统一迁为 `.py`；当前 `scripts/verify/` 列表以 `verify-doc-ssot.py` §9.5 映射表为准。

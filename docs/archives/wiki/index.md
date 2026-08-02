# Wiki Index

最后更新：2026-07-16

Catalog of AgentHub cleanup wiki pages. One-line summaries only; bodies live under `pages/`.

Control docs: [README](README.md) · [SCHEMA](SCHEMA.md) · [log](log.md)

## Overview

| id | type | summary |
|---|---|---|
| [[overview]] | overview | IM 形态多 Agent 协作工作台，Hub/Edge 双层架构，活跃开发期，聚焦文档治理与安全基线建立。 |
| [[architecture-seams]] | overview | 六条非协商架构边界、五层结构缝线、平台 contract 与授权/证据门禁，以 AGENTS.md 和 docs/architecture.md 为 SSOT。 |
| [[cleanup-playbook]] | overview | Strangler 五阶段清理剧本：分析落盘→P0 卫生→wiki 编译→Strangler 切片→安全闭环，含验证脊与禁止操作。 |

## Modules

| id | type | summary |
|---|---|---|
| [[module-hub]] | module | Hub Server 控制面：TokenDance ID RP、IM 中枢、AgentTeam 编排器、Edge 中继面，含鉴权两层模型与已知风险。 |
| [[module-edge]] | module | Edge Server 执行层：lifecycle 状态机、adapters 协议归一、SQLite EventStore，runners 兼容残留与 capability/outbox 缺口。 |
| [[module-frontend]] | module | 前端三平台（Desktop/Web/Mobile RN）共享 workbench/transcript/composer 合同，平台差异收口 adapter 层。 |

## Flows

| id | type | summary |
|---|---|---|
| [[flow-control-event]] | flow | 四条核心数据流（控制/事件/证据/同步），含协议边界、事件族与交叉约束。 |

## Hotspots

| id | type | summary |
|---|---|---|
| [[hotspots]] | hotspot | 全仓 39 个 god-file/债务热点 P0–P2 总览，含文件位置、规模、根因与推荐拆分方向。 |

## Risks

| id | type | summary |
|---|---|---|
| [[risks-open]] | risk | Open High 风险总览（AH-SR-037/045/046/049/028/035/036），每条附代码证据指针与关闭条件。 |

## Ops pointers

| id | type | summary |
|---|---|---|
| [[ops-hk3]] | ops-pointer | 生产运维指针：LIVE on hk3，CI 叙事漂移与已知矛盾汇总，运维事实 SSOT 在 server STATE.md。 |

## Status legend

| status | meaning |
|---|---|
| `active` | Safe to use as compiled orientation |
| `draft` | Scaffold only; verify against SSOT before relying |
| `stale` | Known drift or outdated; fix or archive |
| `archived` | Historical; do not drive new work |

## Seed status

All 10 page bodies under `wiki/pages/` have been compiled from SSOT sources. The following bootstrap-catalog entries were planned but do not yet have dedicated page bodies — their content is covered by existing pages or remains draft backlog:

| catalog id | covered by |
|---|---|
| hub-edge-overview | [[overview]] |
| ssot-map | [[overview]], [[architecture-seams]] |
| agenthub-cleanup-overview | [[overview]], [[cleanup-playbook]] |
| module-api-contracts | covered in [[module-hub]] / [[module-edge]] / api/ SSOT |
| flow-control-run, flow-event-transcript, flow-auth-session, flow-web-remote-control | covered in [[flow-control-event]] |
| ci-decommission-drift, deploy-image-name-divergence, deploy-template-divergence, edge-runners-compat, mobile-path-residue | covered in [[hotspots]] and [[ops-hk3]] |
| risk-evid-grade-confusion, risk-session-secret-boundary, risk-ah-sr-register | covered in [[risks-open]] and [[architecture-seams]] |
| decision-wiki-is-compiled, decision-incremental-cleanup, decision-production-live-narrative | covered in [[cleanup-playbook]] and [[overview]] |
| ops-evidence-boundary | covered in [[ops-hk3]] |

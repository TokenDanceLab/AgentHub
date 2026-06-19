# AgentHub SUPER 修复 — 任务分解

> 生成日期：2026-06-19 | Phase 3 | Spec-Driven Develop
> 策略：Bottom-Up Risk-Driven + Strangler-Fig Module-Driven 综合
> 总计：52 个任务，6 个 Phase

## Phase 概览

| Phase | 目标 | 任务数 | 并行 Lane |
|---|---:|---|
| Phase 1 | 后端安全与基础 — 消除进程崩溃路径、密钥泄漏、自我 DoS | 12 | Crash Safety / Secrets & Config / Auth & Rate Limiting / CI/Tooling Foundation |
| Phase 2 | Edge 安全加固 — 细粒度授权、双 token 信任、子进程环境硬化 | 7 | Edge Authorization / Edge Subprocess & Env / Hub JWT & WS Hardening |
| Phase 3 | 架构重构 — 拆分 3 个单体、消除循环引用、Hub-Edge 可靠交付 | 5 | DI & Wiring Split / Service Decomposition / Delivery Reliability |
| Phase 4 | 前端与 Mobile 质量 — Web 可靠性、Mobile @shared 接入、分支同步 | 7 | Web Reliability / Mobile @shared + Typecheck / Dev Branch Sync |
| Phase 5 | 文档、平台与打磨 — 文档与代码一致、bash 等价脚本、Mobile CI | 17 | Docs Reconciliation / Platform Parity / Mobile Testing & CI / Operational Polish |
| Phase 6 | 延后 — 外部依赖阻塞项 | 4 | External Dependencies |

---

## Phase 1 — 后端安全与基础（12 任务）

### Lane A: Crash Safety

| ID | 标题 | 优先级 | 工作量 | S.U.P.E.R | 依赖 |
|---|---|---|---|---|---|
| T001 | Hub: Gin Recovery 中间件加固（app.go:399） | P0 | S | S,R | — |
| T002 | Edge: security_hooks.go panic→error 转换 | P1 | S | S,R | — |
| T003 | Hub: user_settings.go 内部错误泄漏修复 | P0 | S | S | — |

### Lane B: Secrets & Config

| ID | 标题 | 优先级 | 工作量 | S.U.P.E.R | 依赖 |
|---|---|---|---|---|---|
| T004 | Docker: Redis 密码健康检查泄漏修复（-a flag） | P0 | S | S | — |
| T005 | Docker: 移除 config.docker.yaml 硬编码 dev_password | P0 | S | S | — |
| T006 | Docker: hk2 compose 转为 override 文件 | P1 | M | E,R | T004, T005 |

### Lane C: Auth & Rate Limiting

| ID | 标题 | 优先级 | 工作量 | S.U.P.E.R | 依赖 |
|---|---|---|---|---|---|
| T007 | Hub: 限流器 Redis 故障 fail-open 配置 | P0 | M | S,R | — |
| T008 | Hub: WebSocket auth.ok 竞态条件修复（writeLoop 顺序） | P0 | S | R | — |
| T009 | Hub: OIDC redirect_uri handler 层防御验证 | P0 | M | S | — |

### Lane D: CI/Tooling Foundation

| ID | 标题 | 优先级 | 工作量 | S.U.P.E.R | 依赖 |
|---|---|---|---|---|---|
| T010 | Vitest: ESM 导入修复（恢复 9 个失败测试文件） | P1 | M | E | — |
| T011 | Release: 重新实现 release.sh 丢失功能 + dry-run 验证 | P1 | M | P | — |
| T012 | CI: 添加漏洞扫描（pnpm audit + govulncheck） | P1 | M | S | — |

---

## Phase 2 — Edge 安全加固（7 任务）

### Lane A: Edge Authorization

| ID | 标题 | 优先级 | 工作量 | S.U.P.E.R | 依赖 |
|---|---|---|---|---|---|
| T013 | Edge: 远程读路由细粒度授权（AH-SR-045） | P0 | L | S | — |
| T014 | Edge: 双 token run-start 信任模型（AH-SR-046） | P0 | XL | S,U | T013 |

### Lane B: Edge Subprocess & Env

| ID | 标题 | 优先级 | 工作量 | S.U.P.E.R | 依赖 |
|---|---|---|---|---|---|
| T015 | Edge: 子进程环境变量范围化白名单（AH-SR-047） | P0 | M | S | — |

### Lane C: Hub JWT & WS Hardening

| ID | 标题 | 优先级 | 工作量 | S.U.P.E.R | 依赖 |
|---|---|---|---|---|---|
| T016 | Hub: JWT 密钥轮换机制（multi-key + kid + JWKS endpoint） | P1 | L | S | — |
| T017 | Hub: WS InsecureSkipVerify 修复（限定 dev origins 为 loopback） | P1 | S | S | — |
| T018 | Hub: WebSocket ReadTimeout 截止时间 | P1 | S | R | — |
| T019 | Hub: 限流器 off-by-one 修复（limit+1 → exact limit） | P1 | S | E | — |

---

## Phase 3 — 架构重构（5 任务）

### Lane A: DI & Wiring Split

| ID | 标题 | 优先级 | 工作量 | S.U.P.E.R | 依赖 |
|---|---|---|---|---|---|
| T020 | 拆分 app.go DI 单体（1081行→5文件，app.go ~50行） | P0 | XL | S,R | — |
| T021 | 修复服务层循环引用（消除所有 Set* setter injection） | P0 | L | U | T020 |
| T022 | Hub: AGENTHUB_ENV 从 os.Getenv 迁移到 ServerConfig | P1 | M | E,R | T020 |

### Lane B: Service Decomposition

| ID | 标题 | 优先级 | 工作量 | S.U.P.E.R | 依赖 |
|---|---|---|---|---|---|
| T023 | 拆分 agent_team.go（2313行→6文件+facade） | P0 | XL | S | — |

### Lane C: Delivery Reliability

| ID | 标题 | 优先级 | 工作量 | S.U.P.E.R | 依赖 |
|---|---|---|---|---|---|
| T024 | Hub-Edge 交付 outbox/journal（AH-SR-049） | P0 | XL | S,R,U | T020 |

---

## Phase 4 — 前端与 Mobile 质量（7 任务）

### Lane A: Web Reliability

| ID | 标题 | 优先级 | 工作量 | S.U.P.E.R | 依赖 |
|---|---|---|---|---|---|
| T025 | Web: root ErrorBoundary（基础设施，不改 UI 组件） | P1 | S | S,U | — |
| T026 | HubClient: AbortController + 30s 默认超时 | P1 | S | S,U | — |
| T027 | 前端: 浮出所有静默错误（6 sites + 7 event types） | P0 | M | S,U | — |

### Lane B: Mobile @shared + Typecheck

| ID | 标题 | 优先级 | 工作量 | S.U.P.E.R | 依赖 |
|---|---|---|---|---|---|
| T028 | Mobile: 连接 mobile-rn 到 @shared 包 | P0 | L | R | — |
| T029 | Mobile: 修复 exactOptionalPropertyTypes typecheck 错误 | P0 | S | E | T028 |
| T030 | Mobile: 添加 screen-level 渲染测试（5 screens） | P2 | L | E | T028, T029 |

### Lane C: Dev Branch Sync

| ID | 标题 | 优先级 | 工作量 | S.U.P.E.R | 依赖 |
|---|---|---|---|---|---|
| T031 | Git: 同步 dev 分支与 master + CI 防护规则 | P0 | M | P | T020, T021, T023, T010, T029, T011 |

---

## Phase 5 — 文档、平台与打磨（17 任务）

### Lane A: Docs Reconciliation

| ID | 标题 | 优先级 | 工作量 | S.U.P.E.R | 依赖 |
|---|---|---|---|---|---|
| T032 | 修复 API doc 路径不匹配（openapi.yaml vs router.go） | P2 | M | P | — |
| T033 | 修正架构文档 WS 事件数（26→33+） | P2 | S | P | — |
| T034 | 统一阶段命名为数字（Phase 1-7） | P2 | M | P | — |
| T035 | 修复 developer-quickstart.md 过期迁移数+端口/版本值 | P2 | S | P | — |

### Lane B: Platform Parity

| ID | 标题 | 优先级 | 工作量 | S.U.P.E.R | 依赖 |
|---|---|---|---|---|---|
| T036 | 为 6 个关键 PS 脚本添加 bash 等价版 | P2 | L | E | — |
| T037 | 修复架构文档过期引用（TranscriptView, adapter 数, 部署） | P2 | M | E | T034 |
| T038 | 修复 per-package README 过时内容 + reference/projects | P3 | S | E | T037 |

### Lane C: Mobile Testing & CI

| ID | 标题 | 优先级 | 工作量 | S.U.P.E.R | 依赖 |
|---|---|---|---|---|---|
| T039 | Mobile: 为 9 个未测试 primitive 组件添加渲染测试 | P2 | M | R | T028, T029 |
| T040 | CI: 添加 mobile-rn CI job（typecheck + tests） | P2 | M | E,R | T029, T030 |

### Lane D: Operational Polish

| ID | 标题 | 优先级 | 工作量 | S.U.P.E.R | 依赖 |
|---|---|---|---|---|---|
| T041 | Deps: 更新 dompurify 到最新 3.x patch | P2 | S | S | — |
| T042 | Hub: Redis 超时 1s→3s（环境变量可配） | P2 | S | R | — |
| T043 | Hub: 缓存 migration 版本结果（30s TTL） | P2 | S | R | — |
| T044 | Hub: 公开统计端点使用更粗粒度分桶 | P2 | S | S | — |
| T045 | Hub: 去重 normalizeJSONField 到共享 validation.go | P2 | S | E | — |
| T046 | Hub: 消除 session handler 参数命名歧义 | P1 | S | E,S | — |
| T047 | Hub: agent team create 添加长度验证 | P2 | S | E,R | — |
| T048 | Hub: TaskAck 空 body 添加警告日志 | P2 | S | R | — |

---

## Phase 6 — 延后（4 任务，不阻断发布）

| ID | 标题 | 优先级 | 阻塞原因 |
|---|---|---|---|
| T049 | OIDC/Desktop/Mobile 认证 live 证据（AH-SR-035/036/042） | P0 | 需 live TokenDance ID 环境 |
| T050 | Web session 强化（AH-SR-037）— 架构决策 + 实施计划 | P0 | XL 工作量，需架构决策 |
| T051 | 签名证书获取（外部采购，阻断 Tauri 发布） | P0 | 外部采购 |
| T052 | DB schema 外部文档（06-database-schema.md） | P3 | 低优先级 |

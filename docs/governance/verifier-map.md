# 规则 → 机器验证映射（verifier-map）

> Owner：本文件是 AgentHub「规则 → 机器验证」映射的 SSOT。`AGENTS.md` 的“规则 → 机器验证映射”只保留指针，不复制本表。
> 机器门禁：`scripts/verify/verify-doc-ssot.py` 校验本表验证脚本路径与 CI 文件存在性。

最后更新：2026-08-25（新增 shared 组件三件套棘轮行 #1951、test-sleep 值预算门禁行与 flake 登记处置映射行；前端 L0 稳定 required 聚合 frontend-required；CI job 映射对齐 checks/release-readiness 现状）

## 映射表

下表列出有机器管的规则与其验证脚本、CI job。`无` 表示暂无机器验证，靠人工自觉，规则本身不因此失效。映射只描述「有没有机器管」；规则本身的权威是 `AGENTS.md`，两者冲突时以 `AGENTS.md` 为准并更新本表。

| 规则 | 验证脚本 | CI job |
|---|---|---|
| CI 路径筛选与 job 结构（统一 `changes` job；design-css fail-closed 变异测试；go-edge/go-hub、backend-required 与 frontend-required 恒报 report 防 required check 跳过阻塞（backend-required 聚合后端 L0/L1/L2；frontend-required 聚合前端 L0：desktop/web/mobile-light/coverage）） | `scripts/verify/verify-ci-gates.py`（负向自测 `scripts/verify/tests/verify-ci-gates.Tests.py`） | checks.yml → validate |
| action runtime 只允许 node24（防 Node-20 major 回退，#1580） | `scripts/verify/verify-action-runtimes.py`（负向自测 `scripts/verify/tests/verify-action-runtimes.Tests.py`） | checks.yml → validate |
| Hub lint finding fingerprint ratchet（防新增/替换，#1573；go-hub 硬门禁，全量 lint 回退模式对 baseline 存量豁免） | `scripts/verify/verify-hub-lint-ratchet.py`（负向自测 `scripts/verify/tests/verify-hub-lint-ratchet.Tests.py`，baseline `scripts/verify/hub-lint-baseline.json`） | checks.yml → go-hub |
| Edge lint finding fingerprint ratchet（防新增/替换，#1840 对偶 #1573；go-edge 硬门禁，全量 lint 回退模式对 baseline 存量豁免） | `scripts/verify/verify-edge-lint-ratchet.py`（负向自测 `scripts/verify/tests/verify-edge-lint-ratchet.Tests.py`，baseline `scripts/verify/edge-lint-baseline.json`） | checks.yml → go-edge |
| test-sleep 门禁（#1550 计数棘轮只缩不增；#1565/#1948 值预算：预算文件存在、预算内路径真实、count/total_ms/max_ms/逐值与源码一致、非常量表达式 fail-closed、改 sleep 值不更预算即红） | `scripts/verify/verify-test-sleep-ratchet.py`（负向自测 `scripts/verify/tests/verify-test-sleep-budget.Tests.py`，值预算 `scripts/verify/test-sleep-budget.json`，计数基线 `scripts/verify/test-sleep-baseline.json`） | checks.yml → validate |
| skill 白名单只提交 active skill | `scripts/verify/verify-project-skills.py` | checks.yml → validate |
| 文档与 Agent 入口 SSOT：根级入口/路径/行数/标记/映射表保鲜；引用 AGENTS 规则必须写主题名、禁止章节编号 | `scripts/verify/verify-doc-ssot.py`（负向自测 `scripts/verify/tests/verify-doc-entrypoints.Tests.py`） | checks.yml → validate |
| Web Hub-only 边界（不直连 Local Edge） | `scripts/verify/verify-web-hub-boundary.py` | checks.yml → validate |
| Hub 纯包导入（不依赖框架包） | `scripts/verify/verify-hub-pure-packages.py` | checks.yml → validate |
| Mobile Hub-only 边界（不直连 Local Edge/runtime） | `scripts/verify/verify-mobile-hub-boundary.py` | checks.yml → validate |
| hubClient thin-shell SSOT（客户端不分叉 REST 实现） | `scripts/verify/verify-hubclient-ssot.py` | checks.yml → validate |
| Design token SSOT（CSS 硬编码颜色禁令） | `scripts/verify/verify-design-token-ssot.py` | checks.yml → validate |
| 核心 token/theme/preset CSS 仅 parser 语法门禁（fail-closed；Stylelint 被 ignore 排除，规则债另立，#1720） | `app/scripts/verify-design-css-syntax.mjs`（内置 `--self-test` 负向自测） | checks.yml → design-css |
| shared UI i18n callsite ratchet（#1612；违规文件数棘轮：仅当含 CJK 字面量且未导入 `useTranslation` 的违规文件数超过 baseline 时 fail，不比较字面量行数——既有违规文件内新增 CJK 字面量行不会触发；当前 advisory：validate step 带 `continue-on-error`，存量违规文件回填低于 baseline 后转硬门禁） | `scripts/verify/verify-i18n-callsites.py` | checks.yml → validate |
| shared 组件三件套棘轮（#1951：扫描 `app/shared/src/ui/**` 的 PascalCase 组件 `.tsx`；必须配对 `<组件>.test.tsx`（或 `__tests__/<组件>.test.tsx`）+ `<组件>.stories.tsx`，无关测试不得代替；验收标准见 `docs/component-acceptance.md`；存量缺件显式登记在基线、只缩不增） | `scripts/verify/verify-shared-trio-ratchet.py`（负向自测 `scripts/verify/tests/verify-shared-trio-ratchet.Tests.py`，基线 `scripts/verify/shared-trio-baseline.json`） | checks.yml → validate |
| 演示诚实：stub/fixture 不得冒充真实登录/API | `scripts/verify/verify-real-e2e-contract.py` | checks.yml → validate |
| 真实 E2E lane evidence manifest 六字段合同 + 私有信息脱敏（#1839/#1873：非 loopback URL host / 内网 IP / 绝对路径 / 内网后缀 hostname fail-closed；L3 仅 dispatch，不阻塞 PR） | `scripts/verify/verify-real-e2e-lane-manifest.py`（负向自测 `scripts/verify/tests/verify-real-e2e-lane-manifest.Tests.py`） | checks.yml → real-e2e-stack（自测 → validate） |
| real-e2e-stack ID 环境不透明化（#1873：不接受任意 URL / 镜像；只接受预登记 opaque ID choice；ID endpoint loopback-only；image 固定 allowlist） | `scripts/verify/verify-e2e-env-allowlist.py`（负向自测 `scripts/verify/tests/verify-e2e-env-allowlist.Tests.py`） | checks.yml → validate |
| OpenAPI↔hub router 合同一致 | `scripts/verify/verify-openapi-contract.py` | checks.yml → validate |
| shared 内不出现 Edge 客户端实现 | `scripts/verify/verify-shared-boundary.py` | checks.yml → validate |
| 前端包依赖方向：shared 不得 import workbench，workbench 只依赖 shared（#1759） | `scripts/verify/verify-frontend-package-boundary.py`（负向自测 `scripts/verify/tests/verify-frontend-package-boundary.Tests.py`）+ app/eslint.config.mjs `no-restricted-imports` | checks.yml → validate |
| shared barrel 不泄漏 Edge 导出 | `scripts/verify/verify-shared-barrel.py` | checks.yml → validate |
| Hub handler 不直连 repository | `scripts/verify/verify-hub-layering.py` | checks.yml → validate |
| router 方法必须在 conventions.md 文档化 | `scripts/verify/verify-conventions.py` | checks.yml → validate |
| 出站 client 卫生：service/jwtutil/edge-hub 范围内禁裸 client、禁 request-path env 读取、外部响应必须有 body limit、retry 必须有预算；allowlist 只缩且带 issue（#1549/#1564） | `scripts/verify/verify-outbound-client-hygiene.py`（负向自测 `scripts/verify/tests/verify-outbound-client-hygiene.Tests.py`） | checks.yml → validate |
| shared REST contract 与 Hub router 一致 | `scripts/verify/verify-shared-rest-contract.py` | checks.yml → validate |
| shared UI 依赖 hubClient 门禁 | `scripts/verify/verify-shared-ui-hubclient.py` | checks.yml → validate |
| 前端覆盖率基线不回退 | `scripts/verify/verify-coverage-baseline.py` | checks.yml → frontend-coverage |
| shared edge 表面不被 web/mobile-rn import（A-V3 门禁） | `scripts/verify/verify-shared-edge-surface-isolation.py` | checks.yml → validate |
| v4 旧 UI 组件/路由不得复活 | `scripts/verify/verify-v4-old-ui-active-paths.py` | checks.yml → validate |
| Hub/Edge gosec SAST 告警清零（#1574：hard fail——Security scan (gosec) 已移除 continue-on-error，并经 `verify-gosec-gates.sh` fail-closed 校验） | `scripts/verify/verify-gosec-gates.sh`（负向自测 `scripts/verify/tests/verify-gosec-gates.Tests.sh`） | checks.yml → go-edge / go-hub |
| OIDC 配置形状与边界（issuer/redirect/无 secret） | 旧 OIDC readiness 检查器已退役（2026-08-07，#1653：断言旧服务/测试名）；配置形状与证据等级见 `docs/architecture/05-deployment.md` 部署证据等级表（OIDC 行）；WSL 全栈 E2E 覆盖真实 OIDC 流 | — |
| P0 remote-control fixture 就绪 | `scripts/verify/verify-p0-remote-control-fixture.py` | checks.yml → backend-e2e-fixture |
| 后端 perf/leak 门禁（手动触发） | `scripts/verify/verify-backend-perf-leak-gates.py` | checks.yml → backend-perf-leak-gates |
| 部署形状 SSOT：唯一 production compose、镜像名 SSOT、遗留清单关闭（#1527） | `scripts/verify/verify-deployment-shape.py`（负向自测 `scripts/verify/tests/verify-deployment-shape.Tests.py`） | cd-pr-check.yml → deployment-files |
| Tauri packaged 行为与签名门禁 | `scripts/release/verify-tauri-package-readiness.py` | release-readiness.yml → readiness-policy |
| 发布安全风险状态门禁（Critical/High 的 `Open`、`rotate required`、`* verification required` 阻断发布；未知或损坏状态 fail-closed） | `scripts/release/verify-release-gate.py`（负向自测 `scripts/verify/tests/verify-release-gate.Tests.py`） | release.yml → security-gate |
| pnpm 工具链版本与 `app/package.json#packageManager` 一致 | `scripts/release/verify-tauri-package-readiness.py` | release-readiness.yml → readiness-policy（同时检查 checks.yml / release.yml 的工具链版本引用） |
| Tauri installer 冒烟 | `scripts/release/verify-tauri-installer-smoke.py` | release-readiness.yml → windows-installer-smoke-preflight |
| Windows Agent Runtime 环境继承语义（代理变量透传、敏感变量过滤、环境键大小写） | `edge-server/internal/lifecycle/env_sanitizer_test.go` + `edge-server/internal/lifecycle/env_behavior_test.go`（workflow 结构由 `scripts/verify/verify-ci-gates.py` 与 `scripts/release/verify-tauri-package-readiness.py` 保鲜） | checks.yml → windows-go-test（`windows-go` 为稳定 required-check 聚合 job，不执行测试）；release-readiness.yml → windows-installer-smoke-preflight |
| Tauri dry 打包 | `scripts/release/verify-tauri-package-dry.py` | release-readiness.yml → windows-package-dry / macos-package-dry |
| secrets/token 不落库（hard-blocking，无 `continue-on-error`；mock/test secret 已精确 allowlist） | `scripts/verify/check-secrets.sh` | checks.yml → validate |
| 提交格式 `type(scope): 中文摘要`（PR 时） | `scripts/verify/verify-commit-messages.sh` | checks.yml → validate |
| UI Visual QA 行为证明（shell + chat 内容面，1440x810 light/dark，非空白 + 几何合同，禁 pixel golden；chat 半边的代码块场景走 web 端 stubbed-hub 回放） | `app/{desktop,web}/scripts/visual-qa-shell.mjs` + `app/{desktop,web}/scripts/visual-qa-chat.mjs`（assert：`assert-visual-qa-{shell,chat}.mjs`） | checks.yml → visual-qa-shell / visual-qa-desktop |
| Web stubbed-hub 浏览器行为兜底（mock hub + 真 chromium 的 chat flow / replay smoke / task 合同；不是真实登录，`real_tested=false`） | `app/web/src/__e2e__/{chat-flow-contract,web-stubbed-hub-replay-smoke,task-contract}.spec.ts`（入口 `pnpm test:e2e:stubbed-hub`） | checks.yml → web-e2e-stubbed |
| 真实登录/OIDC e2e 链路（需真实服务与凭据，`scripts/verify/verify-oidc-flow.py` 等 gate 保留在 `scripts/verify/`） | 无 | 无 |
| 交互型 UI/UX 验收（Type/Motion/Empty 等跨组件行为） | 无 | 无 |
| 配置组合安全（fail-closed 默认/env 全覆盖） | `hub-server/internal/config/config_validate.go`（校验入口）+ `hub-server/internal/config/constants.go`（`AuthFailClosedDefault`、`RateLimitFailOpenDefault`：auth 路径恒 fail-closed，非 auth 路径可 fail-open） | 无 |
| edge debug 端点鉴权（Dev→nil / LocalAuthToken→Bearer / HubJWTSecret→hub-JWT 校验） | `edge-server/internal/httpserver/server_auth.go`（`debugAuthFunc` 分层鉴权，pprof/config/state 端点） | 无 |
| 域 SSOT（CSP / Desktop 默认 URL / compose 回调域 三方一致） | `app/desktop/src-tauri/tauri.conf.json`（CSP + 默认 URL）；compose 回调域见 `deployments/production/.env.example`；专用 verifier 暂未建 | 无 |
| flake 登记与处置（登记字段合同、到期移除纪律、重试预算与 CI annotation 约定，#1950） | `docs/governance/known-flaky.md`（流程 SSOT；暂无机器门禁，靠到期复审与评审执行） | 无 |

## 维护规则

- 新增或变更机器门禁时更新本表；不要回写 `AGENTS.md` 的长表，`AGENTS.md` 的“规则 → 机器验证映射”只维护指针。
- `verify-doc-ssot.py` 校验验证脚本路径、负向自测路径与 CI workflow 文件存在性；CI job ID 需逐条对照对应 workflow，`verify-ci-gates.py` 只覆盖其内建的结构合同。
- 检查器退役时改写对应行的脚本列为说明文字（见 OIDC readiness 行先例），保留历史事实而不是删行。

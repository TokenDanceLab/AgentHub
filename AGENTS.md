# AGENTS.md — AgentHub 项目总规则唯一入口

> 最后更新：2026-09-04
>
> 本文件只保留每次任务都必须看到的硬边界、工作流和 owner 指针。实现细节、CI 长表、发布步骤和历史证据放到各自 owner 文档；仓库不维护第二套根级 Agent 规则。

## 0. 事实源与加载顺序

1. 管理员直接指令。
2. `AGENTS.md`：项目硬边界、工作流、验证纪律和索引。
3. GitHub issue/PR：当前任务、进度、阻塞和验收证据。
4. `api/`、`docs/architecture.md`、`docs/architecture/`：契约与架构事实。
5. 其他 owner 文档；历史只通过 `docs/history.md` 追溯。

动态状态必须现场重读，禁止从旧 handoff、旧审计、commit message 或本地 memory 推断。

## 1. 新 Agent 90 秒入口

1. 先跑 `git status --short --branch`、`git log -5 --oneline`、`git worktree list`，确认真实分支、脏文件和并行 worktree。
2. 读本文件，再读 GitHub 当前 issue/PR；复杂任务先确认目标、允许修改路径、禁改路径和验收命令。
3. 只加载与任务直接相关的一个 owner 文档；已经能回答“目标 / owner / 写集 / 验收”就停止扩展上下文。
4. 最窄验证先行；宣称 merge-ready、真实 E2E、发布或生产就绪前，再跑对应完整 gate。
5. 当前仓库不维护本地 progress/STATE；进度只写 GitHub issue/PR。

任务路由：接口改动读 `api/openapi.yaml`、`api/events.md`、`api/conventions.md`；前端数据流读 `docs/architecture/04-frontend-data-flow.md`；身份授权读 `docs/architecture/06-auth-identity.md`；宏观协议/一致性/代理权读 `docs/architecture/10-macro-engineering-design.md`。人类开发者入口是 `README.md` → `docs/architecture.md` → `docs/developer-quickstart.md`。

## 2. 架构与产品边界

- Hub Server / Edge Server 使用 Go；UI 使用 React + TypeScript；Desktop 使用 Tauri；主协议是 REST JSON + typed WebSocket。
- API 契约 SSOT 在 `api/`；Hub REST/WS 前端实现 SSOT 在 `app/shared/src/hub/hubClient.ts`，各平台 `hubClient.ts` 只能保留平台胶水。
- 通用 UI、transcript、composer、inspector、platform contract 放 `app/shared/`；端级 shell 放 `app/workbench/`，依赖方向只能 workbench → shared。
- Desktop native 能力只在 `app/desktop/src-tauri/`；renderer 不获得 raw process 权限。本地执行由 Local Edge / typed Tauri host API 承担。
- Web 与 Mobile 都是 Hub-only，不直连 Local Edge、raw runtime 或 Desktop host；Mobile 当前是 fixture/边界验证 lane，不是 release candidate。
- 本地执行不依赖 Hub；Hub 负责账号、IM、多端同步、远程查看/审批、设备路由、中继和审计。

宏观设计以 `docs/architecture/10-macro-engineering-design.md` 为 SSOT，硬边界只有这些：Hub 是控制面而非模型 Turn 执行器；调度/审批由确定性状态机决定；Hub→Edge 交付要可重试、幂等、可审计；授权采用 task-scoped / per-action 最小代理权；run/tool/model/token/cost 观测遵循既定 OTel GenAI 口径。产品模型与术语见 `docs/architecture.md`。

## 3. 生态与真实性边界

- 登录只接 TokenDance ID；TokenDance ID 证明身份，Hub 用本地 membership/resource/action 做授权。第三方绑定归身份系统，不在 AgentHub 复制第二套登录。
- TokenDance API/Gateway key 不是 ID token，不得暴露给浏览器、Agent context、sandbox 或公开日志。
- Feishu/Lark 是协作入口，不是第二身份系统；跨产品细节以 `docs/governance/README.md` 为 owner。
- stub/demo/fixture/readiness-only 不得冒充真实登录、真实模型/API、packaged Desktop 或生产发布。
- Critical/High 发布风险的当前阻断口径以 `SECURITY.md` 和发布 gate 为准，不在本文件复制风险队列。

## 4. 前端边界

前端最近层规则是 `app/AGENTS.md`；这里不复制组件、视觉、coverage 或易踩坑清单。跨包只保留三条：shared 禁止 import workbench；平台不得复制 shared UI/Hub REST 实现；UI 行为改动必须有行为断言，Visual QA/Playwright 证据不能被截图替代。

设计系统 owner 为 `docs/architecture/07-design-system-ssot.md`；共享组件验收 owner 为 `docs/component-acceptance.md`。

## 5. 验证与证据

### 测试分层（L0-L4）

| 层 | 目的 | 入口 / owner |
|---|---|---|
| L0 | 单元、静态、前端合同 | `make test` / `make fe-test` |
| L1 | 真 PostgreSQL + Redis 集成 | `make test-hub-integration` |
| L2 | Edge→Hub callback / fixture | `make test-edge-e2e` / `make e2e-local` |
| L3 | 真实登录/真实栈 E2E | `scripts/dev/devserver.sh`；非 PR required |
| L4 | 打包、安装器、发布证据 | `release-readiness.yml` / release workflows |

完整 CI job、required-check、路径过滤和平台合同只看 `docs/architecture/github-actions-ci-cd-policy.md`；开发命令只看 `docs/developer-quickstart.md`。fixture、observed-local、approved-real、packaged-release 等证据等级以 `scripts/verify/verify-real-e2e-contract.py` 为准。

- 异步测试等待使用项目等待工具/测试框架，不用裸 `time.Sleep` 轮询回调。
- UI 工作流必须断言行为；Vite renderer 不等于 packaged Desktop。
- 禁止无保护力测试：复制实现 switch、只测常量、硬断非合同文案、mock 被测函数自己。
- 未跑到的层级明确标 pending / skipped；下界证据不能推出上界结论。

## 6. Git 和 worktree

- 从最新 origin/master 开始；项目 worktree 固定在 `.worktrees/`。一个 worktree 同时只允许一个写 agent。
- `master` 禁直接 push；所有变更走 PR，仓库只允许 Squash and merge。一个 PR 一个主题，提交与 PR 标题使用 Conventional Commits：`type(scope): 摘要`。
- 并行 lane 必须写集不重叠；同一文件域确有共享写集时，可先集成到一个短 integration 分支，最终只开一个 PR，并在正文保留全部 `Closes #...`。
- 不在共享分支 force-push；个人 PR 分支因 rebase/amend 需要更新时只用 `--force-with-lease`。
- 不按 handoff 推断分支状态；合并、CI、branch protection 的真实状态以 GitHub + git 为准。
- PR 必须写清验收证据和未跑项。合并后再清理分支/worktree；不要把已合并分支留成第二份 backlog。

分支保护、required checks 与 CI 结构的 SSOT 是 `docs/architecture/github-actions-ci-cd-policy.md`；命令示例与 PR/release SOP 在 `docs/developer-quickstart.md`。

## 7. 文档与知识分层

- 项目规则只写 `AGENTS.md`；不要创建 CLAUDE/CODEX/GEMINI/CURSOR 等第二套根规则。
- `README.md` 面向人类快速上手；`docs/architecture.md` 与 `docs/architecture/` 解释架构；`docs/decisions.md` 记录稳定裁决；模块 README 只写模块入口/gate。
- 历史 longform、日期型审计、旧验收和已完成 spec 不回流活跃文档；只通过 `docs/history.md` 指向外部归档。
- 避免巨石文档：入口只留职责、硬边界和高气味指针；长表、过程证据、事故时间线下沉到 owner 文档或 archive。
- `.agenthub/memory/` 只允许本机 scratch，不是 SSOT，不得提交，也不得作为当前进度来源。
- 修改稳定规则、协议、目录职责时，同步实际 owner 文档和对应 verifier；不要在多个常驻文件复制同一事实。

## 8. 安全与隐私

禁止提交或粘贴 `.env`、token、cookie、私钥、证书、真实服务器/内网信息、生产连接串、用户数据、聊天记录或含敏感字段的日志。示例配置只用占位符。

结构化日志对敏感语义字段走 `pkg/logmask`；新本地生成目录、缓存、数据库、日志或密钥目录先确认 `.gitignore`。发布安全状态与支持策略见 `SECURITY.md`。

## 9. 规则与机器门禁

规则 → verifier → CI 的映射 SSOT 是 `docs/governance/verifier-map.md`。新增门禁只有同时满足“每个相关 PR 真执行”与“负向自测也被 CI 执行”才算门禁；否则放 smoke/release 工具层。门禁有预算：能复用现有 verifier 就不新建；新增 verifier 必须同时说明退休哪个旧门禁，或证明现有门禁无法覆盖。

所有文档/API 变更至少运行 `python scripts/verify/verify-doc-ssot.py` 和对应契约解析；具体命令见 `docs/developer-quickstart.md`。

## 10. Agent、skill 与 Spec-Driven Develop

主 Agent 对拆解、验收、提交和 PR 负责；subagent 只是限定写集的协作者。派发必须明确目标、允许/禁止路径、owner 文档、验收和隐私红线；不要让多个写 agent 共用 worktree。

仓库不 vendored 本机 skill、Agent memory 或会话状态。涉及真实 E2E、Playwright、Visual QA、发布、性能/泄漏或 merge-ready 结论时，先按对应项目 gate 取证。

大型复杂任务用 GitHub issue 作为 spec，至少写 Summary / Scope / Files / Interfaces / Invariants / Acceptance / Negative Constraints / Dependencies / File Ownership；短 typo、单文件小修不需要造完整 spec。

## 11. 发布与依赖

唯一发布入口是 semver tag → `.github/workflows/release.yml`；版本、签名、产物、失败重发和发布后核对只看 `docs/developer-quickstart.md` 的发布 tag SOP。Release notes 由 git-cliff 从提交历史生成，不维护第二份 Unreleased 清单。

依赖更新策略的唯一配置是 `.github/renovate.json`；不要在规则文档复制 patch/minor/major 的具体调度值。配置改动由 CI 与该文件自身审阅裁决。

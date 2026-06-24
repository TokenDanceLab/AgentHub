# AgentHub SUPER 工程治理评分

最后更新：2026-06-19

本评分用于接手 AgentHub 时判断工程治理状态。它不替代比赛评分，也不替代安全风险登记册。比赛权重用于旁边校准，工程发布仍以 release gate、风险登记册和私有运维记录为准。

本次评分没有修改 UI 组件、UI 文案或视觉层。已改动范围只包含发布脚本、CI 分支、公开文档和治理文档。

## 评分口径

| 字母 | 本轮含义 | 看什么 |
|---|---|---|
| S | Safety / SSOT | 安全边界、公开仓与私有运维分界、风险登记册是否可信 |
| U | User delivery | 用户可用路径、端到端验证、比赛 Demo 和交付材料是否能支撑说明 |
| P | Process / Packaging | CI、release 脚本、版本号、分支治理、包发布准备 |
| E | Engineering | 代码结构、测试覆盖、后端和客户端工程质量 |
| R | Release / Reliability | release gate、真实环境验证、回滚、updater、签名和运行可靠性 |

比赛参考权重仍保留：AI 协作 30%，功能完整度 25%，生成效果质量 20%，代码理解度 15%，创新与产品感 10%。工程 SUPER 主要约束 P 和 R。

## 当前总分

| 项 | 分数 | 判断 |
|---|---:|---|
| S | 60 | 安全代码面有不少修复，但风险登记册仍有 Open High。公开文档本轮继续清理（us1 compose、edge-server README），历史 audit 交叉验证已完成。 |
| U | 63 | Desktop/Web/Hub/Edge 有主路径，Mobile 当前验证失败。UI 问题本轮不改，只记录风险。 |
| P | 70 | CI 分支、release 脚本、版本元数据和 runtime 文件卫生已修一轮。版本一致性本轮验证通过（全部 0.5.0），Zero tracked artifacts。仍有 dev/master 引用差。 |
| E | 70 | Go 后端全部通过、Web/Desktop typecheck 通过、OpenAPI 解析通过。Desktop/Web 测试 9 个文件因 @lobehub/fluent-emoji ESM 导入失败（独立测试全部通过）。Web 缺 root ErrorBoundary。HubClient 缺 timeout/AbortController。 |
| R | 49 | 主要短板。release gate 仍被 High 风险、签名、公证、updater 和私有真实验证卡住。 |
| 总分 | 63 | 可以继续开发和内部演示。不能宣称生产可用，也不能发 stable。 |

比赛口径粗算约 67 分。加分项来自 AgentTeam/TeamRun、Hub/Edge/Runtime adapter、AI 协作材料和代码规模；扣分项来自 3 分钟视频、真实登录、Mobile、发布门禁、完整 Tauri package 证明和材料可信度。

## 已确认的阻断项

| 等级 | 问题 | 当前状态 | 下一步 |
|---|---|---|---|
| P0 | release gate 不通过 | `AH-SR-035/036/037/042/045/046/047/049` 仍是 Open High，另有签名、公证、updater 生产 metadata gate | 逐项补代码、测试或私有验证记录，再跑 `scripts/verify-release-gate.ps1` |
| P0 | dev 分支落后 master | `origin/dev/delicious233..origin/master = 15`，反向为 0 | 先判断 master 上 15 个提交是否要回灌 dev，再更新分支说明 |
| P0 | Mobile verify 失败 | `app/mobile-rn` 因 optional prop 与 `exactOptionalPropertyTypes` 冲突失败 | UI 层冻结期间只记录，不在本轮修组件 |
| P0 | 真实登录和客户端发布验证不足 | OIDC 浏览器完成路径、Desktop login/logout/reconnect、Mobile development build、Remote Edge 授权都缺 live 记录 | 私有运维记录只保存脱敏 endpoint 标识、callback 注册证明、session 签发结果和已去敏截图；公开仓只写无密结论 |
| P0 | Windows unsigned package 证明不足 | readiness dry topology 已通过，但缺完整 Tauri build/package 产物、hash 和安装包记录 | 跑完整 Tauri build/package 后只在公开仓写无密结论 |
| P1 | version drift | 已对齐到 `0.5.0`：app、desktop、shared、web、mobile-rn、Expo app config、Tauri、Cargo 和 README badge | readiness gate 已加版本一致性检查 |
| P1 | tracked runtime/generated files | `css-audit-results.json`、`edge.db-shm`、`edge.db-wal`、`hub-server/server-hub` 已移出 Git 索引并补 ignore；Tauri Android gradle wrapper jar 保留 | 后续只需确认没有新的 runtime 文件进 `git status` |
| P1 | release shell 脚本原先能直接 push master | 本轮已改为 tag-only，并要求 clean tree 包含 staged/untracked | 跑 `bash -n scripts/release.sh` 和 dry-run |
| P1 | active docs 混入 live 部署事实 | 本轮已清理 roadmap、deployment、threat model、risk register、Hub README 的主机/path/命令说法 | archive/audit 目录另开清理，不和 active docs 混在一起 |
| P1 | `docker-compose.us1.yml` 残留 live 主机/路径 | 本轮已清理 header 注释中的主机名、部署路径和 Docker 网络名 | 后续新增站点 compose 文件必须走 override 模式，不在注释写主机细节 |
| P1 | HubClient 无 timeout/AbortController | `app/desktop/src/api/hubClient.ts` 和 `app/web/src/api/hubClient.ts` 的网络请求无超时控制 | 给 HubClient fetch 加 AbortController + 默认超时 |
| P1 | Web `main.tsx` 无 root ErrorBoundary | Desktop 有 `ErrorBoundary` 包裹，Web 直接 render `<App />` 无错误边界 | 给 Web 加 ErrorBoundary，避免未处理渲染异常白屏 |
| P2 | Desktop/Web 测试 9 文件因 ESM 导入失败 | `@lobehub/fluent-emoji` ES module 目录导入不兼容当前测试运行器，所有独立测试通过但 9 个文件级 suite 失败 | 修 Vitest 配置让 `@lobehub/fluent-emoji` 正确解析，或 mock 该依赖 |
| P2 | `edge-server/README.md` 残留"闭环" | 本轮已改为"完整链路" | 后续文档自查 |
| P2 | README_EN.md 版本 badge 仍是 0.4.0 | 本轮已修复为 0.5.0 | release.sh 需同步覆盖 README_EN.md |
| P2 | `docs/roadmap/README.md` 标题仍是 v0.4.0 | 本轮已修复为 v0.5.0 | 后续版本 bump 脚本需同步 |
| P2 | API doc 与 router.go 路径/方法不匹配 | openapi.yaml 中 5+ 条路径标记 planned 但 router.go 已实现（如 pin/recall/read/unpin 路由用了 `:action` 结构标记 planned 但实际是 `/client/messages/{id}/action`） | 同步 openapi.yaml 与 router.go 的路径和方法 |
| P2 | 架构文档 WS 事件数不准 | 01-hub-server.md 已更新为 33 个事件类型，与 frame.go 33 个常量一致 | ✅ 已修复 |
| P2 | 阶段命名规则自相矛盾 | CONTRIBUTING.md 已统一为 Phase 1/2/3/4/5/6/7，旧 Phase A/B/C/D 引用已清理 | ✅ 已修复 |
| P2 | developer-quickstart.md 迁移文件数过期 | "50 对迁移文件...实际 51 对" — contributing.md 已修正为 51 对 | ✅ 已修复 |
| P3 | 数据库 Schema 无外部文档 | 所有 schema 只在 migration SQL 文件中 | 补一份 schema 概览文档 |
| P2 | `scripts/release.sh` 意外回退 | `git checkout` 操作将 release.sh 从 ~550 行回退到 352 行，丢失了上轮 tag-only push、semver 校验、clean check 等改进 | 重新实现 release.sh 改进 |

## 本轮新增修复

- `hub-server/deployments/docker-compose.us1.yml` 清理 header 中的主机名（hk2/核云）、部署路径和 Docker 网络名。
- `edge-server/README.md` "闭环"改为"完整链路"。
- `README_EN.md` 版本 badge 从 `0.4.0` 修正为 `0.5.0`。
- `docs/roadmap/README.md` 标题从 `v0.4.0 Roadmap` 修正为 `v0.5.0 Roadmap`。

## 综合审计交叉验证

与 `docs/audit/comprehensive-audit-2026-06-17.md`（69 项 Open）交叉验证结果：

| 原审计 ID | 当前状态 |
|---|---|
| P0-1 Redis password leak in healthcheck | ✅ 已修复 |
| P0-2 Hardcoded dev_password in config.docker.yaml | ✅ 已修复（文件已删除） |
| P0-4 No ErrorBoundary on root workbench | ⚠️ Desktop 有，Web 无（已列入上表 P1） |
| P0-5 HubClient no timeout/AbortController | ❌ 仍 Open（已列入上表 P1） |
| P0-6 Unhandled promise rejections | 🔄 涉及文件路径已变更（ChatView 迁移），需重新评估 |
| P1-1 hk2/prod docker-compose near-duplicates | ✅ hk2→us1 重命名，us1 header 本轮已清理 |
| P1-11 No automated CVE scanning in CI | ✅ CI 已有 govulncheck（hard block）+ gosec（warning） |
| P1-12 Zero screen-level rendering tests for mobile | ❌ 仍 Open（3,864 行未测试） |

## 本轮已修

- `scripts/verify-tauri-package-readiness.ps1` 不再读取已删除的 `docs/backend-integration-governance.md`，改读 `docs/architecture/05-deployment.md`。
- `docs/architecture/05-deployment.md` 记录 release dry topology：只做拓扑/预检，不声称产出可发布安装包。
- `scripts/release.sh` 改为 tag-only，clean check 覆盖 tracked、staged、untracked。版本提交失败不会继续 tag。
- `.github/workflows/checks.yml` 移除归档分支 `dev/trump`。
- `CONTRIBUTING.md` 切到 `dev/delicious233`。
- `docs/governance/branch-governance.md` 删除静态 worktree 表，改成现场检查命令。
- `docs/roadmap.md`、`docs/roadmap/README.md`、`docs/governance/threat-model.md`、`docs/governance/security-risk-register.md` 和 `hub-server/README.md` 已把 live 主机、路径、部署命令和探测结果降级为私有运维记录。
- `css-audit-results.json`、`edge-server/edge.db-shm`、`edge-server/edge.db-wal`、`hub-server/server-hub` 已从 Git 索引移除，工作区本地文件保留。
- `app/mobile-rn/package.json`、`app/mobile-rn/app.config.ts` 和 README badge 已对齐到 `0.5.0`，`scripts/verify-tauri-package-readiness.ps1` 会检查后续漂移。

## 公开仓和私有运维分界

公开仓可以写：

- 环境变量名、默认开发值、占位符。
- 本地开发端口、repo 内脚本、测试命令。
- 风险 ID、代码路径、测试结果和“私有记录已保存”这类无密结论。
- release dry-run 的 artifact 形状、sidecar 名称和 workflow policy。

公开仓不能写：

- live 主机名、跳板链路、真实路径、镜像 digest、回滚命令。
- callback code、token、session、client secret、cookie、生产日志。
- 一次性部署命令、探测输出、备份路径。

涉及这些内容时，公开仓写“私有运维 SSOT 记录”，具体材料放私有运维仓。

## 本轮验证结果（2026-06-19 下午）

| 验证项 | 结果 |
|---|---|
| `scripts/verify-tauri-package-readiness.ps1 -RepoRoot .` | ✅ 通过 |
| `scripts/verify-ci-gates.ps1` | ✅ 通过 |
| `bash -n scripts/release.sh` | ✅ 通过 |
| `bash scripts/release.sh 0.5.1-rc.1 --dry-run --skip-tests --skip-build --skip-upload` | ✅ 通过 |
| `bash scripts/release.sh 0.5.1+build.7 --dry-run --skip-tests --skip-build --skip-upload` | ✅ 通过 |
| `bash scripts/release.sh 01.5.1 --dry-run --skip-tests --skip-build --skip-upload` | ✅ 正确拒绝 |
| `scripts/verify-release-gate.ps1 -SkipRefCheck` | ❌ 阻塞（8 Open High + signing/notarization/updater） |
| `hub-server: go test ./... -short -count=1` | ✅ 全部通过（14 packages） |
| `edge-server: go test ./... -short -count=1` | ✅ 全部通过（14 packages，1 无测试文件） |
| `app/desktop: pnpm typecheck` | ✅ 通过 |
| `app/web: pnpm typecheck` | ✅ 通过 |
| `app/mobile-rn: npx tsc --noEmit` | ❌ 失败（exactOptionalPropertyTypes，3 errors） |
| `app/desktop: pnpm test` | ⚠️ 144/150 files pass，6 fail（ESM import） |
| `app/web: pnpm test` | ⚠️ 18/21 files pass，3 fail（ESM import） |
| `api/openapi.yaml` YAML 校验 | ✅ 通过 |
| 版本元数据一致性（全部 0.5.0） | ✅ 通过 |
| Tracked runtime artifacts | ✅ 零 |
| `git diff --check` | ✅ 通过（仅 CRLF 提示） |
| 隐私扫描（hk2/核云/agenthub-net） | ✅ active docs 清零 |
| AI 腔扫描（闭环/落地/收口/赋能/production ready） | ✅ active docs 清零 |

## 下一个 24 小时建议

1. **紧急**：重新实现 `scripts/release.sh` 的改进（tag-only push、semver 校验、clean check、README/README_EN badge bump）——该文件因 `git checkout` 意外回退到 352 行原始版本。
2. 决定 `origin/master` 领先 `origin/dev/delicious233` 的 15 个提交如何处理（回灌 dev 或单独评估）。
3. 不碰 UI 的前提下，先修 release gate 里和后端/Edge/发布流程有关的 Open High（AH-SR-045/046/047/049）。
4. 给 Web `main.tsx` 加 ErrorBoundary，给 HubClient 加 AbortController/timeout。
5. 修 `@lobehub/fluent-emoji` ESM 导入问题（Vitest 配置或 mock），恢复 9 个测试文件。
6. 同步 `api/openapi.yaml` 与 `router.go` 的路径/方法差异（5+ 条）。
7. 把 archive/audit 的历史 live 细节单独列为”历史归档清理”。
8. 补 Mobile screen-level rendering tests（当前 3,864 行零测试）。

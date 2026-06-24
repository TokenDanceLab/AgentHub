# AgentHub 模块清单 — S.U.P.E.R 合规评分

> 生成日期：2026-06-19 | Phase 1 分析 | Spec-Driven Develop

## 评分标准

1 = 未处理/违反 | 2 = 最低限度 | 3 = 部分覆盖有缺口 | 4 = 基本覆盖有小缺口 | 5 = 完全覆盖/范例级

---

## 模块评分汇总

| 模块 | S | U | P | E | R | 总分 | 一句话 |
|---|---|---|---|---|---|---|---|
| hub-server/ | 4 | 4 | 4 | 5 | 3 | **20/25** | 分层清晰、116 个测试文件，但 app.go (1081行) 单体 DI 违反 Replaceability |
| edge-server/ | 4 | 5 | 5 | 5 | 4 | **23/25** | 最佳后端模块：干净 store 接口、事件总线带 gap 检测、可插拔 adapter |
| app/desktop/ | 4 | 3 | 3 | 3 | 3 | **16/25** | Tauri 桌面应用，测试覆盖不错但 Tauri 耦合深、platform abstraction 不完整 |
| app/web/ | 4 | 4 | 3 | 4 | 3 | **18/25** | 干净的 Hub-only Web client、PKCE OIDC，但依赖 Hub API 面 |
| app/mobile-rn/ | 4 | 3 | 2 | 3 | 2 | **14/25** | **最低分**：不复用 @shared、测试少、无 platform adapter |
| app/shared/ | 5 | 4 | 5 | 5 | 4 | **23/25** | 范例级共享库：干净 exports、79 test files、类型合约、design tokens |
| api/ | 5 | 5 | 5 | 5 | 5 | **25/25** | 完美 S.U.P.E.R：单一 OpenAPI 3.0 spec、status annotations、与实现解耦 |
| scripts/ | 3 | 4 | 3 | 2 | 2 | **14/25** | PowerShell 单一文化（55+ .ps1）、Windows 耦合、不可移植 |
| .github/workflows/ | 4 | 4 | 3 | 2 | 2 | **15/25** | GitHub 专用 pipeline、不可移植、CD 绑定特定部署目标 |
| docs/ | 4 | 5 | 4 | 5 | 5 | **23/25** | 文档全面：12 ADR、6 架构子文档、中英双语 |

**整体: 191/250 (76.4%)**

---

## Top 5 违规热点

### 1. `hub-server/internal/app/app.go` (1081行) — DI 单体

整个仓库最严重的架构违规：
- 在单一文件中创建、注入、编排所有服务/处理器/中间件
- 30+ WebSocket 事件订阅内联定义（lines 483-703）
- 25+ 构造函数参数传入 `router.SetupRoutes`
- 同时处理 SIGINT/SIGTERM 关闭编排

**违反**: S (Single Purpose)、R (Replaceable Parts)

### 2. `app/shared/` 不被 mobile-rn 使用

mobile-rn 模块不使用 `@shared` 包：
- 38KB hubClient.ts 重复或不可用
- 79 个 shared tests 对 mobile 无关
- 事件类型合约、design tokens、workbench state、transcript blocks、i18n 不复用
- Mobile 有自己的 mock server，与 shared mock 无关

**违反**: R (Replaceable Parts)

### 3. `scripts/` PowerShell 单一文化

- 55+ .ps1 文件 vs ~6 .sh 文件
- 紧密耦合 Windows 执行环境
- 没有纯 sh fallback
- `verify-localhost-observed-loop.ps1` (36KB) 过大且脆弱

**违反**: E (Environment-Agnostic)

### 4. 服务层循环引用

在 `hub-server/internal/app/app.go`:
- `AgentTeamService.SetControlService(a.AgentControlService)`
- `AgentService.SetTeamRouteHandler(a.AgentTeamService)`
- `AgentService.SetRelayService(a.RelayService)`
- `a.DeviceService.SetDesktopTargetRegistrar(targetSvc)`

**违反**: U (Unidirectional Flow)

### 5. CI/CD 紧耦合

- `checks.yml` 硬编码 per-package 覆盖率阈值
- 每个 CD workflow 完全独立，无共享 workflow abstraction
- 使用 GitHub 专有特性（annotations, artifacts, secrets, cache actions）

**违反**: E (Environment-Agnostic)、R (Replaceable Parts)

---

## 建议行动

| 优先级 | 行动 | 涉及模块 |
|---|---|---|
| P0 | 拆分 `app.go` 为 wiring/events/background 子文件 | hub-server |
| P0 | Mobile-rn 接入 `@shared` 作为消费者 | mobile-rn |
| P1 | 关键 PowerShell 脚本补 sh 等价版本 | scripts |
| P1 | 服务层循环引用改为事件总线仲裁 | hub-server |
| P2 | 提取共享 CI workflow 可复用模式 | .github/workflows |

# 审计发现冲突矩阵与交接报告

> 生成时间：2026-06-07 | 基于实际工作树文件级对比

## 一、三条线文件覆盖范围

### 线 A：v4 前端重构（feat/desktop-web-v4-clean-rebuild 工作树）

**已修改 43 个文件 + 新增 62 个文件，覆盖：**

| 区域 | 文件 |
|---|---|
| shared workbench | AgentHubWorkbench.\*、GlobalRail、ConversationSidebar、RightInspector、TranscriptView、UnifiedComposer、WorkspaceHeader、index.ts、WorkbenchRoutes.tsx（新） |
| shared 其他 | platform/types.ts、transcript/\*、ui/DeployCard\*、index.ts |
| workbench 新组件 | blocks/\*（16）、floating/\*（5）、inspector/\*（3）、pages/\*（6） |
| desktop | platform/\*、styles/\*、contexts/\*、App.v4.test.tsx、ApprovalCard.module.css |
| web | platform/\*、styles/\*、contexts/\*、App.test.tsx、vite.config.ts |
| mobile | README、scripts、vite.config.ts |
| docs | AGENTS.md、adr/README.md、architecture.md、roadmap.md、v4-plan.md、governance/branch-governance.md |

### 线 B：后端 merge（feat/backend-edge-hub worktree）

**已修改 27 个文件 + 新增 16 个文件，覆盖：**

| 区域 | 文件 |
|---|---|
| app | app.go + 新 app_handlers.go、app_services.go、subscribers.go |
| handler | 几乎全部 handler（agent、oidc、ws、auth、session、message、contact 等）+ 对应测试 |
| router | router.go + 新 handlers.go |
| service | agent.go、agent_team.go + 新拆分文件（dispatch、callback、crud、runtime、query 等） |
| tests | setup_test.go + 新 im_e2e_test.go |

---

## 二、冲突矩阵

### 🔴 与后端线冲突（需交给后端负责人）

| ID | 发现 | 涉及文件 | 冲突原因 |
|---|---|---|---|
| S-1 🔴 | **oidc.go 反射型 XSS** | `hub-server/internal/handler/oidc.go` | 后端正在修改此文件（重构 handler 签名） |
| S-2 🟡 | oidc.go auth code 明文显示 | 同上 | 同上 |
| S-5 🟡 | ws.go typing frame 缺权限检查 | `hub-server/internal/handler/ws.go` | 后端正在修改此文件 |
| B-1 🔴 | /debug/config 明文密码 | `hub-server/internal/app/app.go` | 后端正在重构 App 初始化（新增 app_handlers.go） |
| B-2 🔴 | DI 参数爆炸 26 参数 | `hub-server/internal/router/router.go` | 后端新增 handlers.go，重构路由注册 |
| B-4 🟡 | App.Run() 180 行初始化 | `hub-server/internal/app/app.go` | 后端正在拆分此文件 |

### 🔵 与前端线冲突（交给前端/v4 重构一起消化）

| ID | 发现 | 涉及文件/区域 | 冲突原因 |
|---|---|---|---|
| Q-2 🔴 | v4 UI 33 组件零测试 | `app/shared/src/workbench/{blocks,floating,inspector,pages}/` | 前端正在重构这些组件，测试应随重构补 |
| C-1 🟡 | Desktop/Web 10 重复 hooks + 10 stores | `app/desktop/src/hooks/`、`app/web/src/hooks/` | v4 迁移到 shared 时自然消除 |
| C-2 🟡 | 5,500 行废弃代码 | Desktop/Web components/ | v4 清理阶段整批删除 |
| C-3 🟡 | 9 处 CSS 硬编码颜色 | shared CSS modules | token 迁移一起处理 |
| F-1 🟡 | AgentsPage 1227 行巨型组件 | `app/shared/src/workbench/pages/AgentsPage.tsx` | 前端正在重构 pages/ |
| F-2 🟡 | z-index 硬编码 | workbench CSS | 前端正在统一 token |
| F-3 🟡 | --text-3 对比度不足 | tokens.css | 前端正在迁移 token 系统 |
| DO-1 🟡 | ADR README 路径错误 | `docs/adr/README.md` | 前端工作树已修改此文件 |
| DO-2 🟡 | 阶段命名不统一 | `docs/architecture.md`、`docs/roadmap.md` | 前端工作树已修改这些文件 |

---

## 三、✅ 安全区——新 worktree 可以直接修的

以下文件**不被任何一条工作线触及**，可以在独立 worktree 安全修复：

### 安全 P0

| ID | 发现 | 文件 | 预估 |
|---|---|---|---|
| A-1 🔴 | 删除 256MB 编译产物 | `hub-server/.tmp/`、`edge-server/.tmp/`、`edge-server/test-edge-server.exe` | 5 分钟 |

### 安全 P1

| ID | 发现 | 文件 | 预估 |
|---|---|---|---|
| S-4 🟡 | ILIKE 搜索 `%`/`_` 未转义 | `hub-server/internal/repository/message.go` | 15 分钟 |
| S-3 🟡 | token exchange 失败日志泄漏 | `hub-server/internal/service/oidc.go` | 15 分钟 |
| S-6 🟡 | edge-server 远程 CORS 全放行 | `edge-server/internal/httpserver/server.go` | 30 分钟 |
| S-7 🟡 | env_sanitizer 敏感变量白名单 | `edge-server/env_sanitizer.go` | 30 分钟 |
| D-1 🟡 | react/react-dom 版本不一致 | `package.json`（root、shared、mobile） | 30 分钟 |
| D-2 🟡 | 5 个未使用 npm 依赖 | `package.json`（各子项目） | 30 分钟 |
| BU-1 🟡 | exactOptionalPropertyTypes 不一致 | `tsconfig.json`（各子项目） | 15 分钟 |
| BU-2 🟡 | Tauri 版本号不一致 | `tauri.conf.json` vs `Cargo.toml` | 15 分钟 |

### 安全 P2

| ID | 发现 | 文件 | 预估 |
|---|---|---|---|
| Q-1 🔴 | repository 层 85% 无测试 | `hub-server/internal/repository/*_test.go`（新增） | 2-3 天 |
| B-3 🟡 | edge-server process_executor 1413 行 | `edge-server/internal/process/` | 1 天 |
| — | edge-server golangci-lint 配置补齐 | `edge-server/.golangci.yml` | 30 分钟 |
| — | edge-server jwtutil 与 hub-server 重复 | `edge-server/internal/jwtutil/` | 可后续合并 |

---

## 四、推荐行动

### 你开新 worktree 做（安全区，不冲突）

```
优先级排序：
1. 删 .tmp/ + .gitignore（5分钟）
2. S-7 env_sanitizer 白名单收紧（30分钟）
3. S-6 edge CORS 限制（30分钟）
4. S-4 ILIKE 转义（15分钟）
5. S-3 token 日志脱敏（15分钟）
6. D-1/D-2 依赖版本统一（1小时）
7. BU-1/BU-2 tsconfig+tauri 对齐（30分钟）
```

### 交给后端负责人的清单

> 以下 6 个问题涉及的文件你正在改，请在提交时一并处理：

1. **🔴 oidc.go XSS**：`html.EscapeString()` 包裹 `code`/`state` 参数
2. **🟡 oidc.go auth code 明文**：成功页面只显示状态，不显示 code
3. **🔴 /debug/config 明文密码**：`app.go` 中 `hubConfigDumper` 对密码字段 mask
4. **🟡 ws.go typing 权限**：`messageLoop` 中验证 session_id 成员身份
5. **🔴 DI 参数爆炸**：你新增的 `app_handlers.go`/`app_services.go` 已经在解决这个问题
6. **🟡 App.Run() 拆分**：你的 `subscribers.go` 也在做这个

### 交给前端/v4 重构一起消化的清单

> 以下问题会在 v4 重构过程中自然处理，不需要单独开分支：

- v4 组件测试 → 随组件接入补写
- 重复 hooks/stores → 迁移到 shared 时消除
- 废弃组件 → 随旧 UI 删除批次清理
- CSS token/z-index → 正在统一
- 文档路径/命名 → 前端工作树已包含文档更新

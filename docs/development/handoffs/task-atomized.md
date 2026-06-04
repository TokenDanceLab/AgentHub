# AgentHub 比赛提交前原子化任务清单

> 每个任务独立可执行，含验证命令。按优先级排序。
> 给便宜快速的 Claude Code 实例用 — 任务要足够完善，不给揣测空间。

---

## P0 — 阻塞提交的 bug

### T001 验证 Edge Server 无 mock runner 后 Desktop 发送消息仍可工作
- **文件**: `edge-server/internal/api/handlers.go`, `edge-server/internal/runners/registry.go`
- **操作**: 
  1. 启动 Edge Server: `cd edge-server && go run ./cmd/agenthub-edge --addr 127.0.0.1:3210`
  2. curl 验证 `/v1/runners` 返回空或只有真实 adapter runner: `curl -s http://127.0.0.1:3210/v1/runners`
  3. 如果返回空列表，确认 POST /v1/runs 返回 503，不是 200 假完成: `curl -s -X POST http://127.0.0.1:3210/v1/runs -H 'Content-Type: application/json' -d '{"prompt":"test"}'`
  4. 查看 error code 是否为 `executor_unavailable`
- **验证**: curl 返回 `{"code":"executor_unavailable","message":"no Agent Runtime executor configured"}` + HTTP 503
- **说明**: 上一轮 commit c9d3a8e 移除了 mock runner。没有真实 adapter 时，必须明确报错，不能静默。

### T002 验证 Desktop ChatView 发送消息后至少显示"发送中"状态
- **文件**: `app/desktop/src/hooks/useChatMessages.ts`, `app/desktop/src/components/ChatView.tsx`
- **操作**:
  1. 启动 Desktop dev: `cd app/desktop && pnpm tauri dev`（或 `pnpm dev` 启动 Vite only）
  2. 连接 Edge (http://127.0.0.1:3210)
  3. 在输入框输入 "hello" 并发送
  4. 观察消息是否出现在聊天流中
  5. 如果 Edge 不可用，检查是否显示了错误提示而非空白
- **验证**: Playwright 截图或手动确认消息出现在聊天区（至少用户消息可见），或错误 toast 出现
- **截图路径**: `app/desktop/.tmp/desktop-send-message-probe.png`

### T003 验证 OIDC 登录回调后 /client/auth/me 返回用户信息
- **端点**: `GET https://api.hub.vectorcontrol.tech/client/auth/me`
- **操作**:
  1. 运行 `scripts/verify-oidc-flow.ps1 -HubUrl https://api.hub.vectorcontrol.tech -TdUrl https://id.vectorcontrol.tech` 
  2. 如果第 32 步 token exchange 成功，拿到 access_token
  3. `curl -s https://api.hub.vectorcontrol.tech/client/auth/me -H "Authorization: Bearer $TOKEN"`
  4. 确认返回 `{"code":"OK","data":{"id":"...","username":"..."}}`
- **验证**: HTTP 200 + data.id 和 data.username 非空
- **说明**: 这是 Desktop 登录后显示用户名的关键 API

### T004 验证 Desktop logout 后 token 被清除，无法再用旧 token 访问
- **端点**: `POST https://api.hub.vectorcontrol.tech/client/auth/logout`
- **操作**:
  1. 先获取有效 access_token（T003 步骤）
  2. `curl -s -X POST https://api.hub.vectorcontrol.tech/client/auth/logout -H "Authorization: Bearer $TOKEN"`
  3. 再次访问 /client/auth/me 用同一 token
  4. 确认返回 401
- **验证**: 第二次 /me 返回 401

---

## P1 — Desktop 核心体验

### T005 Desktop：没有连接 Edge 时 ChatView 必须显示明确提示而非空白
- **文件**: `app/desktop/src/components/ChatView.tsx`, `app/desktop/src/i18n/locales/zh.json`
- **操作**:
  1. 找到 ChatView 中判断 Edge 连接状态的逻辑
  2. 如果 `transportStatus !== 'connected'` 且没有历史消息，显示提示文案
  3. 文案："Edge 未连接 — 请在设置中启动 Local Edge 或连接到远程 Edge。" 对应的英文
  4. 添加 zh/en i18n key（如 `chat.edgeNotConnected`）
  5. 在 ChatView 渲染时优先判断连接状态
- **验证**: 断开 Edge 后进入 ChatView，显示提示而非空白
- **截图**: `app/desktop/.tmp/desktop-edge-disconnected-probe.png`

### T006 Desktop：Settings 中显示 Edge 连接健康状态（status/runners）
- **文件**: `app/desktop/src/components/SettingsPage.tsx` (connections 卡片区域)
- **操作**:
  1. 找到 Settings 里 connections/network 相关的卡片
  2. 添加 Edge 状态展示：连接的 Edge 地址、健康状态、可用 runners 数量
  3. 使用 `fetchHealth()` + `fetchAgents()` API（已有在 edgeClient.ts）
  4. 每 10s 轮询或手动刷新按钮
- **验证**: 进入 Settings → 连接，看到 Edge 地址和状态
- **i18n**: 所有新文案用 t() 包裹

### T007 Desktop：RunDetail 面板在有 run 但没有 events 时显示进度而非空白
- **文件**: `app/desktop/src/components/RunDetail.tsx`
- **操作**:
  1. 检查 RunDetail 渲染逻辑
  2. 如果 run 存在但 events 为空且 status 不是 terminal，显示 "等待 Agent 响应..."
  3. 如果 status 是 terminal 但没有 agent_message events，显示 "运行已完成但无可展示输出"
  4. 文案经 i18n
- **验证**: Playwright 或手动确认

### T008 Desktop：PromptInput 在 Edge 断开时置灰并显示 tooltip 原因
- **文件**: `app/desktop/src/components/PromptInput.tsx`
- **操作**:
  1. 检查 PromptInput 的 disabled 逻辑
  2. 如果没有因 Edge 断开而 disabled，添加 `transportStatus !== 'connected'` 判断
  3. 添加 tooltip/placeholder："Edge 未连接，无法发送消息"
  4. 使用 i18n key `prompt.edgeDisconnected`
- **验证**: 断开 Edge 后输入框置灰，hover 显示提示

---

## P2 — 竞品对标

### T009 扫描 aihub 竞品，找出 AgentHub 缺失的 UI/UX 特性
- **路径**: `D:\Code\aihub\`
- **操作**:
  1. 扫描 `app/` 目录找到前端代码
  2. 列出所有视图/页面/路由
  3. 对比 AgentHub Desktop 的 viewRegistry
  4. 找出 AgentHub 完全没实现的功能
  5. 找出 AgentHub 实现但体验差的功能
  6. 扫描 aihub 的 settings 面板
  7. 扫描 aihub 的聊天界面特性（流式渲染、代码高亮、diff 对比等）
- **输出**: 对比清单（markdown 表格），列出"缺失功能"和"可改进点"
- **验证**: 输出到 `docs/competitive-gap/aihub-vs-agenthub.md`（不入 git）

### T010 扫描 OpenCode / Cherry Studio（如有本地 clone）特性对比
- **路径**: `D:\Code\aihub\` 中如果有其他竞品 clone
- **操作**:
  1. 扫描各竞品前端特性
  2. 特别关注：
    - 多模型切换 UI
    - 对话历史管理
    - 文件附件/上下文管理
    - Agent 选择器
    - 主题/外观设置
  3. 记录每个竞品的差异化特性
- **输出**: 补充到同一对比文档

### T011 实现 AgentHub 竞品对标中最高优先级的缺失特性（选定后实现）
- **前提**: 先完成 T009/T010
- **操作**: 从对比清单选 1-2 个最易实现且用户感知最强的特性实现
- **示例候选**:
  - 对话历史搜索框（如果缺失）
  - 对话导出（Markdown/JSON）
  - 快捷键面板（已有 ShortcutHelp，检查完善度）
- **验证**: 功能可用 + Playwright 基础测试

---

## P3 — Playwright 浏览器自动化测试

### T012 Desktop Playwright：OIDC 登录完整流程测试
- **文件**: `app/desktop/src/__e2e__/oidc-login.spec.ts`（已有框架）
- **操作**:
  1. 扩展已有测试，添加以下场景：
    - 登录按钮点击后重定向到 TokenDance ID（验证 URL 参数正确）
    - Mock 回调后 token 存储在 sessionStorage
    - 登录后 UI 显示用户名而非登录按钮
    - Token 过期后自动跳回登录页
  2. 使用 `page.route()` mock Hub API 和 TokenDance ID
- **验证**: `npx playwright test --config app/desktop/playwright.config.ts` 全部通过
- **关键**: 测试必须在无网络/无真实 Hub 时也能通过

### T013 Desktop Playwright：ChatView 发送消息 + 接收流式响应
- **文件**: `app/desktop/src/__e2e__/` 新建 `chat-flow.spec.ts`
- **操作**:
  1. Mock Edge API 返回 fake agents/health
  2. Mock WebSocket 发送 run 事件（text_delta, text_block, run.completed）
  3. 输入消息并发送
  4. 验证用户消息出现在聊天区
  5. 验证 Agent 流式响应逐步出现
  6. 验证 run 完成后停止闪烁
- **验证**: `npx playwright test chat-flow.spec.ts` 通过

### T014 Desktop Playwright：Settings 面板各 tab 渲染测试
- **文件**: `app/desktop/src/__e2e__/` 新建 `settings.spec.ts`
- **操作**:
  1. 打开 Settings
  2. 点击每个 tab，验证内容渲染不为空
  3. 验证暗色/亮色主题切换
  4. 验证语言切换（中/英）
  5. 验证关闭 Settings 回到主界面
- **验证**: Playwright 全部通过

### T015 Web Playwright：完整 OIDC 登录 + 基础页面渲染
- **文件**: `app/web/src/__e2e__/oidc-login.spec.ts`（已有框架）
- **操作**:
  1. 扩展已有测试
  2. 添加各页面渲染检查（Workbench, AgentSquare, PrivateChats, GroupWorkspace, Project）
  3. 验证 navigation sidebar 工作正常
- **验证**: `npx playwright test --config app/web/playwright.config.ts` 通过

### T016 Playwright 截图对比脚本：记录所有关键页面的截图
- **文件**: 新建 `scripts/capture-screenshots.ps1`
- **操作**:
  1. 启动 dev server
  2. 用 Playwright 访问关键路由并截图
  3. 保存到 `app/desktop/.tmp/screenshots/` 目录
  4. 覆盖这些页面:
    - 主界面（ChatView + Welcome）
    - Settings 面板
    - ThreadPanel
    - AgentList
    - IM 面板
    - AuthPage / LoginForm
    - RunDetail（如有 run 数据）
  5. 保存暗色/亮色各一份
- **验证**: 截图目录有 10+ 张有效图片，视觉正常
- **输出**: `app/desktop/.tmp/screenshots/` （不入 git）

---

## P4 — 文档与提交准备

### T017 更新 README.md 和 README_EN.md 到最新状态
- **文件**: `README.md`, `README_EN.md`
- **操作**:
  1. 更新特性列表（确认与当前代码一致）
  2. 更新架构图引用（如有）
  3. 添加"快速开始"步骤（开发环境搭建 3 步以内）
  4. 更新技术栈版本号
  5. 添加测试状态 badge（Desktop 1166 tests）
- **验证**: 中英文 README 内容同步，无过期信息

### T018 更新 docs/development/handoffs/STATE.md 为最终提交状态
- **文件**: `docs/development/handoffs/STATE.md`
- **操作**:
  1. 更新所有 checkpoints 时间戳
  2. 记录当前测试通过数据
  3. 标记所有 P0 项为已完成
  4. 列出已知 open issues（如有）
  5. 附上提交时 commit hash
- **验证**: 文件自洽，无过时数据

### T019 更新 docs/tutorials/roadmap.md 比赛提交版本
- **文件**: `docs/tutorials/roadmap.md`
- **操作**:
  1. 标记当前已完成的所有 items
  2. 将未完成的 P2 items 移到 "Future" 区域
  3. 确保 "Current Status" 反映代码实际状态
- **验证**: 与代码实际功能一致

### T020 更新 AGENTS.md — 确保开发指引是最新的
- **文件**: `AGENTS.md`
- **操作**:
  1. 检查所有路径引用是否正确
  2. 更新 "getting started" 步骤
  3. 确保测试命令是最新的
  4. 如有废弃指引，删除或标注为 deprecated
- **验证**: 按 AGENTS.md 步骤可启动开发环境

---

## P5 — 工程质量最后一轮

### T021 修复 GitHub Dependabot 报告的 3 个 moderate 漏洞
- **来源**: `https://github.com/TokenDanceLab/AgentHub/security/dependabot`
- **操作**:
  1. 查看 Dependabot 具体是哪 3 个漏洞
  2. 如果是 express/vite 的已知 issue，检查是否有 patch 版本
  3. 运行 `pnpm audit` 确认漏洞详情
  4. 更新受影响的包到修复版本
  5. 运行全量测试确认无回归
- **验证**: `pnpm audit` 无 moderate 以上漏洞（如有 false positive 则记录豁免原因）

### T022 运行完整 CI 模拟：Desktop + Web + Hub + Edge 全栈测试
- **操作**:
  1. Desktop: `cd app/desktop && pnpm typecheck && pnpm vitest run`
  2. Web: `cd app/web && pnpm typecheck && pnpm vitest run`
  3. Hub Server: `cd hub-server && go test ./...`
  4. Edge Server: `cd edge-server && go test ./... -short`（跳过长超时集成测试）
  5. Playwright Desktop: `cd app/desktop && npx playwright test`
  6. Playwright Web: `cd app/web && npx playwright test`
- **输出**: 全量通过报告，记录失败项和原因
- **说明**: 这是"提交前最后检查"

### T023 删除代码库中所有 TODO/FIXME/HACK 注释（或转为 issue）
- **操作**:
  1. `grep -rn "TODO\|FIXME\|HACK" --include="*.go" --include="*.ts" --include="*.tsx" --include="*.rs"` 递归搜索
  2. 每个找到的注释：要么立即修复，要么转为 GitHub issue 并删除注释
  3. 测试相关的 TODO 可以保留
- **验证**: 非测试文件中无 TODO/FIXME/HACK

---

## 执行顺序

```
T001 → T002 → T003 → T004  (P0 bugs, 并行)
    ↓
T005 → T006 → T007 → T008  (Desktop 体验, 并行)
    ↓
T009 → T010 → T011          (竞品对标, 串行)
    ↓
T012 → T013 → T014 → T015 → T016  (Playwright 测试, 可并行)
    ↓
T017 → T018 → T019 → T020  (文档, 可并行)
    ↓
T021 → T022 → T023          (最终检查, 串行)
```

---

## 每个任务的提交规范

1. 完成后 `git add` 相关文件
2. `git commit -m "<type>(<scope>): <description>"` (conventional commits)
3. 每完成一个 P0/P1 任务立即 commit
4. P3-P5 可以多个任务合为一个 commit 如果改动小
5. **禁止** force push，禁止修改 main/master

---

## 全局约束

- **禁止**在代码、commit message、文档中写入生产 IP、SSH、密码、token、密钥
- **禁止**提交 `.env`、`.env.local`、截图到 git
- **禁止**修改 `.gitignore` 放行敏感文件
- 所有用户可见文案必须走 i18n（zh.json + en.json）
- 所有测试必须在无网络条件下也能通过（使用 mock）

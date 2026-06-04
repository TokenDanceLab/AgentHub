# 常见问题（FAQ）

---

## 基础概念

### AgentHub 是什么？

AgentHub 是 IM 形态的多 Agent 协作平台。它把 Claude Code、Codex、OpenCode 等 AI 编程 Agent 变成 IM 联系人，你可以在群聊里 @ 它们协作完成任务。

### AgentHub 和 Cursor / Windsurf 有什么区别？

Cursor 和 Windsurf 是 IDE-native 的单人 Agent 工具——你打开它写代码。AgentHub 是 platform-native 的多 Agent 协作平台——你打开它管理多个 Agent 协作。它们不冲突：AgentHub 通过 Runtime adapter 调用 Claude Code/Codex/OpenCode CLI，Cursor/Windsurf 可以用作 AgentHub 的输出编辑器。

### 需要付费吗？

AgentHub 是开源免费软件（Apache 2.0）。本地执行没有 API 费用——你用自己的 Claude/OpenAI API key。

### 需要登录吗？

本地执行不需要登录。Desktop 连接 Local Edge 即可完成所有操作。登录 TokenDance ID 只在需要云端 IM、多端同步或远程控制时才需要。

---

## 安装与运行

### 需要哪些依赖？

本地执行只需要 Go 1.22+ 和 Node.js 20+。使用 Hub 云端功能还需要 PostgreSQL 16 + Redis 7（可通过 Docker Compose 一键启动）。

### Edge Server 启动失败怎么办？

1. 检查端口 3210 是否被占用：`netstat -ano | findstr 3210`
2. 确认 Go 版本 >= 1.22：`go version`
3. 确认在 `edge-server` 目录下运行
4. 尝试 Mock 模式先验证基础功能：`--runner-profile agenthub-runner-mock`

### Desktop 启动后无法连接 Edge？

1. 确认 Edge Server 正在运行（终端有日志输出）
2. 确认 Edge 监听在 `127.0.0.1:3210`
3. 在 Desktop Settings → Connections 中检查 Edge 健康状态
4. 检查防火墙是否阻止了 localhost 连接

### 端口冲突怎么办？

| 服务 | 默认端口 | 冲突处理 |
|------|---------|---------|
| Desktop Vite | 5173 | 用 `--port 5199` 更换 |
| Edge Server | 3210 | 用 `--addr :3211` 更换 |
| Hub Server | 8080 | 修改 `configs/config.yaml` |

---

## 使用问题

### 如何添加新的 Agent Runtime？

1. Settings → Agent Profiles → 创建 Profile
2. 选择 Runtime（Claude Code / Codex / OpenCode）
3. 配置模型和 API key
4. 保存后即可在聊天中选择使用

### 如何切换 Agent？

在聊天界面顶部有 Runtime 选择器，点击下拉选择不同的 Agent Profile。

### Agent 执行中能取消吗？

可以。在 Agent 输出区域有取消按钮，点击后会发送取消信号给 Agent CLI 进程。

### Diff 如何审批？

Agent 修改文件后，聊天中会出现 Diff 卡片：
- 绿色行 = 新增内容
- 红色行 = 删除内容
- Approve 按钮 = 接受修改
- Reject 按钮 = 拒绝修改

右上角可切换 Unified（统一视图）和 Side-by-Side（并排对比）。

### 如何让多个 Agent 协作？

1. Settings → IM 群聊 → 新建群聊
2. 添加多个 Agent Profile 作为群成员
3. 在群聊中 @Agent 名称分配任务
4. 所有 Agent 的输出和决策都在群聊中透明可见

### 聊天记录保存在哪？

本地线程消息保存在 Edge Server 的内存/文件存储中。使用 Hub 后消息会同步到 PostgreSQL，支持多端查看。

---

## 技术架构

### Edge Server 和 Hub Server 的区别？

Edge Server 是本地执行引擎——它在你电脑上运行 Agent CLI 进程，管理项目和线程。Hub Server 是云端中心——它管理账号、IM 群聊、多端同步和远程路由。

### 本地数据安全吗？

本地执行时所有数据（项目文件、聊天记录、Agent 配置）都在你本地机器上，不走云端。只有使用 Hub 云端功能时才会同步数据到 Hub Server。

### 支持哪些 Agent Runtime？

目前支持三种：
- **Claude Code**（Anthropic）
- **Codex**（OpenAI）
- **OpenCode**（多模型 CLI）

通过 Edge adapter 架构可扩展更多 Runtime。

### 和飞书/微信的关系？

AgentHub 的 IM 交互参考了飞书和微信的协作模式（群聊、@ 提及、审批卡片），但 AgentHub 本身是一个独立的桌面应用，不依赖飞书或微信。飞书 Bot 集成在路线图上。

---

## 平台支持

### 支持哪些操作系统？

- **Desktop**：Windows（Tauri 桌面端，主力平台）
- **Mobile**：Android（Tauri 原生客户端）
- **Web**：任何现代浏览器（功能子集）
- **Server**：Go 编译的 Edge/Hub 可在 Linux/macOS/Windows 运行

macOS 和 Linux Desktop 构建尚未正式支持，但 Edge Server 和源码构建的前端可以在这些平台上运行。

### Mobile 端能做什么？

Mobile 端面向轻量 IM、审批和预览——在手机上查看 Agent 任务状态、审批 Diff、查看 Artifact 输出。完整开发工作流建议在 Desktop 上完成。

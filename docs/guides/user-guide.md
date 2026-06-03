# AgentHub 用户手册

从零开始，用 AgentHub 管理 AI Agent 协作。

---

## 前置条件

| 依赖 | 版本 | 说明 |
|------|------|------|
| Go | 1.22+ | Edge Server 和 Hub Server 运行需要 |
| Node.js | 20+ | Desktop 前端运行需要 |
| pnpm | 最新 | 包管理器，通过 `corepack enable` 启用 |
| Git | 2.30+ | 克隆仓库 |

> 仅使用本地执行（Desktop + Local Edge）不需要 PostgreSQL 和 Redis。

---

## 安装

### 从 Release 安装（推荐）

1. 访问 [GitHub Releases](https://github.com/TokenDanceLab/AgentHub/releases)
2. 下载 `AgentHub_x.x.x_x64-setup.exe`（Windows 安装版）或 `AgentHub_x.x.x_x64-portable.zip`（便携版）
3. 运行安装程序或解压即用

### 从源码构建

```powershell
git clone https://github.com/TokenDanceLab/AgentHub.git
cd AgentHub
.\scripts\setup.ps1
```

macOS/Linux 用户运行 `./scripts/setup.sh`。

---

## 启动 AgentHub

### 第一步：启动 Edge Server

Edge Server 是本地执行引擎，负责管理 Agent CLI 进程。选择一个 Runtime 启动：

**Claude Code：**
```powershell
cd edge-server
go run ./cmd/agenthub-edge --addr 127.0.0.1:3210 --runner-profile claude-code
```

**Codex：**
```powershell
go run ./cmd/agenthub-edge --addr 127.0.0.1:3210 --runner-profile codex
```

**OpenCode：**
```powershell
go run ./cmd/agenthub-edge --addr 127.0.0.1:3210 --runner-profile opencode
```

**Mock 模式（无真实 CLI 也可体验）：**
```powershell
go run ./cmd/agenthub-edge --addr 127.0.0.1:3210 --runner-profile agenthub-runner-mock
```

### 第二步：启动 Desktop

```powershell
cd app/desktop
pnpm install
pnpm dev
```

打开 `http://localhost:5173`。

> 如果端口 5173 被占用，可以用 `pnpm dev --port 5199` 指定其他端口。

### 第三步：创建项目

Desktop 打开后：

1. 在左侧边栏点击"新建项目"
2. 输入项目名称和工作目录（本地路径）
3. 点击创建——AgentHub 会自动在 Edge Server 中注册该项目

### 第四步：选择 Agent 并开始对话

1. 在聊天界面顶部的 Runtime 选择器中选择 Agent（如 Claude Code）
2. 在输入框中输入任务描述
3. 按 Enter 发送——Agent 开始执行

---

## 核心功能

### Agent Profile 管理

在 Settings → Agent Profiles 中：

- **查看可用 Agent**：显示所有已配置的 Agent Profile，含 Runtime、模型、状态
- **创建自定义 Profile**：指定 Runtime、模型、Skills、MCP 工具、审批策略
- **切换 Agent**：在聊天界面顶部下拉框中选择不同 Agent

### 线程管理

- **创建线程**：发送第一条消息时自动创建
- **切换线程**：左侧 Threads 面板列出所有线程，点击切换
- **线程上下文**：每个线程保留完整的消息历史和 Agent 配置

### IM 群聊协作

- **创建群聊**：Settings → IM 群聊 → 新建群聊
- **添加 Agent**：将 Agent Profile 添加为群成员
- **@Agent 分配任务**：在群聊中 @Agent 名称，指定任务
- **多 Agent 协作**：Builder 写代码、Reviewer 审查、Tester 跑测试——一个群聊完成

### Diff 查看与审批

- **查看 Diff**：Agent 修改文件后，Diff 卡片自动出现在聊天中
- **审批操作**：点击 Approve 接受修改，Reject 拒绝
- **Side-by-Side 视图**：在 Diff 卡片右上角切换 Unified / Side-by-Side 模式

### 工作区和文件管理

- **选择工作目录**：在输入框左侧工作区菜单选择目标目录
- **最近目录**：最近使用的 6 个目录自动保存，方便快速切换

### 主题切换

- Settings → Appearance → 主题
- 支持 Dark / Light 双模式 + 6 套预设主题（One Dark Pro、Codex Dark、GitHub Light、Monokai、Solarized Dark、Nord）

### 语言切换

- Settings → Appearance → 语言
- 支持简体中文和 English，菜单、标签、提示文本全部本地化

---

## 启动 Hub Server（可选）

Hub 提供云账号、多端同步和远程协作功能。本地执行不需要 Hub。

```powershell
# 启动依赖服务
docker compose up -d

# 启动 Hub
cd hub-server
go run ./cmd/server-hub
```

### 登录 TokenDance ID

1. Desktop Settings → 账户 → 登录
2. 跳转 TokenDance ID 授权页面
3. 授权后自动回到 Desktop

---

## Mobile 端

AgentHub 提供 Android 原生客户端，用于移动端 IM、审批和预览。

### 构建 APK

```powershell
cd app/mobile
pnpm install
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
pnpm tauri android build --debug
```

构建产物在 `app/mobile/src-tauri/gen/android/app/build/outputs/apk/universal/debug/`。

---

## 常见操作速查

| 操作 | 方法 |
|------|------|
| 启动 Edge | `cd edge-server && go run ./cmd/agenthub-edge --addr :3210 --runner-profile claude-code` |
| 启动 Desktop | `cd app/desktop && pnpm dev` |
| 切换 Agent | 聊天界面顶部 Runtime 选择器 |
| 新建线程 | 点击 Threads 面板的 + 按钮或直接发送消息 |
| 查看 Diff | 聊天中的 Diff 卡片，支持 Apply/Reject |
| 创建群聊 | Settings → IM 群聊 → 新建 |
| 切换主题 | Settings → Appearance → 主题 |
| 切换语言 | Settings → Appearance → 语言 |

---

## 下一步

- [快捷键参考](keyboard-shortcuts.md) — 高效操作速查
- [常见问题](faq.md) — 使用中遇到的疑问解答
- [系统架构](../architecture/system-architecture.md) — 深入理解 AgentHub 技术架构

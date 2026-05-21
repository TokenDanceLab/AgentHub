# OpenHands 深度调研报告

> 调研对象：`D:\Code\AgentHub\reference\OpenHands`
> 版本：`1.7.0`（monorepo），外部 SDK 包 `1.22.1`
> 调研日期：2026-05-21

---

## 1. Sandbox/Workspace 隔离架构

### 1.1 架构概览

OpenHands 的 Sandbox 系统采用 **策略模式的 ABC（抽象基类）分层设计**，核心接口定义在 `openhands/app_server/sandbox/sandbox_service.py`，提供三种运行时实现：

| 实现 | 文件 | 用途 | 适用场景 |
|------|------|------|----------|
| `DockerSandboxService` | `docker_sandbox_service.py:82` | Docker 容器隔离 | 生产部署（默认） |
| `ProcessSandboxService` | `process_sandbox_service.py:67` | 子进程隔离 | 本地开发 (`RUNTIME=local`) |
| `RemoteSandboxService` | `remote_sandbox_service.py` | 远程 API 对接 | SaaS/Cloud 托管 |

### 1.2 SandboxService ABC（`sandbox_service.py:29-232`）

抽象基类定义七个核心操作：

```
SandboxService (ABC)
|- search_sandboxes()        -> SandboxPage           # 分页列表
|- get_sandbox(id)           -> SandboxInfo | None     # 单条查询
|- get_sandbox_by_session_api_key(key) -> SandboxInfo | None  # 按密钥查询
|- batch_get_sandboxes(ids)  -> list[SandboxInfo | None]       # 批量查询
|- start_sandbox(spec_id, sandbox_id) -> SandboxInfo  # 启动
|- resume_sandbox(id)        -> bool                   # 恢复暂停
|- wait_for_sandbox_running(id, timeout, poll_interval) -> SandboxInfo  # 等待就绪
|- pause_sandbox(id)         -> bool                   # 暂停
|- delete_sandbox(id)        -> bool                   # 删除
|- pause_old_sandboxes(max)  -> list[str]              # 淘汰最旧实例
```

### 1.3 状态机（`sandbox_models.py:9-16`）

```
STARTING --> RUNNING --> PAUSED
                |           |
                v           v
              ERROR      MISSING
```

六态定义（`SandboxStatus` enum）：
- `STARTING` -- 容器/进程正在启动
- `RUNNING` -- 正常运行，此时 available `exposed_urls` 和 `session_api_key`
- `PAUSED` -- 暂停（Docker pause / 进程挂起）
- `ERROR` -- 异常（超过 `startup_grace_seconds` 仍无响应）
- `MISSING` -- 已删除或不存在

### 1.4 DockerSandboxService 实现细节（`docker_sandbox_service.py:82-553`）

核心数据结构：

```python
# VolumeMount (行 61-68): 卷挂载
class VolumeMount(BaseModel):
    host_path: str         # 宿主机路径
    container_path: str    # 容器内挂载点
    mode: str = 'rw'       # 读写模式

# ExposedPort (行 71-78): 容器暴露端口
class ExposedPort(BaseModel):
    name: str              # AGENT_SERVER / VSCODE / WORKER_1 / WORKER_2
    description: str
    container_port: int = 8000
```

**SandboxInfo 模型**（`sandbox_models.py:33-56`）：
- `id` -- sandbox 唯一标识（base62 编码的随机 16 字节）
- `created_by_user_id` -- 归属用户
- `sandbox_spec_id` -- 关联的 Spec（对应 Docker image tag）
- `status` -- 状态枚举
- `session_api_key` -- 沙箱内 Agent Server 的鉴权 bearer token（仅 RUNNING 时返回）
- `exposed_urls` -- 暴露的服务 URL 列表（`AGENT_SERVER`、`VSCODE`、`WORKER_1`、`WORKER_2`）
- `created_at` -- 创建时间

**启动流程**（`start_sandbox` 行 360-493）：
1. 检查沙箱数量限制（`max_num_sandboxes`，默认 5），超出则暂停最旧的
2. 解析 sandbox_spec（确定 Docker image）
3. 生成 base62 随机 `sandbox_id`（16 字节）和 `session_api_key`（32 字节）
4. 注入环境变量：`OH_SESSION_API_KEYS_0`、`OH_WEBHOOKS_0_BASE_URL`、`OH_ALLOW_CORS_ORIGINS_*`
5. 端口映射：bridge 模式下每个 exposed_port 映射到宿主机随机空闲端口；host 网络模式下直通
6. `docker_client.containers.run()` 创建并启动容器（`detach=True`, `init=True`）
7. 返回 SandboxInfo（状态为 STARTING）

**健康检查**（`_container_to_checked_sandbox_info` 行 233-280）：
- 启动后 `startup_grace_seconds`（默认 15s）内无响应视为 `STARTING`
- 超过宽限期仍无响应视为 `ERROR`
- 通过 `httpx_client.get(agent_server_url/health)` 验证

**默认暴露端口**（行 583-613）：
| 端口名 | 容器端口 | 说明 |
|---------|----------|------|
| `AGENT_SERVER` | 8000 | Agent 核心服务 |
| `VSCODE` | 8001 | VS Code Server 远程开发 |
| `WORKER_1` | 8011 | Agent 启动的 App 服务器（端口 1） |
| `WORKER_2` | 8012 | Agent 启动的 App 服务器（端口 2） |

**关键环境变量**：
- `AGENT_SERVER_USE_HOST_NETWORK` -- 使用 host 网络模式（默认 false）
- `SANDBOX_KVM_ENABLED` -- 透传 `/dev/kvm` 设备（默认 false）
- `OH_SANDBOX_CONTAINER_URL_PATTERN` -- 容器 URL 模板，默认 `http://localhost:{port}`
- `OH_SANDBOX_HOST_PORT` -- App Server 端口（用于 Webhook 回调）

### 1.5 ProcessSandboxService（`process_sandbox_service.py:67`）

轻量级本地实现：每个 sandbox 是一个独立 Python `subprocess` 进程，各自绑定独立端口、工作目录和 session key。进程信息存储在全局字典 `_processes` 中（行 63）。适用于本地开发场景（`RUNTIME=local`），无需 Docker。

### 1.6 SandboxSpec 体系（`sandbox_spec_service.py` / `sandbox_spec_models.py`）

SandboxSpec 定义沙箱模板（对应 Docker image）：
- `id` -- image tag
- `command` -- 容器启动命令
- `initial_env` -- 初始环境变量
- `working_dir` -- 工作目录，默认 `/home/openhands/workspace`

Agent Server 镜像：`ghcr.io/openhands/agent-server:1.22.1-python`

环境变量自动转发（行 73-133）：以 `LLM_*` 和 `LMNR_*` 为前缀的变量自动注入 agent-server 容器。可通过 `OH_AGENT_SERVER_ENV` JSON 覆盖。

### 1.7 API 路由（`sandbox_router.py`）

前缀 `/api/v1/sandboxes`，FastAPI router 暴露：
- `GET /search` -- 分页搜索
- `GET ?id=...&id=...` -- 批量获取
- `POST ` -- 启动新沙箱
- `POST /{sandbox_id}/pause` -- 暂停
- `POST /{sandbox_id}/resume` -- 恢复
- `DELETE /{id}` -- 删除（连带清理 Docker volume）
- `GET /{sandbox_id}/settings/secrets` -- 列出沙箱可用 secrets
- `GET /{sandbox_id}/settings/secrets/{name}` -- 获取单个 secret 值

沙箱鉴权通过 `X-Session-API-Key` header。

---

## 2. 四包 SDK 设计

### 2.1 分层架构

OpenHands 采用 **外部 pip 包 + monorepo 应用层** 的四包架构，版本号分别为：

```
pip 包依赖树（pyproject.toml:249-251）:
  openhands (monorepo, v1.7.0)
     |-- openhands-agent-server==1.22.1   # Agent 运行时模型与工具
     |-- openhands-sdk==1.22.1            # 核心 SDK 基类
     |-- openhands-tools==1.22.1          # 工具实现集合
```

### 2.2 各层职责边界

#### Layer 1: `openhands-sdk`（最底层）
**职责**：跨包共享基类、工具函数、远程 workspace 抽象

```python
# 典型 import 路径
from openhands.sdk.utils.models import DiscriminatedUnionMixin, OpenHandsModel
from openhands.sdk.utils.paging import page_iterator
from openhands.sdk.workspace.remote.async_remote_workspace import AsyncRemoteWorkspace
```

- `DiscriminatedUnionMixin` -- 用于 Injector 子类型多态反序列化
- `page_iterator` -- 通用分页迭代器
- `AsyncRemoteWorkspace` -- 远程工作区客户端抽象

#### Layer 2: `openhands-agent-server`（模型层）
**职责**：跨 app_server 和 agent 运行时的共享数据模型、类型定义

```python
from openhands.agent_server.models import (
    ConversationInfo, EventPage, EventSortOrder,
    Success, TextContent, ImageContent
)
from openhands.agent_server.utils import OpenHandsUUID, utc_now
from openhands.agent_server.env_parser import from_env
```

- 定义所有 domain model（Conversation, Event, Sandbox 等）
- 提供 UUID 工具、时间工具
- 环境变量解析器（从 JSON 环境变量解析类型化配置）

#### Layer 3: `openhands-tools`（工具实现层）
**职责**：Agent 使用的工具预置集合

```python
from openhands.tools.preset.default import (...)    # 默认工具集
from openhands.tools.preset.planning import (...)   # 规划模式工具集
```

- 工具预置（presets）定义了 Agent 可用的工具组合
- `default` 预置：标准工具集
- `planning` 预置：带规划能力的工具集

#### Layer 4: `openhands`（Monorepo 应用层）

Monorepo 内部的 `openhands/` 包包含：

| 子包 | 路径 | 职责 |
|------|------|------|
| `app_server` | `openhands/app_server/` | **V1** FastAPI 应用服务器（生产） |
| `server` | `openhands/server/` | **V0** 旧版服务器（已标记 DEPRECATED） |
| `analytics` | `openhands/analytics/` | 匿名使用统计 |

##### V1 app_server 内部模块

```
app_server/
|- app.py                    # FastAPI 实例创建
|- v1_router.py              # /api/v1 路由聚合
|- config.py                 # 全局配置 + DI 依赖声明
|- app_conversation/         # 对话管理 (CRUD + 生命周期)
|- event/                    # 事件持久化（本地/内存/S3/GCS）
|- event_callback/           # 事件回调（如自动设置标题）
|- sandbox/                  # 沙箱管理（Docker/Process/Remote）
|- sandbox/session_auth.py   # X-Session-API-Key 鉴权
|- config_api/               # LLM 模型配置
|- file_store/               # 文件存储（local/memory/S3/GCS）
|- git/                      # Git 操作 API
|- integrations/             # 代码平台集成（GitHub/GitLab/Bitbucket/Azure DevOps）
|- mcp/                      # MCP Server（Tavily 代理）
|- pending_messages/         # 待发送消息队列
|- secrets/                  # 用户 Secrets 管理
|- services/                 # DI 框架（Injector + DbSession）
|- settings/                 # 用户/组织设置
|- status/                   # 健康检查
|- user/                     # 用户上下文 + 认证
|- web_client/               # Web 客户端配置注入
```

### 2.3 依赖注入框架（`services/injector.py`）

OpenHands 实现了一套轻量级 DI 框架：

```python
class Injector(Generic[T], ABC):
    async def inject(self, state, request) -> AsyncGenerator[T, None]: ...
    async def context(self, state, request) -> AsyncGenerator[T, None]: ...
    async def depends(self, request) -> AsyncGenerator[T, None]: ...
```

每个服务接口都配套一个 `*Injector` 子类（继承自 `DiscriminatedUnionMixin` + `Injector[T]`），通过 FastAPI `Depends` 注入：
- `SandboxServiceInjector` -> `DockerSandboxServiceInjector`
- `SandboxSpecServiceInjector` -> `DockerSandboxSpecServiceInjector`
- `EventServiceInjector` -> 多种持久化实现
- 等等

### 2.4 本地 vs 生产部署差异

| 维度 | 本地开发 (`RUNTIME=local`) | 生产部署 (Docker) | Cloud/SaaS |
|------|---------------------------|-------------------|------------|
| Sandbox 实现 | `ProcessSandboxService` | `DockerSandboxService` | `RemoteSandboxService` |
| 数据存储 | SQLite / 内存 | PostgreSQL + Redis | 托管 DB |
| Event 存储 | 本地文件系统 | S3 / GCS | 托管存储 |
| 前端 | `npm run dev` (Vite dev server) | `npm run build` + 内嵌静态文件 | 托管 CDN |
| 启动命令 | `make build && make run` | `docker-compose up` | N/A |
| App Server port | 3000（可配） | 3000（容器暴露） | 托管路由 |

---

## 3. 产品形态与 GUI 设计

### 3.1 三态产品定位

| 形态 | 入口 | 技术栈 | 目标用户 |
|------|------|--------|----------|
| **CLI** | `poetry run openhands`（V0，已废弃） | Python CLI + tmux | 个人开发者、CI/CD |
| **Web GUI** | 浏览器 `localhost:3000` | React SPA | 个人/团队本地部署 |
| **Cloud/SaaS** | `app.all-hands.dev` | 同上 + 托管后端 | 企业团队 |

### 3.2 Web GUI 技术栈（`frontend/`）

```
"react": "^19.2.3"
"react-router": "^7.12.0"        # React Router 7 (SPA + SSR)
"@heroui/react": "2.8.7"         # HeroUI 组件库 (基于 NextUI)
"@tanstack/react-query": "^5.90.19"  # 服务端状态管理
"tailwindcss": "^4.1.18"         # Tailwind CSS v4
"zustand"                        # 客户端状态管理（推断依赖）
"i18next": "^25.8.0"             # 国际化
"@xterm/xterm": "^6.0.0"         # 终端模拟器
"@monaco-editor/react": "^4.7.0" # Monaco 代码编辑器
"react-markdown": "^10.1.0"      # Markdown 渲染
"framer-motion": "^12.28.1"      # 动画
```

### 3.3 路由结构（React Router 7）

```
/                           -> home.tsx           # 首页：新建对话、最近对话
/accept-tos                 -> accept-tos.tsx     # 接受服务条款
/login                      -> login.tsx          # 登录
/device-verify              -> device-verify.tsx  # 设备验证
/settings                   -> settings.tsx       # 设置主页（多 Tab）
/settings/api-keys          -> api-keys.tsx
/settings/llm               -> llm-settings.tsx
/settings/agent             -> agent-settings.tsx
/settings/secrets           -> secrets-settings.tsx
/settings/mcp               -> mcp-settings.tsx
/settings/skills            -> skills-settings.tsx
/settings/git               -> git-settings.tsx
/settings/billing           -> billing.tsx
/settings/condenser         -> condenser-settings.tsx
/manage-org                 -> manage-org.tsx
/manage-organization-members -> manage-organization-members.tsx
/launch                     -> launch.tsx
/conversations/:id          -> conversation.tsx   # 对话页（核心）
/shared/:id                 -> shared-conversation.tsx  # 只读分享
/onboarding                 -> onboarding-form.tsx
```

### 3.4 对话页 UI 架构（核心页面）

`conversation.tsx` 是 OpenHands GUI 的核心，采用以下分层：

```
ConversationMain (conversation-main.tsx)
|- 可调整大小的双面板布局 (useResizablePanels)
|  |- 左侧：ChatInterfaceWrapper   # 对话流（AI 消息 + 用户输入）
|  |- 右侧：ConversationTabContent  # 多 Tab 面板
|     |- PlannerTab                # 任务规划
|     |- ChangesTab                # 代码变更 Diff
|     |- BrowserTab                # 内嵌浏览器
|     |- TaskListTab               # 任务列表
|     |- VSCodeTab                 # VS Code 远程开发
|- ConversationNameWithStatus     # 顶部：对话标题 + 状态指示
\- WebSocketProviderWrapper       # WebSocket 实时事件流
```

### 3.5 状态管理分层

**Zustand Stores**（客户端 UI 状态，17 个 store）：
| Store | 职责 |
|-------|------|
| `conversation-store` | 对话 UI 状态（面板展开/收起） |
| `agent-store` | Agent 运行状态 |
| `command-store` | 命令行终端状态 |
| `browser-store` | 内置浏览器 URL |
| `status-store` | 连接状态 |
| `use-event-store` | SSE/WebSocket 事件缓存 |
| `metrics-store` | Token 用量统计 |
| `model-store` | 模型选择 |
| `security-analyzer-store` | 安全分析器配置 |
| `v1-conversation-state-store` | V1 对话状态 |
| `home-store` | 首页状态 |
| `selected-organization-store` | 组织选择 |
| `error-message-store` | 错误消息 |
| `event-message-store` | 事件消息 |
| `initial-query-store` | 初始查询 |
| `optimistic-user-message-store` | 乐观更新用户消息 |
| `btw-store` | BTW 状态 |

**React Query**（API 数据层）：
- `useActiveConversation()` -- 获取当前对话
- `useTaskPolling()` -- 轮询任务状态
- `useIsAuthed()` -- 认证状态
- 各 service API 调用（`api/conversation-service`, `api/sandbox-service`, etc.）

### 3.6 API Service 层

`frontend/src/api/` 目录独立封装每个后端 API domain：
- `conversation-service/` -- 对话 CRUD + V1 专用接口
- `sandbox-service/` -- 沙箱操作
- `event-service/` -- 事件流
- `git-service/` -- Git 操作
- `integration-service/` -- 代码平台集成
- `config-service/` -- LLM 配置
- `settings-service/` -- 用户设置
- `skills-service.ts` / `secrets-service.ts` -- 独立服务
- `open-hands-axios.ts` -- 通用 Axios 实例

### 3.7 共享 UI 组件库（`openhands-ui/`）

独立 npm 包 `@openhands/ui`（v1.0.0-beta.9），基于 Storybook 开发：
- 构建工具：Vite + Tailwind CSS v4
- 引擎要求：Bun >=1.2.0, Node >=22, React >=19.1
- 依赖：`@floating-ui/react`、`react-select`、`focus-trap-react`
- 仅包含可复用 UI 组件，不含业务逻辑

---

## 4. Docker vs Git Worktree 对比（课设场景）

OpenHands 的 Sandbox 隔离方案与 AgentHub 课设场景的隔离需求对比如下：

### 4.1 对比矩阵

| 维度 | Docker Sandbox (OpenHands) | Git Worktree (AgentHub 课设设想) |
|------|---------------------------|----------------------------------|
| **隔离级别** | 操作系统级（容器隔离） | 文件系统级（目录隔离） |
| **环境一致性** | 完全一致（镜像固化） | 依赖宿主机环境 |
| **安全边界** | 强（cgroup/namespace） | 弱（同一进程空间） |
| **启动速度** | 1-5s（镜像缓存后） | <100ms（本地创建） |
| **资源开销** | 中等（~100MB+/容器） | 极低（仅目录） |
| **端口隔离** | 自动映射宿主端口 | 需手动管理端口 |
| **多用户支持** | 天然支持（session key） | 需自行实现 |
| **持久化** | VolumeMount 挂载 | 直接文件系统操作 |
| **清理** | 容器删除 + Volume 清理 | `git worktree remove` |
| **Python 依赖** | 镜像内独立安装 | 共享全局 venv / 各 worktree 独立 venv |
| **Git 状态管理** | 需额外 Hook 同步 | 天然支持（worktree 即分支） |
| **VS Code 集成** | 内置 VS Code Server | 可外挂 code-server |
| **复杂度** | 需要 Docker daemon | 仅需 Git |

### 4.2 课设场景推荐

对于 AgentHub 的**课程作业自动化**场景：

1. **轻量任务**（单步代码生成 / 文件级修改）：Git Worktree 更合适 -- 开销低、启动快、Git 操作自然
2. **复杂任务**（需要安装随机依赖 / 执行不确定代码 / 多语言运行环境）：Docker Sandbox 更安全
3. **推荐混合策略**：默认使用 Git Worktree 作为 workspace 隔离，提供可选的 Docker Sandbox 后盾

### 4.3 可借鉴的设计模式

1. **SandboxService ABC** -- 抽象统一接口，支持多种实现切换
2. **SandboxSpec 模板化** -- 定义可复用的沙箱蓝图（对应 worktree 的场景配置）
3. **Session API Key** -- 轻量级沙箱鉴权机制
4. **状态机模型** -- STARTING / RUNNING / PAUSED / ERROR 生命周期
5. **Startup Grace Period** -- 避免启动中的服务被误判为错误

---

## 5. 对 AgentHub 的具体建议

### 5.1 架构层面

1. **采用 ABC 抽象隔离层**：类似 `SandboxService` ABC，AgentHub 应定义 `WorkspaceService` 抽象接口，支持 Docker、Git Worktree、Process 等多种实现。在 `D:\Code\AgentHub\packages/` 下按实现分包子包。

2. **借鉴四包分层**：AgentHub 可对应设计：
   - `agenthub-sdk` -- 共享基类、工具函数（对应 `openhands-sdk`）
   - `agenthub-models` -- Domain models、类型定义（对应 `openhands-agent-server`）
   - `agenthub-tools` -- 课程场景专用工具集（对应 `openhands-tools`）
   - `agenthub-server` -- FastAPI 应用 + React GUI（对应 `openhands` monorepo）

3. **DI 框架值得引入**：OpenHands 的 `Injector[T]` + `Depends` 模式比手动传递依赖更优雅，AgentHub 可在服务层引入类似的轻量 DI。

### 5.2 前端层面

1. **双面板布局复用**：OpenHands 的 Chat + Tabs 可调整大小布局（`ConversationMain` 组件，使用 `useResizablePanels` hook）适合课设场景的 "对话 + 代码/预览" 双视图。

2. **Zustand + React Query 分层**：UI 状态用 Zustand stores，服务端数据用 React Query -- 清晰的关注点分离。

3. **HeroUI（基于 NextUI）组件库**：语义化组件、Tailwind CSS 原生集成，AgentHub 前端可考虑直接复用 `@openhands/ui` 或采用同款方案。

4. **Monaco Editor + Xterm.js**：内嵌代码编辑器和终端是 AgentHub 课设场景的刚需组件。

### 5.3 沙箱/可观测性层面

1. **WebSocket 事件流**：OpenHands 的前端通过 WebSocket 实时接收 Agent 执行事件（`EventHandler` wrapper），AgentHub 同样应实现类似的实时事件推送。

2. **ExposedUrl 模式**：AgentHub 可将每个 workspace 的服务（Jupyter、Web Preview、API Server）抽象为 named URLs，类似 OpenHands 的 `AGENT_SERVER`/`VSCODE`/`WORKER_N`。

3. **环境变量转发模式**：OpenHands 的 `LLM_*` 前缀自动转发（`sandbox_spec_service.py:74-133`）和 `OH_AGENT_SERVER_ENV` 覆盖机制，值得 AgentHub 在宿主机到 workspace 的配置传递中借鉴。

### 5.4 可直接复用的组件

| 组件 | 来源路径 | 用途 |
|------|---------|------|
| `Injector[T]` DI 框架 | `openhands/app_server/services/injector.py` | 服务依赖注入 |
| `SandboxService` ABC 模式 | `openhands/app_server/sandbox/sandbox_service.py` | Workspace 隔离抽象 |
| `DiscriminatedUnionMixin` | `openhands-sdk` 外部包 | Injector 多态反序列化 |
| `page_iterator` 通用分页 | `openhands-sdk` 外部包 | API 分页遍历 |
| `ConversationMain` 双面板布局 | `frontend/src/components/features/conversation/` | Chat + Tab 布局 |
| `useResizablePanels` hook | `frontend/src/hooks/` | 可调整大小面板 |
| `@openhands/ui` 组件库 | `openhands-ui/` | 可复用 UI 组件 |

### 5.5 不建议照搬的部分

1. **V0/V1 双版本并存** -- AgentHub 应从一开始就采用统一的 V1 架构，避免遗留包袱
2. **内置 VS Code Server** -- 课设场景可能不需要，增加资源开销，可作为可选功能
3. **复杂的 SaaS 多租户** -- 课设场景的用户量级不需要企业级多租户隔离
4. **config.toml 配置方式** -- AgentHub 可优先使用环境变量 + YAML 配置，TOML 并非必要

---

## 附录：关键文件索引

| 主题 | 文件路径 | 说明 |
|------|---------|------|
| Sandbox ABC | `openhands/app_server/sandbox/sandbox_service.py` | SandboxService 抽象基类 |
| Docker 实现 | `openhands/app_server/sandbox/docker_sandbox_service.py` | DockerSandboxService 完整实现 |
| Process 实现 | `openhands/app_server/sandbox/process_sandbox_service.py` | 子进程 Sandbox |
| Remote 实现 | `openhands/app_server/sandbox/remote_sandbox_service.py` | 远程 Sandbox（SaaS） |
| Sandbox 模型 | `openhands/app_server/sandbox/sandbox_models.py` | SandboxInfo、ExposedUrl、状态枚举 |
| SandboxSpec | `openhands/app_server/sandbox/sandbox_spec_models.py` | SandboxSpecInfo 模板模型 |
| Spec 服务 | `openhands/app_server/sandbox/sandbox_spec_service.py` | SandboxSpecService ABC |
| 路由 | `openhands/app_server/sandbox/sandbox_router.py` | `/api/v1/sandboxes` API |
| DI 框架 | `openhands/app_server/services/injector.py` | 泛型 Injector 依赖注入 |
| 应用入口 | `openhands/app_server/app.py` | FastAPI app 实例化 + 中间件 |
| V1 路由聚合 | `openhands/app_server/v1_router.py` | 所有 V1 API router 注册 |
| 全局配置 | `openhands/app_server/config.py` | 配置 + Injector 声明 |
| 对话服务 | `openhands/app_server/app_conversation/app_conversation_service.py` | AppConversationService ABC |
| 前端入口 | `frontend/src/root.tsx` | React Router Root Layout |
| 对话页 | `frontend/src/routes/conversation.tsx` | 核心对话页面 |
| 首页 | `frontend/src/routes/home.tsx` | 首页组件 |
| 对话主面板 | `frontend/src/components/features/conversation/conversation-main/conversation-main.tsx` | 双面板布局 |
| UI 库 | `openhands-ui/package.json` | `@openhands/ui` 共享组件库 |
| pyproject | `pyproject.toml` | 四包依赖声明 |
| Docker Compose | `docker-compose.yml` | 生产部署配置 |
| Makefile | `Makefile` | 构建目标 |
| 配置模板 | `config.template.toml` | 全量配置项参考 |

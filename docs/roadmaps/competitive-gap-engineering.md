# 代码架构与工程化竞品差距分析

> 分析时间：2026-06-03
> 分析范围：AgentHub 全栈 vs 9 个竞品/标杆

## 架构对比矩阵

| 维度 | AgentHub | Claude Code | OpenHands | Aider | Cline | Continue.dev | Codex CLI |
|------|----------|-------------|-----------|-------|-------|-------------|-----------|
| Agent Runtime 抽象 | ✅ 3 adapter (Claude/Codex/OpenCode) | ✅ TAOR循环 + 43+ tools | ✅ Plugin agent framework | ✅ Edit format 抽象 | ⚠️ VSCode 绑定 | ✅ Provider + Model adapter | ✅ 60+ crate Rust workspace |
| 沙箱隔离 | ❌ 无，本地进程直跑 | ⚠️ 7层权限防御 + sandbox toggle | ✅ Docker 容器隔离 | ⚠️ Git-based 变更沙箱 | ❌ 无 | ⚠️ 进程级 | ✅ OS内核级: Seatbelt/Bubblewrap+Landlock+Seccomp/ACL+WFP |
| API 契约 | ✅ OpenAPI 3.1 + WS events | ✅ NDJSON stream-json | ✅ REST + WebSocket | N/A (CLI only) | N/A (VS Code API) | ⚠️ 内部 API | ✅ JSONL + JSON-RPC over stdio |
| API 版本管理 | ⚠️ v1 path prefix only | ✅ version字段 + 协商 | ⚠️ 隐式版本 | N/A | N/A | ⚠️ 配置驱动 | ✅ 结构化版本(crate版本) |
| 测试体系 | ✅ 75%/40% CI gate | ⚠️ 有限公开 | ✅ pytest + Playwright | ✅ pytest + E2E | ✅ vitest + E2E | ✅ jest + E2E | ⚠️ Rust test suite |
| CI/CD | ✅ 跨平台矩阵+gosec+govulncheck | ✅ 标准 CI | ✅ GitHub Actions | ✅ GitHub Actions | ✅ GitHub Actions | ✅ CI | ✅ CI + 665 releases |
| 模块化 | ✅ Hub/Edge/App三层 | ✅ 清晰模块(51万行TS) | ✅ Plugin 系统 | ⚠️ 单体 CLI | ⚠️ 单体扩展 | ✅ Context Provider插件 | ✅ 60+crate Rust分层 |
| AI协作基础设施 | ✅ AGENTS.md+8Skills+STATE+dev-loop | ✅ CLAUDE.md+Skills+worktrees | ⚠️ 基础 AGENTS.md | ⚠️ 基础 .aider | ⚠️ .clinerules | ✅ config.ts | ✅ AGENTS.md |
| 可观测性 | ✅ slog+Prometheus | ✅ 结构化日志 | ⚠️ 基础日志 | ❌ print() | ⚠️ VS Code Output | ⚠️ 基础日志 | ⚠️ 基础 |
| 多Agent/Subagent | ✅ TeamRun编排+Orchestrator | ✅ worktree+task registry | ✅ Agent Delegation | ❌ | ⚠️ 有限 | ⚠️ 有限 | ✅ spawn_agent内核原语 |
| 上下文管理 | ✅ STATE.md+handoff+inbox | ✅ JSONL session+动态prompt | ⚠️ 基础 | ⚠️ .aider.conf | ⚠️ 基础 | ⚠️ 基础 | ✅ 无状态+compaction endpoint |

## 竞品深度架构分析

以下数据来源于公开仓库源码分析、技术博客和社区逆向工程（2025-2026）。

### Claude Code 架构关键发现
- **Agent 循环**：TAOR（Think-Act-Observe-Repeat），10种退出原因+7种续跑原因枚举。AsyncGenerator 模式
- **工具系统**：43+内置工具，逐输入判定的并发安全/只读/破坏性标记。两阶段渐进式加载：`shouldDefer: true` 的工具通过 ToolSearch 按需发现
- **权限**：7层纵深防御——BashSecurity（纯TS AST解析器，3449条黄金语料验证）→ PathValidation → ReadOnlyCheck → PreToolUse Hooks → 规则匹配 → ML分类器（Claude Haiku sidecar）→ 用户对话框
- **Subagent**：三种隔离（worktree/thread/remote）。Read-only agent省略CLAUDE.md和gitStatus，节省每周5-15 Gtok
- **会话**：JSONL append-only日志。用户消息同步写，assistant消息异步写

### Codex CLI 架构关键发现
- **技术栈**：Rust，60+crate workspace，Apache 2.0，71,700+ GitHub stars
- **Agent循环**：`loop {}` 仅4种退出原因——瘦harness理念：模型负责推理，沙箱负责边界
- **沙箱**：业界最独特的工程实践——macOS Seatbelt(.sbpl)、Linux Bubblewrap+Landlock+Seccomp BPF、Windows ACL+WFP+Desktop隔离。SandboxPolicy枚举4级
- **压缩**：专门 `/responses/compact` endpoint，返回 `encrypted_content`，分 PreTurn/MidTurn/StandaloneTurn 三阶段
- **IPC**：JSONL流(stdout) + JSON-RPC over stdio。已有类型化Python SDK(acodex)

### Cursor 架构关键发现（闭源，基于社区逆向+公开信息）
- **平台**：VS Code fork（v1.105.1），Electron 39.8.1
- **三层私有架构**：GLASS（50+服务，UI shell）+ COMPOSER（40+服务，AI引擎）+ Agent系统（11种子Agent类型）
- **Claude Code Proxy**：捆绑Anthropic Claude Agent SDK，通过本地proxy（127.0.0.1随机端口）→ ConnectRPC/protobuf → `api2.cursor.sh`。字符串替换引擎实时改品牌标识
- **自有模型**：`claude-3.7-sonnet-finetuned-cursor-20250514-v1`（微调版Claude 3.7 Sonnet）+ Composer（Anysphere首个自有编码模型，250tok/s）
- **gRPC**：58个gRPC服务，3031个protobuf类型。18个Cursor专属扩展

### Windsurf/Cascade 架构关键发现（闭源，基于公开信息）
- **平台**：VS Code fork，2025.12被Cognition AI收购（~$2.5亿）
- **Cascade**：多模式协作（编辑器+终端+浏览器+调试器）。时间线追踪5-10个编辑文件+终端命令+光标移动+浏览器截图
- **安全**：硬性安全闸门——破坏性命令"NEVER NEVER"自动执行，用户不可越权。比Claude Code的多层提示和Cursor的审批模式更激进
- **自有模型**：SWE-1.6（Cognition自有），200tok/s免费/950tok/s付费(Cerebras)，声称比Haiku 4.5快6x，比Sonnet 4.5快13x。通过真实任务环境端到端RL训练
- **两层Apply**：`reapply` 工具在主apply失败时调用更智能模型重试

### OpenHands 架构关键发现（开源，Apache 2.0）
- **技术栈**：Python monorepo + React 19/Vite 7 前端。正从V0→V1迁移（目标2026.4完成）
- **Sandbox 抽象**：五种后端——DockerSandboxService、RemoteSandboxService(E2B兼容)、ProcessSandboxService(裸进程)、KubernetesRuntime(Pod隔离)、ModalRuntime。可选隔离：低风险操作host-local，高风险触发容器
- **Agent架构 V1**：SDK驱动，sandbox内运行独立的FastAPI agent-server，暴露 `/execute_action`、`/list_files`、`/vscode/connection_token`。`Conversation.run()` 同步阻塞+async wrapper
- **Plugin系统**：`.plugin/plugin.json` manifest，动态 `Plugin.load_all()`。捆绑 skills/hooks/agents/commands/MCP config
- **CI**：20个GitHub Actions workflow，含AI PR review（Claude Sonnet 4.5审查diff）
- **可观测性**：OpenTelemetry-native——`agent.step`/tool calls/LLM API calls/lifecycle spans。OTLP export至Honeycomb/Jaeger/Datadog。Per-request cost tracking（USD+token breakdown）。Hooks API提供 PreToolUse/PostToolUse/UserPromptSubmit/SessionStart 等生命周期拦截
- **AI协作**：Skills(Microagents)系统——` AGENTS.md/CLAUDE.md/GEMINI.md/.cursorrules` 兼容解析。Knowledge Skills用KeywordTrigger regex。MCP tools via frontmatter声明

### Aider 架构关键发现（开源，Apache 2.0）
- **技术栈**：单体Python CLI。无沙箱——直接操作host文件系统。用tree-sitter + PageRank做代码理解
- **Agent循环**：`Coder.run_one()` → 同步LLM调用 → Edit Blocks → 文件应用 → Git commit。12种edit format子类（EditBlock/WholeFile/UnifiedDiff/Architect）。ArchitectCoder为独特的双模型架构：推理模型生成计划→编辑模型应用
- **代码理解**：Tree-sitter符号图→PageRank ranking（NetworkX，50x权重加权当前聊天中的文件）→token-budgeted输出（默认1024 tokens）。`.aider.tags.cache.v{version}/` 缓存
- **测试**：unittest框架（非pytest）。benchmark/ 目录跑polyglot-benchmark。60-88%新版本由Aider自己编写（dogfooding）
- **可观测性**：极简——opt-in analytics。Headless输出parseable text（token counts、costs、commit hashes）。无OpenTelemetry、无结构化日志。哲学是git本身就是audit trail
- **Agent协作**：不支持CLAUDE.md/AGENTS.md原生格式。RepoMap作为上下文注入机制替代。无skill/plugin系统

### Cline 架构关键发现（开源，Apache 2.0）
- **技术栈**：TypeScript monorepo（SDK + CLI + VS Code Extension）。2026年中完成SDK拆分——将agent循环从VS Code扩展提取为可复用runtime
- **分层架构**：`@cline/shared` → `@cline/llms` → `@cline/agents`(无状态浏览器兼容) → `@cline/core`(有状态Node runtime)。依赖单向流动
- **Plugin系统**：Subprocess隔离（`jiti` JIT TypeScript transpilation）。Plugins bundle tools/hooks/messageBuilders/commands/automationEvents。`.cline/plugins`(workspace) / `~/.cline/plugins`(global)
- **CI**：10 workflows。SDK tests跑在ubuntu+windows双平台，含SQLite smoke和TUI e2e。Qlty coverage上传
- **可观测性**：OTLP-first——PostHog(analytics) + OpenTelemetry(observability)。Metrics+structured logs via gRPC/HTTP。Debug mode: `TEL_DEBUG_DIAGNOSTICS=true`。Distributed tracing仍在roadmap。**Cline是唯一一个将OTel作为一等公民的AI编码工具**
- **AI协作**：`.clinerules`(项目规则) + `SKILL.md`(YAML frontmatter，`.agents/skills/`)。Skills支持 `disable-model-invocation`——仅description在session启动时加载，完整body在任务匹配时加载

### Continue.dev 架构关键发现（开源，Apache 2.0）
- **技术栈**：TypeScript monorepo（Core + VS Code + IntelliJ + CLI）。84.4% TypeScript。React GUI + Redux
- **架构**：三层消息传递——IDE Extensions(平台适配) → Core Backend(Core类作为中心编排器) → React GUI(侧面板webview)。80+ typed message types via `ToCoreProtocol`/`FromCoreProtocol`
- **LLM抽象**：三层adapter——`ILLM`接口 → `BaseLLM`类 → 40+ provider实现。`@continuedev/openai-adapters`将所有provider标准化为OpenAI-compatible接口。配置驱动(config.yaml/config.json + remote config + profiles)
- **Context Provider插件**：`IContextProvider`接口，三种交互(normal/query/submenu)。自定义provider通过HTTP endpoint或MCP server定义，`@provider-name` 调用
- **CI**：32 workflows——业界最广的CI覆盖面。dual Jest+Vitest测试。12 PR check jobs + composite actions。AI-driven CI——`auto-fix-failed-tests.yml`尝试自动修测试。Snyk安全扫描。`require-all-checks-to-pass` aggregate gate
- **AI协作**：`.continue/checks/`(AI agent check定义，markdown格式，作为PR status check运行)。`.continue/rules/`(规则定义)。Config-as-code哲学。MCP Context Provider桥接外部MCP server
- **可观测性**：基于protocol的结构化追踪（80+ message types）+ Redux state + configurable telemetry。无显式OpenTelemetry/Sentry集成

## 工程化成熟度评分（1-5 分）

| 维度 | AgentHub | 业界标杆 | 差距 | 比赛权重 |
|------|----------|---------|------|---------|
| Agent Runtime 架构 | 3.5/5 | 4.5/5 (OpenHands) | -1.0 | AI协作 30% |
| API 契约管理 | 4.0/5 | 4.5/5 (Claude Code) | -0.5 | 功能完整 25% |
| 测试覆盖率 | 3.5/5 | 4.5/5 (Aider) | -1.0 | 代码理解 15% |
| CI/CD 成熟度 | 4.5/5 | 4.5/5 (Continue.dev) | 0 | 代码理解 15% |
| 模块化/解耦 | 4.0/5 | 4.5/5 (OpenHands) | -0.5 | 代码理解 15% |
| AI 协作基础设施 | 5.0/5 | 4.0/5 (Claude Code) | **+1.0** | AI协作 30% |
| 可观测性 | 3.0/5 | 4.5/5 (OpenHands, Cline) | -1.5 | 功能完整 25% |

### 综合评分

| 维度 | 原始分 | 权重 | 加权得分 |
|------|--------|------|----------|
| AI 协作能力相关 | (3.5 + 5.0) / 2 = 4.25 | 30% | 1.275 |
| 功能完整度相关 | (4.0 + 3.0) / 2 = 3.50 | 25% | 0.875 |
| 代码理解度相关 | (3.5 + 4.5 + 4.0) / 3 = 4.00 | 15% | 0.600 |
| **综合** | | | **2.75 / 3.50** (78.6%) |

## 改进清单（按比赛评分维度排序）

### AI 协作能力（权重 30%）

1. **[高优先级] MCP Tool/Resource 暴露**
   - 当前状态：Edge 可消费外部 MCP server，但 AgentHub 自身不暴露为 MCP server
   - 竞品做法：Claude Code 和 Codex 都支持 MCP 双向——既能调用外部 MCP tools，也能作为 MCP server 暴露自身能力
   - 改进方案：在 Edge Server 新增 `/mcp` 端点，将 AgentHub 的 project/thread/run/artifact 能力暴露为 MCP tools。其他 AI 编码工具可通过 MCP 协议调用 AgentHub 的 Agent Runtime 调度、审批流、diff 预览等能力
   - 涉及文件：`edge-server/internal/mcp/`（新建），`edge-server/internal/httpserver/server.go`
   - 预估工作量：3-5 天

2. **[高优先级] Agent Context 标准化（AGENTS.md → MCP Prompt 标准）**
   - 当前状态：AGENTS.md 体系是 AgentHub 核心差异化优势，8 个仓库级 skill + dev-loop + STATE.md 构成完整的 Agent 协作基础设施
   - 竞品做法：
     - **OpenHands**：Skills(Microagents)系统——`.agents/skills/*.md` with YAML frontmatter（name, trigger）。三种类型：Repository Skills（解析AGENTS.md/CLAUDE.md/GEMINI.md/.cursorrules）、Knowledge Skills（KeywordTrigger regex）、Task Skills（结构化输入）。MCP tools via frontmatter声明
     - **Cline**：SKILL.md + `.clinerules`。Skills支持 `disable-model-invocation`——仅description在session启动时加载
     - **Anthropic**：推动 CLAUDE.md / MCP Prompt 标准化，Codex 使用 AGENTS.md
   - 改进方案：发布 AgentHub Skill/Prompt 格式规范文档，证明 AgentHub 在 Agent 协作基础设施方面的领先性。将 AGENTS.md 兼容性扩展到 Claude Code 的 CLAUDE.md 格式，对标 OpenHands 的 Skills frontmatter 规范和 Cline 的 `.clinerules` 自动发现
   - 涉及文件：`docs/standards/agenthub-agent-spec.md`（新建），`docs/standards/skill-spec.md`（新建）
   - 预估工作量：1-2 天

3. **[中优先级] Subagent 编排标准化**
   - 当前状态：dev-loop skill 定义了 opus/haiku/sonnet 三模型分配策略，支持 subagent 并行协作和交叉审查。AgentTeam/TeamRun 后端已有 StartTeamRun、route decision、assignment、guardrail 闭环
   - 竞品做法：
     - **Claude Code**：三种隔离级别——worktree(独立副本+独立分支+继承权限)、thread(共享文件状态+双向邮箱通信)、remote(独立进程+WebSocket)。Task Registry映射taskId→TaskState
     - **Codex CLI**：`spawn_agent` 内核原语，60+crate workspace中 agent 调度为第一等公民
     - **Cursor**：11种子Agent类型(Bash/BrowserUse/ComputerUse/Debug/Explore/Shell/VmSetupHelper等)，最高8并行+git worktrees
   - 改进方案：将 dev-loop 的 subagent 编排模式抽象为可配置的 TeamRun 编排策略 DSL，支持在 Agent Profile 中定义多 Agent 协作拓扑。将当前的 opus/sonnet/haiku 三模型分配升级为可插拔的 AgentType 注册表
   - 涉及文件：`hub-server/internal/service/agent_team.go`, `edge-server/internal/adapters/orchestrator.go`
   - 预估工作量：5-7 天

### 功能完整度（权重 25%）

4. **[高优先级] 沙箱执行隔离**
   - 当前状态：Edge 直接在本机进程执行 Agent CLI，无任何容器/沙箱隔离。Agent 可以读写本地文件系统任意路径（仅 workspace allowlist 限制）
   - 竞品做法：
     - **Codex CLI（行业标杆）**：OS内核级隔离——macOS Seatbelt(.sbpl策略文件)、Linux Bubblewrap+Landlock+Seccomp BPF、Windows ACL+WFP+Desktop隔离。`SandboxPolicy` 枚举4级（ReadOnly/WorkspaceWrite/DangerFullAccess/ExternalSandbox）。AskForApproval含OnFailure策略——"信任沙箱，仅当沙箱介入时才向用户确认"
     - **Claude Code**：7层应用权限防御——BashSecurity(纯TS AST解析器,3449条黄金语料验证)→PathValidation→ReadOnlyCheck→PreToolUse Hooks→规则匹配→ML分类器(Claude Haiku sidecar)→用户对话框
     - **OpenHands**：Docker 容器隔离每个 Agent session
   - 改进方案：P0：Edge 增加 Docker sandbox adapter，可配置 Agent Runtime 在隔离容器中执行。P1：workspace volume mount + network 策略。作为比赛亮点，实现"三模式执行"（本地直连 / Docker 沙箱 / 云端容器）。参考 Codex CLI 的 `SandboxPolicy` 枚举设计权限分级
   - 涉及文件：`edge-server/internal/adapters/sandbox/`（新建），`edge-server/internal/lifecycle/sandbox_executor.go`（新建）
   - 预估工作量：7-10 天

5. **[中优先级] API 版本管理机制**
   - 当前状态：所有端点统一 `/v1/` 前缀，OpenAPI spec 内用 `x-agenthub-status: implemented|planned` 标记实现状态。没有 breaking change 管理策略
   - 竞品做法：Claude Code 在事件 envelope 中内嵌 `version` 字段，支持 client/server 版本协商。Stripe 式 API versioning
   - 改进方案：Edge 事件 envelope 已有 `version: "v1"` 字段（events.md），现在补齐 server 端版本协商：`GET /v1/health` 返回 `apiVersions` 数组，客户端可请求特定版本。Hub/Edge 间加上 version header
   - 涉及文件：`edge-server/internal/api/handlers.go`，`hub-server/internal/handler/`，`api/openapi.yaml`
   - 预估工作量：2-3 天

6. **[中优先级] OpenAPI Spec 从 Go 代码自动生成**
   - 当前状态：`api/openapi.yaml` 是手写的 5590 行 YAML，与 Go 代码可能产生 drift
   - 竞品做法：Continue.dev 使用 config-as-code 模式，OpenHands 使用 FastAPI 自动生成 OpenAPI
   - 改进方案：Hub 和 Edge 都使用 `swaggo/swag` 或 `go-swagger` 从 Go 代码注释自动生成 OpenAPI spec，将 `api/openapi.yaml` 变为构建产物而非手写源文件
   - 涉及文件：`hub-server/internal/handler/*.go`，`edge-server/internal/api/handlers.go`
   - 预估工作量：3-5 天

### 代码理解度（权重 15%）

7. **[高优先级] Hub Server 测试覆盖率从 40%→65%**
   - 当前状态：CI 强制 40% 覆盖率门禁，当前约 51%。handler/service/middleware 层覆盖不足
   - 竞品做法：
     - **OpenHands**：pytest + pytest-xdist并行 + pytest-cov。Coverage reports merged and posted as PR comments
     - **Continue.dev**：32 workflows，dual Jest+Vitest，PR checks 12 jobs。`auto-fix-failed-tests.yml` AI自动修测试
     - **Cline**：ubuntu+windows双平台SDK tests，含SQLite smoke和TUI e2e
   - 改进方案：重点补 handler 层集成测试（HTTP handler test with httptest），service 层 mock repository 测试，middleware 层边界测试。优先覆盖 auth、session、agent dispatch、execution target 等核心路径。参考 OpenHands 的 coverage comment 机制
   - 涉及文件：`hub-server/internal/handler/*_test.go`，`hub-server/internal/service/*_test.go`
   - 预估工作量：5-7 天

8. **[中优先级] 前端 E2E 测试矩阵扩展**
   - 当前状态：Playwright E2E 仅 Chromium，27 个测试，Desktop E2E 在 `.tmp/` 中零散分布
   - 竞品做法：OpenHands 有完整的 Playwright 矩阵（Chromium + Firefox + WebKit），Cline 有 VS Code extension E2E 测试
   - 改进方案：将 `.tmp/` 中的 Playwright 测试正式化到 `app/e2e/` 目录，增加 Firefox/WebKit 项目，覆盖核心用户流程（登录→创建线程→发送消息→查看 diff→审批→完成）
   - 涉及文件：`app/e2e/`（整理），`app/desktop/playwright.config.ts`
   - 预估工作量：3-5 天

9. **[低优先级] Architecture Decision Records (ADR)**
   - 当前状态：架构决策散落在 AGENTS.md、STATE.md 和 docs/architecture/ 中，缺乏结构化的决策记录
   - 竞品做法：OpenHands 和 Continue.dev 使用 ADR 记录关键架构决策
   - 改进方案：`docs/architecture/decisions/` 目录，用 ADR 模板记录 5-10 个关键决策（适配器模式选择、Hub/Edge 分层、Tauri 选型、OpenAPI 3.1 选型等）
   - 涉及文件：`docs/architecture/decisions/`（新建）
   - 预估工作量：1-2 天

### 补充改进（非比赛直接加分，但提升工程完整性）

10. **[补充] 分布式追踪（OpenTelemetry）**
    - 当前状态：Edge 有 Prometheus metrics + slog 结构化日志，但没有分布式追踪。Hub↔Edge↔Desktop 链路无法端到端 trace
    - 改进方案：Edge 和 Hub 接入 OpenTelemetry SDK，在 HTTP middleware + WebSocket + adapter 执行中注入 trace context。导出到本地 Jaeger 或 OTLP collector
    - 涉及文件：`edge-server/internal/middleware/`，`hub-server/internal/middleware/`
    - 预估工作量：3-5 天

11. **[补充] 前端错误追踪**
    - 当前状态：前端使用 `console.error`，无错误聚合/上报。Desktop Tauri 侧有 ErrorBoundary（Chunk error 自动恢复）
    - 改进方案：接入 Sentry 或等价前端错误追踪 SDK（仅 Desktop production build），捕获未处理异常和 Promise rejection
    - 涉及文件：`app/desktop/src/main.tsx`，`app/shared/src/errorReporting.ts`（新建）
    - 预估工作量：2-3 天

## AgentHub 工程化亮点（比赛加分项）

1. **AI 协作基础设施行业领先**：AGENTS.md（470+行）+ 8 个仓库级 skill + dev-loop 开发引擎 + STATE.md 跨 session 状态 + docs/inbox 收件箱 + Worktree + Subagent 约定。这套体系是目前公开可见的最完整的 Agent-native 开发基础设施。对比数据：
   - **Claude Code**：CLAUDE.md + Skills + worktrees（最接近的竞品，但缺少 STATE.md 跨session状态和 inbox 收件箱）
   - **Codex CLI**：AGENTS.md 标准（基础级别，无 skill 系统）
   - **Cursor**：AGENTS.md（通过 Claude Code Proxy 继承，但做了品牌替换）
   - **Windsurf**：维护 Flow 时间线（自动追踪而非声明式）

2. **OpenAPI 3.1 完整契约文档**：5590 行手写 OpenAPI spec，用 `x-agenthub-status` 扩展标注 implemented/planned 状态。对比：
   - Claude Code：NDJSON stream-json（内部协议，无公开 spec）
   - Codex CLI：JSONL + JSON-RPC（无 OpenAPI）
   - Cursor/Windsurf：闭源，无公开 API spec
   - AgentHub 是唯一提供标准 OpenAPI 3.1 文档的 AI 编码工具

2. **OpenAPI 3.1 完整契约文档**：5590 行手写 OpenAPI spec，用 `x-agenthub-status` 扩展标注 implemented/planned 状态，是阿里竞赛"代码理解度"维度的直接得分点。

3. **Go CI 工程链完整**：`go test -short -race -coverprofile` + golangci-lint v2 + gosec + govulncheck + benchmark regression + 跨平台 build matrix。覆盖了 Go 生态中几乎所有主流质量工具。

4. **三层架构边界清晰**：Hub（账号/IM/同步/中继）、Edge（执行节点/Runtime适配）、Desktop/Mobile（Tauri 原生客户端）+ Web（浏览器工作台）。Hub/Edge 间通过 OpenAPI + WebSocket events 解耦，两个 Tauri 项目（Desktop/Mobile）独立不共享。

5. **WebSocket 事件协议设计**：Edge EventEnvelope（含 version/id/seq/scope/traceId）和 Hub flat frame 两套事件格式，覆盖了 agent run 生命周期、IM 消息、设备管理、Team 编排等完整事件类型。

6. **安全工程意识**：secret guard CI 步骤、CORS 分层配置、TokenDance ID OIDC PKCE 流程、权限模型（authorization-model.md）、安全风险登记表（security-risk-register.md）、生产密钥不入仓库。

7. **生产部署证据链**：Docker Compose 开发/生产环境、hk2 生产部署记录、S3 对象存储集成、DB migration 版本追踪（39 migrations）、健康检查。

## 比赛策略建议

### 优先展示的亮点（AI 协作能力 30% 得分最大化）

1. **AGENTS.md + Skills + STATE.md 三件套**：展示 AgentHub 如何让 AI Agent 自主开发 AgentHub 自身。这是"AI 协作能力"最直接的证据——用你自己的产品开发你自己的产品。

2. **dev-loop 开发引擎演示**：展示一次完整的 dev-loop 循环——从 STATE.md 加载状态 → 拆解任务 → 分发 subagent → 并行编码 → 交叉审查 → 更新 STATE.md → commit。这比任何架构图都更有说服力。

3. **WebSocket typed events + OpenAPI**：展示 API 契约的完整性和事件驱动的实时性，对比其他竞品通常只有 REST 或只有 WebSocket。

### 快速补齐的差距（1-3 天可完成）

4. **MCP 端点暴露**（改进项 #1）：证明 AgentHub 兼容行业标准协议
5. **ADR 记录**（改进项 #9）：证明工程决策有据可查
6. **API 版本协商**（改进项 #5）：证明 API 设计的前瞻性

### 不要花时间的

- 不要追求 Hub 80% 测试覆盖率——40% 门禁 + 当前 51% 足以证明测试意识
- 不要在比赛中主动提沙箱隔离缺失——AgentHub 定位是本地桌面产品，不是云端 SaaS
- 不要花时间做 OpenTelemetry 全链路——Demo 阶段不需要生产级可观测性

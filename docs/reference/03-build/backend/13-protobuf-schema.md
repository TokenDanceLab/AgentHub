# AgentHub Protocol Buffers Schema

> 2026-05-22 更新：本文是 Protobuf / Connect-RPC 方案参考，不是当前 M0 主协议入口。当前协议入口为 `api/openapi.yaml`、`api/events.md` 和 `api/conventions.md`，主链路采用 REST JSON API + WebSocket typed events。
>
> 基于 design-protocol.md（1,894 行 Go 类型定义）直接翻译
> 配合 Buf v2 + connect-go 工作流（见 web-research-tech-stack.md）

## 目录结构

```
proto/agenthub/v1/
├── shared.proto          # 基础类型
├── agent.proto           # Agent Adapter 协议
├── im.proto              # IM 会话/消息
├── sync.proto            # Hub-Edge 同步
├── orchestration.proto   # Orchestrator 调度
└── approval.proto        # 审批协议
```

## 1. shared.proto

```protobuf
syntax = "proto3";
package agenthub.v1;
import "google/protobuf/timestamp.proto";

// -- ID 类型 (string alias for type safety) --
// 所有 ID 使用 string，前缀标识类型

// -- Authority 类型 --
// 参考 architecture.md ConversationAuthority / ExecutionAuthority

message EdgeAuthority {
  string edge_id = 1;
}

message HubAuthority {
  string hub_id = 1;
}

message ConversationAuthority {
  oneof authority {
    EdgeAuthority edge = 1;
    HubAuthority hub = 2;
  }
}

message ExecutionAuthority {
  string edge_id = 1;
  string runner_id = 2;
  string workspace_id = 3;
}

message ArtifactAuthority {
  oneof authority {
    string edge_id = 1;
    string hub_id = 2;
  }
}

// -- 通用状态枚举 --
enum RunStatus {
  RUN_STATUS_UNSPECIFIED = 0;
  RUN_STATUS_STARTING = 1;
  RUN_STATUS_RUNNING = 2;
  RUN_STATUS_WAITING_APPROVAL = 3;
  RUN_STATUS_DRAINING = 4;
  RUN_STATUS_DONE = 5;
  RUN_STATUS_FAILED = 6;
  RUN_STATUS_CANCELLED = 7;
}

// -- 分页 --
message Pagination {
  int32 offset = 1;
  int32 limit = 2;
  int32 total = 3;
  bool has_more = 4;
}
```

## 2. agent.proto

```protobuf
syntax = "proto3";
package agenthub.v1;
import "google/protobuf/timestamp.proto";
import "agenthub/v1/shared.proto";

// -- Agent 类型 --
// 参考 cross-analysis-adapters.md Section 1

enum AgentType {
  AGENT_TYPE_UNSPECIFIED = 0;
  AGENT_TYPE_CLAUDE_CODE = 1;
  AGENT_TYPE_CODEX = 2;
  AGENT_TYPE_OPENCODE = 3;
  AGENT_TYPE_CUSTOM = 4;
}

// -- Agent 配置 (per-agent) --
// 参考 cross-analysis-adapters.md Section 3

message ClaudeCodeConfig {
  string claude_path = 1;             // claude CLI path
  string output_format = 2;           // "stream-json" (default)
  bool verbose = 3;                   // --verbose flag
  bool include_partial_messages = 4;  // stream_event 事件
  bool replay_user_messages = 5;      // 回放用户消息
  int32 max_turns = 6;               // 最大轮次
  double max_budget_usd = 7;         // 预算上限
}

message CodexConfig {
  string codex_path = 1;
  string config_toml_template = 2;   // 自动生成的 config.toml
  bool use_rollout_replay = 3;       // rollout replay 模式
  string fork_mode = 4;              // "none" | "latest" | "full"
}

message OpenCodeConfig {
  string opencode_path = 1;
  string server_addr = 2;            // opencode serve addr
  bool use_sdk = 3;                  // 使用 OpenAPI SDK vs CLI
}

message AgentConfig {
  AgentType type = 1;
  string agent_id = 2;
  string display_name = 3;
  repeated string capabilities = 4;  // 能力标签
  oneof config {
    ClaudeCodeConfig claude_code = 10;
    CodexConfig codex = 11;
    OpenCodeConfig opencode = 12;
  }
}

// -- StartRequest --
// 参考 design-protocol.md Section 2.3

message ThinkingConfig {
  oneof mode {
    bool adaptive = 1;
    int32 budget_tokens = 2;
    bool disabled = 3;
  }
}

message SandboxConfig {
  enum Level {
    LEVEL_UNSPECIFIED = 0;
    LEVEL_WORKTREE = 1;   // Git worktree (default)
    LEVEL_PROCESS = 2;    // OS process isolation
    LEVEL_DOCKER = 3;     // Docker container
  }
  Level level = 1;
  string image = 2;             // Docker image (Level 3)
  repeated string mounts = 3;   // volume mounts
}

message MCPConfig {
  repeated string servers = 1;  // MCP server names
}

message StartRequest {
  string conversation_id = 1;
  string thread_id = 2;
  string project_id = 3;
  string prompt = 4;
  AgentConfig agent = 5;
  ThinkingConfig thinking = 6;
  SandboxConfig sandbox = 7;
  MCPConfig mcp = 8;
  repeated string allowed_tools = 9;
  repeated string disallowed_tools = 10;
  string permission_mode = 11;       // "default" | "acceptEdits" | "bypassPermissions" | "plan"
  string resume_session_id = 12;     // 恢复已有 session
  string fork_conversation_id = 13;  // fork 会话
  string fork_mode = 14;             // "DIRECT_PATH" | "INCLUDE_BRANCHES" | "TARGET_LEVEL"
}

// -- AgentSession --
// 参考 cross-analysis-adapters.md Section 2.4

message AgentSession {
  string session_id = 1;
  string agent_id = 2;
  string conversation_id = 3;
  string workspace_id = 4;
  RunStatus status = 5;
  int32 pid = 6;
  google.protobuf.Timestamp started_at = 7;
  google.protobuf.Timestamp ended_at = 8;
  string external_session_id = 9;  // Claude Code / Codex 的 session ID
}

// -- AgentEvent (统一 12 种事件) --
// 参考 cross-analysis-adapters.md Section 2.2 + design-protocol.md

message SystemInitPayload {
  string model = 1;
  string permission_mode = 2;
  repeated string tools = 3;
  int32 context_window = 4;
}

message AssistantTextPayload {
  string content = 1;
  int32 index = 2;
}

message ReasoningPayload {
  string content = 1;  // thinking block content
}

message ToolCallPayload {
  string tool_id = 1;
  string tool_name = 2;
  string input_json = 3;  // JSON-serialized input
}

message ToolResultPayload {
  string tool_id = 1;
  string tool_name = 2;
  string output = 3;
  bool is_error = 4;
}

message ToolProgressPayload {
  string tool_id = 1;
  string tool_name = 2;
  int32 elapsed_ms = 3;
}

message ResultPayload {
  string subtype = 1;  // "success" | "error_during_execution" | "error_max_turns" | "error_max_budget_usd"
  bool is_error = 2;
  int32 exit_code = 3; // 参考 Claude Code: lastMessage.is_error ? 1 : 0
  string error_message = 4;
  ModelUsage usage = 5;
}

message ModelUsage {
  int32 input_tokens = 1;
  int32 output_tokens = 2;
  int32 cache_read_input_tokens = 3;
  int32 cache_creation_input_tokens = 4;
  int32 web_search_requests = 5;
  double cost_usd = 6;
}

message StatusChangePayload {
  RunStatus from = 1;
  RunStatus to = 2;
  string reason = 3;
}

message ApprovalRequestPayload {
  string approval_id = 1;
  string tool_name = 2;
  string command = 3;
  string risk_level = 4;  // "low" | "medium" | "high"
  int32 timeout_ms = 5;
}

message ToolUseSummaryPayload {
  string summary = 1;  // Haiku 生成的工具调用摘要
}

message AgentEvent {
  string run_id = 1;
  string agent_id = 2;
  google.protobuf.Timestamp timestamp = 3;
  oneof event {
    SystemInitPayload system_init = 10;
    AssistantTextPayload assistant_text = 11;
    ReasoningPayload reasoning = 12;
    ToolCallPayload tool_call = 13;
    ToolResultPayload tool_result = 14;
    ToolProgressPayload tool_progress = 15;
    ResultPayload result = 16;
    StatusChangePayload status_change = 17;
    ApprovalRequestPayload approval_request = 18;
    ToolUseSummaryPayload tool_use_summary = 19;
    // stream_event: 原始 API 流事件 (include_partial_messages=true)
    string stream_event_json = 20;
    // system: compact_boundary / api_retry / hook lifecycle
    string system_subtype = 21;
    string system_message_json = 22;
  }
}
```

## 3. im.proto

```protobuf
syntax = "proto3";
package agenthub.v1;
import "google/protobuf/timestamp.proto";
import "agenthub/v1/shared.proto";

// -- Conversation --
// 参考 cross-analysis-im-ux.md + librechat 消息树

enum ConversationType {
  CONVERSATION_TYPE_UNSPECIFIED = 0;
  CONVERSATION_TYPE_DIRECT = 1;  // 单聊
  CONVERSATION_TYPE_GROUP = 2;   // 群聊
}

message Conversation {
  string id = 1;
  string project_id = 2;
  ConversationType type = 3;
  string title = 4;
  ConversationAuthority authority = 5;
  bool sync_enabled = 6;
  bool archived = 7;
  bool pinned = 8;
  google.protobuf.Timestamp created_at = 9;
  google.protobuf.Timestamp updated_at = 10;
  google.protobuf.Timestamp last_message_at = 11;
}

message ConversationMember {
  string conversation_id = 1;
  string member_id = 2;
  enum MemberType {
    MEMBER_TYPE_UNSPECIFIED = 0;
    MEMBER_TYPE_USER = 1;
    MEMBER_TYPE_AGENT = 2;
  }
  MemberType member_type = 3;
  enum Role {
    ROLE_UNSPECIFIED = 0;
    ROLE_OWNER = 1;
    ROLE_ADMIN = 2;
    ROLE_MEMBER = 3;
    ROLE_ORCHESTRATOR = 4;
  }
  Role role = 4;
  google.protobuf.Timestamp joined_at = 5;
}

// -- Message (消息树节点) --
// 参考 librechat buildTree() + SiblingSwitch

message Message {
  string id = 1;
  string conversation_id = 2;
  string thread_id = 3;
  string parent_message_id = 4;  // 父消息（构建树）
  string sender_type = 5;         // "user" | "agent" | "system" | "runner"
  string sender_id = 6;
  string content = 7;
  enum ContentFormat {
    CONTENT_FORMAT_UNSPECIFIED = 0;
    CONTENT_FORMAT_MARKDOWN = 1;
    CONTENT_FORMAT_PLAIN = 2;
    CONTENT_FORMAT_JSON = 3;
  }
  ContentFormat content_format = 8;
  repeated string mentions = 9;   // @agent 列表
  enum MessageStatus {
    MESSAGE_STATUS_UNSPECIFIED = 0;
    MESSAGE_STATUS_SENDING = 1;
    MESSAGE_STATUS_STREAMING = 2;
    MESSAGE_STATUS_DONE = 3;
    MESSAGE_STATUS_FAILED = 4;
  }
  MessageStatus status = 10;
  repeated string artifact_ids = 11;
  google.protobuf.Timestamp created_at = 12;
  google.protobuf.Timestamp updated_at = 13;
}

// 消息树节点 (前端渲染用)
message MessageTreeNode {
  Message message = 1;
  repeated MessageTreeNode children = 2;  // 子消息 (fork branches)
  int32 sibling_index = 3;                // 当前活跃分支索引
  int32 total_siblings = 4;               // 兄弟节点总数
}

// -- Thread --
message Thread {
  string id = 1;
  string conversation_id = 2;
  string root_message_id = 3;
  string title = 4;
  string summary = 5;
  google.protobuf.Timestamp created_at = 6;
  google.protobuf.Timestamp updated_at = 7;
}

// -- Fork 模式 --
// 参考 librechat 四种 Fork 模式
enum ForkMode {
  FORK_MODE_UNSPECIFIED = 0;
  FORK_MODE_DIRECT_PATH = 1;       // 仅复制消息到目标路径
  FORK_MODE_INCLUDE_BRANCHES = 2;   // 包含所有分支
  FORK_MODE_TARGET_LEVEL = 3;       // 到目标深度的完整子树
  FORK_MODE_DEFAULT = 4;            // 默认模式
}
```

## 4. sync.proto

```protobuf
syntax = "proto3";
package agenthub.v1;
import "google/protobuf/timestamp.proto";
import "agenthub/v1/shared.proto";

// -- Edge 注册 --
message RegisterRequest {
  string edge_id = 1;
  string device_name = 2;
  string edge_version = 3;
  string public_key = 4;  // Ed25519 公钥 (用于 E2EE)
  repeated string runner_ids = 5;
  int32 max_concurrent_runs = 6;
}

message RegisterResponse {
  bool accepted = 1;
  string edge_token = 2;     // 短期 token
  int32 heartbeat_interval_sec = 3;
  string hub_version = 4;
}

// -- 心跳 --
message Heartbeat {
  string edge_id = 1;
  int32 running_runs = 2;       // 当前执行中任务数
  double cpu_percent = 3;
  double memory_mb = 4;
  int64 disk_free_mb = 5;
}

message HeartbeatAck {
  bool ok = 1;
  int32 next_interval_sec = 2;
  repeated string pending_commands = 3;  // 待处理的远程命令
}

// -- 同步事件 --
message EdgeEvent {
  string edge_id = 1;
  string conversation_id = 2;
  int64 seq = 3;  // Edge 侧递增序号
  google.protobuf.Timestamp created_at = 4;
  oneof event {
    // 消息事件
    string message_created_json = 10;
    // 运行事件
    string run_started_json = 11;
    string run_status_changed_json = 12;
    // 产物事件
    string artifact_created_json = 13;
    // Memory 事件
    string memory_updated_json = 14;
    string summary_updated_json = 15;
    // Thread 事件
    string thread_created_json = 16;
    // 审批事件
    string approval_required_json = 17;
    string approval_resolved_json = 18;
    // Checkpoint
    string checkpoint_created_json = 19;
  }
}

message SyncBatch {
  string edge_id = 1;
  string conversation_id = 2;
  int64 start_seq = 3;
  int64 end_seq = 4;
  repeated EdgeEvent events = 5;
}

message SyncAck {
  string conversation_id = 1;
  int64 last_ack_seq = 2;
  google.protobuf.Timestamp ack_at = 3;
}

message SyncState {
  string edge_id = 1;
  string conversation_id = 2;
  int64 last_ack_seq = 3;
  int64 total_events = 4;
  bool in_sync = 5;
  google.protobuf.Timestamp last_sync_at = 6;
}

// -- Authority Transfer --
// 参考 architecture.md ConversationAuthority + topology.md

enum TransferStatus {
  TRANSFER_STATUS_UNSPECIFIED = 0;
  TRANSFER_STATUS_REQUESTED = 1;
  TRANSFER_STATUS_ACCEPTED = 2;
  TRANSFER_STATUS_REJECTED = 3;
  TRANSFER_STATUS_COMPLETED = 4;
}

message AuthorityTransferRequest {
  string conversation_id = 1;
  string from_edge_id = 2;
  string to_hub_id = 3;
  string reason = 4;  // "device_lost" | "device_replaced" | "manual"
  string auth_token = 5;
}

message AuthorityTransferResponse {
  TransferStatus status = 1;
  ConversationAuthority new_authority = 2;
  string previous_checkpoint = 3;  // 最后一条消息 ID
  string reject_reason = 4;
}

// -- Hub ↔ Edge 命令 --
message HubToEdgeCommand {
  string command_id = 1;
  google.protobuf.Timestamp sent_at = 2;
  oneof command {
    string run_start_json = 10;       // 远程启动任务
    string run_stop_json = 11;         // 远程停止任务
    string message_deliver_json = 12;  // 云端消息推送
    string memory_sync_request_json = 13;
    string authority_changed_json = 14;
  }
}

message EdgeToHubEvent {
  string edge_id = 1;
  google.protobuf.Timestamp sent_at = 2;
  oneof event {
    string run_status_json = 10;
    string artifact_created_json = 11;
    string preview_ready_json = 12;
    string error_json = 13;
  }
}

// -- Relay (Hub 中继) --
message RelayCommand {
  string relay_id = 1;
  string from_edge_id = 2;
  string to_edge_id = 3;
  bytes ciphertext = 4;  // NaCl box 加密的 payload
  bytes nonce = 5;
  google.protobuf.Timestamp sent_at = 6;
}

// -- Protocol Envelope --
// 参考 protocol.md
message ProtocolEnvelope {
  string version = 1;       // "v1"
  string id = 2;            // request ID
  string trace_id = 3;
  google.protobuf.Timestamp sent_at = 4;
  oneof payload {
    // 注册
    RegisterRequest register = 10;
    RegisterResponse register_response = 11;
    // 心跳
    Heartbeat heartbeat = 12;
    HeartbeatAck heartbeat_ack = 13;
    // 同步
    SyncBatch sync_batch = 20;
    SyncAck sync_ack = 21;
    SyncState sync_state = 22;
    // Authority
    AuthorityTransferRequest transfer_req = 30;
    AuthorityTransferResponse transfer_resp = 31;
    // Edge events
    EdgeEvent edge_event = 40;
    // Commands
    HubToEdgeCommand command = 50;
    EdgeToHubEvent event = 51;
    // Relay
    RelayCommand relay = 60;
  }
}
```

## 5. orchestration.proto

```protobuf
syntax = "proto3";
package agenthub.v1;
import "agenthub/v1/shared.proto";

// -- 调度策略 --
// 参考 cross-analysis-orchestration.md Section 2

enum DispatchStrategyType {
  DISPATCH_STRATEGY_UNSPECIFIED = 0;
  DISPATCH_STRATEGY_DIRECT_MENTION = 1;  // @mention 直接委派
  DISPATCH_STRATEGY_SUPERVISOR = 2;      // Supervisor 自动路由
  DISPATCH_STRATEGY_TEMPLATE = 3;         // YAML 预定义模板
  DISPATCH_STRATEGY_FORK = 4;             // Fork 并行探索
}

message DirectMentionConfig {
  repeated string mentioned_agents = 1;  // 被 @ 的 agent ID 列表
}

message SupervisorConfig {
  int32 recursion_limit = 1;             // LibreChat: MAX_SUBAGENT_DEPTH
  int32 max_same_worker_retries = 2;     // Flowise: maxSameWorkerRetries
  repeated string worker_history = 3;    // 已委派 agent 历史 (防循环)
  int32 time_budget_seconds = 4;         // 时间预算
}

message TemplateConfig {
  string yaml_template_path = 1;         // ChatDev: YAML workflow 路径
  map<string, string> variables = 2;     // 模板变量替换
}

message ForkConfig {
  ForkBranchMode mode = 1;               // 见 im.proto ForkMode 枚举
  repeated string target_agents = 2;     // Fork 目标 agent 列表
  bool compare_results = 3;              // 完成后对比结果
}

// -- Subagent Graph --
// 参考 cross-analysis-orchestration.md Section 3

message SubagentNode {
  string node_id = 1;
  string agent_id = 2;
  string task = 3;
  repeated string depends_on = 4;  // 前驱节点 ID 列表
  map<string, string> config = 5;
}

message SubagentEdge {
  string from = 1;
  string to = 2;
  string condition = 3;  // ChatDev: Edge condition routing
}

message Breadcrumb {
  string agent_id = 1;
  string task = 2;
  google.protobuf.Timestamp delegated_at = 3;
  string parent_agent_id = 4;
}

// -- Delegation Context (防循环) --
// 参考 cross-analysis-orchestration.md 四层防护

message DelegationContext {
  repeated Breadcrumb breadcrumbs = 1;
  repeated string worker_history = 2;   // Supervisor 历史黑名单
  int32 current_depth = 3;
  int32 max_depth = 4;                 // MAX_SUBAGENT_DEPTH
  int32 time_budget_remaining_sec = 5;
  bool recursion_detected = 6;
}

// -- Agent Capability --
// 参考 cross-analysis-adapters.md + flowise Agentflow

enum SandboxLevel {
  SANDBOX_LEVEL_UNSPECIFIED = 0;
  SANDBOX_LEVEL_NONE = 1;
  SANDBOX_LEVEL_WORKTREE = 2;
  SANDBOX_LEVEL_DOCKER = 3;
}

message AgentCapability {
  string agent_id = 1;
  bool read_files = 2;
  bool write_files = 3;
  bool exec_shell = 4;
  SandboxLevel sandbox_level = 5;
  repeated string tools = 6;       // built-in tools
  repeated string mcp_tools = 7;   // MCP 工具 (mcp__<server>__<tool>)
  repeated string skills = 8;      // 加载的 skills
  repeated string sub_agents = 9;  // 可委派的子 agent
  int32 max_subagent_depth = 10;
}

// -- Tool Registry --
// 参考 cross-analysis-sandbox-tools.md + dify ToolManager

enum ToolProviderType {
  TOOL_PROVIDER_UNSPECIFIED = 0;
  TOOL_PROVIDER_BUILTIN = 1;   // 内置工具 (Read/Write/Edit/Bash)
  TOOL_PROVIDER_MCP = 2;       // MCP 工具
  TOOL_PROVIDER_API = 3;       // API 工具
  TOOL_PROVIDER_PLUGIN = 4;    // 插件工具
  TOOL_PROVIDER_COMPOSITE = 5;  // 组合工具
}

message ToolDescriptor {
  string name = 1;
  ToolProviderType provider_type = 2;
  string description = 3;
  string input_schema_json = 4;  // JSON Schema
  bool is_read_only = 5;
  bool is_destructive = 6;
  bool is_concurrency_safe = 7;
  string risk_level = 8;         // "low" | "medium" | "high"
}
```

## 6. approval.proto

```protobuf
syntax = "proto3";
package agenthub.v1;
import "google/protobuf/timestamp.proto";
import "agenthub/v1/shared.proto";

// -- 审批请求 --
// 参考 approvals.md + cross-analysis-sandbox-tools.md

enum RiskLevel {
  RISK_LEVEL_UNSPECIFIED = 0;
  RISK_LEVEL_LOW = 1;     // 自动接受
  RISK_LEVEL_MEDIUM = 2;   // 需要确认
  RISK_LEVEL_HIGH = 3;     // 严格审批
}

enum ApprovalKind {
  APPROVAL_KIND_UNSPECIFIED = 0;
  APPROVAL_KIND_COMMAND = 1;        // Shell 命令
  APPROVAL_KIND_FILE_WRITE = 2;     // 文件写入
  APPROVAL_KIND_FILE_DELETE = 3;    // 文件删除
  APPROVAL_KIND_NETWORK = 4;        // 网络请求
  APPROVAL_KIND_DEPLOY = 5;         // 部署操作
}

message ApprovalRequest {
  string approval_id = 1;
  string run_id = 2;
  string agent_id = 3;
  string conversation_id = 4;
  ApprovalKind kind = 5;
  string tool_name = 6;
  string command = 7;           // 具体命令/操作内容
  RiskLevel risk_level = 8;
  string risk_reason = 9;       // 为什么触发了审批
  int32 timeout_ms = 10;        // 超时时间 (默认 300000ms = 5min)
  google.protobuf.Timestamp created_at = 11;
}

// -- 审批决策 --
enum DecisionType {
  DECISION_TYPE_UNSPECIFIED = 0;
  DECISION_TYPE_ACCEPT = 1;              // 接受本次
  DECISION_TYPE_ACCEPT_FOR_THREAD = 2;   // 本 Thread 内后续自动接受
  DECISION_TYPE_ACCEPT_FOR_SESSION = 3;  // 本 Session 内自动接受
  DECISION_TYPE_DECLINE = 4;             // 拒绝
  DECISION_TYPE_CANCEL = 5;              // 取消 (超时自动)
}

message ApprovalDecision {
  string approval_id = 1;
  DecisionType decision = 2;
  string modified_command = 3;  // 用户修改后的命令 (可选)
  string reason = 4;            // 拒绝/修改的原因
  string user_id = 5;
  google.protobuf.Timestamp decided_at = 6;
}

// -- 策略规则 --
// 参考 approvals.md 的 Policy Engine

enum PolicyAction {
  POLICY_ACTION_UNSPECIFIED = 0;
  POLICY_ACTION_ALLOW = 1;
  POLICY_ACTION_DENY = 2;
  POLICY_ACTION_ASK_USER = 3;
  POLICY_ACTION_ESCALATE = 4;
}

enum PolicySource {
  POLICY_SOURCE_UNSPECIFIED = 0;
  POLICY_SOURCE_BUILTIN = 1;     // 内置默认策略
  POLICY_SOURCE_PROJECT = 2;     // .agenthub/rules.md
  POLICY_SOURCE_AGENT = 3;       // Agent 配置
  POLICY_SOURCE_USER = 4;        // 用户设置
  POLICY_SOURCE_ORG = 5;         // 组织策略 (Hub)
  POLICY_SOURCE_CLI = 6;         // Claude Code settings.json 注入
  POLICY_SOURCE_HOOK = 7;        // PreToolUse hook 脚本
  POLICY_SOURCE_REMOTE = 8;      // Hub 远程策略
}

message PolicyRule {
  string rule_id = 1;
  PolicyAction action = 2;
  PolicySource source = 3;
  int32 priority = 4;           // 数字越小优先级越高 (0 = 最高)
  string tool_pattern = 5;      // glob: "Bash(rm:*)", "Edit(.env)"
  string path_pattern = 6;      // glob: "/etc/**", "**/*.env"
  RiskLevel min_risk_level = 7;  // 触发的最低风险等级
  repeated string agent_ids = 8; // 适用的 agent (空=所有)
  bool enabled = 9;
}

// -- 内置高危模式 --
// DefaultHighRiskPatterns() 对应的 protobuf 表示
message HighRiskPatterns {
  repeated PolicyRule rules = 1;
}
```

## 7. buf.gen.yaml

```yaml
version: v2
managed:
  enabled: true
  override:
    - file_option: go_package_prefix
      value: github.com/agenthub/agenthub/gen/go

plugins:
  # Go
  - remote: buf.build/protocolbuffers/go:v1.37.0
    out: gen/go
    opt:
      - paths=source_relative
  - remote: buf.build/connectrpc/go:v1.19.0
    out: gen/go
    opt:
      - paths=source_relative

  # TypeScript
  - remote: buf.build/bufbuild/es:v2.2.3
    out: gen/ts
    opt:
      - target=ts
  - remote: buf.build/bufbuild/connect-query:v2.0.3
    out: gen/ts
    opt:
      - target=ts
```

## 使用方式

```bash
# 安装 Buf CLI
npm install -g @bufbuild/buf

# Lint
buf lint proto/

# 生成代码
buf generate proto/

# 检查 breaking changes (CI)
buf breaking proto/ --against '.git#branch=main'
```

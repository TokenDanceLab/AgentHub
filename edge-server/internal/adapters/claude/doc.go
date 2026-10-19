// Package claude 收纳 AgentHub 的 Claude Code 适配器家族：legacy NDJSON
// stream-json 适配器 ClaudeCodeAdapter（registry id "claude-code"，DEPRECATED
// 但作为成熟回退与对照保留）与官方 claude-agent-acp ACP 适配器
// ClaudeACPAdapter（registry id "claude-acp"，封装 adapters/acp 子包共享
// ACP 运行时的 AcpAdapter）。
//
// 依赖方向（单向，无环，与 sdk 子包一致）：
//
//	internal/adapters/claude → internal/adapters/acp（共享 ACP 机制
//	AcpAdapter/NewAcpAdapterConfig/DefaultNpxPath）
//	internal/adapters/claude → internal/adapters（ResolveModel、
//	ResolveReasoningEffort、权限处理链 PermissionDecisionBroker/ControlHandler、
//	NDJSON parser NewNDJSONStreamParser、MCP 临时配置 WriteMCPConfigTempFile
//	等仍留在根包）
//	internal/adapters/claude → internal/orchestration（合同类型 SSOT，经
//	aliases.go 引入，模式对齐 adapters/sdk 与 adapters/orchestrator 叶子包）
//	cmd/agenthub-edge、internal/httpserver（组合根与装配点）→
//	internal/adapters/claude
//
// 根 internal/adapters 不 import 本子包：根包对 claude 的唯一引用是
// registry.go 中的字符串适配器 ID（"claude-code" / "claude-acp"），注册由
// 组合根完成，因此方向天然单向。AgentHubAgentSpec fixture 的 cli-json 投影
// 需要构造 ClaudeCodeAdapter，通过 sdk 子包 RegisterClaudeCodeAdapterProvider
// 反向注入（见 fixture_provider.go），避免 sdk import 本包形成环。
package claude

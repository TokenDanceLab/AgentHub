// Package claude 收纳 AgentHub 的 Claude Code 适配器家族：legacy NDJSON
// stream-json 适配器 ClaudeCodeAdapter（registry id "claude-code"，DEPRECATED
// 但作为成熟回退与对照保留）与官方 claude-agent-acp ACP 适配器
// ClaudeACPAdapter（registry id "claude-acp"，封装共享 ACP 运行时的
// AcpAdapter）。
//
// 本包是 #1760「adapters 归组以降低认知负载」的 claude 增量：从根
// internal/adapters 的平铺文件中，把内聚的 claude 家族（claude_code*.go /
// claude_acp*.go / claude_adapter_integration_test.go，以及仅 claude 使用的
// Windows .cmd shim 绕过助手 cli_command.go）下沉为子包。
//
// 依赖方向（单向，无环，与 sdk 子包一致）：
//
//	internal/adapters/claude → internal/adapters（ResolveModel、
//	ResolveReasoningEffort、权限处理链 PermissionDecisionBroker/ControlHandler、
//	NDJSON parser NewNDJSONStreamParser、MCP 临时配置 WriteMCPConfigTempFile、
//	共享 ACP 机制 AcpAdapter/NewAcpAdapterConfig/DefaultNpxPath 等仍留在根包）
//	internal/adapters/claude → internal/orchestration（合同类型 SSOT，经
//	aliases.go 引入，模式对齐 adapters/sdk 与 adapters/orchestrator 叶子包）
//	cmd/agenthub-edge、internal/httpserver（组合根与装配点）→
//	internal/adapters/claude
//
// 根 internal/adapters 不 import 本子包：根包对 claude 的唯一残留引用是
// registry.go 中的字符串适配器 ID（"claude-code" / "claude-acp"），注册由
// 组合根完成，因此方向天然单向。AgentHubAgentSpec fixture 的 cli-json 投影
// 需要构造 ClaudeCodeAdapter，通过根包 RegisterClaudeCodeAdapterProvider
// 反向注入（见 fixture_provider.go），避免根包 import 本包形成环。
package claude

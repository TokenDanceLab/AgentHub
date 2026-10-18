// Package acp 收纳 AgentHub 的 ACP（Agent Client Protocol）适配器家族：
// 实验性通用 AcpAdapter（registry id "acp"，JSON-RPC 2.0 over stdio）与
// coder/acp-go-sdk（v0.13.5）客户端运行时（acp_client.go）、纯 ACP→Edge
// 事件映射（acp_events.go）及对应测试。codex-acp / claude-acp / opencode-acp
// 三个子包适配器以嵌入本包 AcpAdapter 的方式复用该运行时。
//
// 依赖方向（单向，无环，与 sdk/claude 子包一致）：
//
//	internal/adapters/acp → internal/adapters（PermissionDecisionBroker、
//	PermissionScope、PermissionRequest、PermissionDecision、
//	ClassifyToolRisk、NormalizePermissionDecision 等权限处理链仍留在根包）
//	internal/adapters/acp → internal/orchestration（合同类型与 BusEvent*
//	常量 SSOT，经 aliases.go 引入，模式对齐 adapters/sdk 与
//	adapters/orchestrator 叶子包）
//	internal/adapters/claude、codex、opencode → internal/adapters/acp
//	（三个子包嵌入 AcpAdapter，经 acp.AcpAdapter/acp.NewAcpAdapterConfig/
//	acp.DefaultNpxPath 限定引用）
//
// 根 internal/adapters 不 import 本子包：根包对 ACP 的唯一引用是
// registry.go 中的字符串适配器 ID（"acp" / "codex-acp" / "claude-acp" /
// "opencode-acp"），注册由组合根完成，因此方向天然单向。
package acp

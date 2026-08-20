// Package codex 收纳 AgentHub 的官方 Codex ACP 适配器 CodexACPadapter
// （registry id "codex-acp"）：以 `npx -y @agentclientprotocol/codex-acp`
// 启动官方 ACP 适配器二进制，封装根包共享 ACP 运行时 AcpAdapter。
//
// 本包是 #1760「adapters 归组以降低认知负载」的 codex/opencode 增量：从根
// internal/adapters 的平铺文件中，把 codex-acp 适配器（codex_acp.go 及其
// 测试）下沉为子包。
//
// 依赖方向（单向，无环，与 sdk/claude 子包一致）：
//
//	internal/adapters/codex → internal/adapters（共享 ACP 机制
//	AcpAdapter/NewAcpAdapterConfig/DefaultNpxPath 与 AgentAdapter 合同仍留在
//	根包）
//	internal/adapters/codex → internal/orchestration（合同类型 SSOT，经
//	aliases.go 引入，模式对齐 adapters/sdk、adapters/claude 与
//	adapters/orchestrator 叶子包）
//	cmd/agenthub-edge、internal/httpserver（组合根与装配点）→
//	internal/adapters/codex
//
// 根 internal/adapters 不 import 本子包：根包对 codex 的唯一残留引用是
// registry.go 中的字符串适配器 ID（"codex-acp"），注册由组合根完成，因此
// 方向天然单向。AgentHubAgentSpec fixture 的 cli-json 投影需要构造
// CodexACPadapter，通过根包 RegisterCodexACPadapterProvider 反向注入（见
// fixture_provider.go），避免根包 import 本包形成环。
package codex

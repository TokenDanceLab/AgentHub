// Package sdk 收纳 AgentHub 的直连 HTTP「SDK 适配器」（anthropic-sdk 与
// openai-sdk）：不经过 CLI 子进程，BuildCommand 返回哨兵命令，ParseStream
// 直接发起对提供商 API 的流式 HTTP 调用并映射为 Edge 事件。
//
// 本包是 #1760「adapters 归组以降低认知负载」的首个安全增量：从根
// internal/adapters 的 80+ 个平铺文件中，把内聚的 SDK 适配器集合
// （anthropic_sdk*.go / openai_sdk*.go / sdk_common*.go 及其测试）
// 下沉为子包。
//
// 依赖方向（单向，无环）：
//
//	internal/adapters/sdk → internal/adapters（ResolveModel、CtxRunContext、
//	NewNonRecoverableParseError 等仍留在根包的助手）
//	internal/adapters/sdk → internal/orchestration（合同类型 SSOT，经
//	aliases.go 引入，模式对齐 adapters/orchestrator 叶子包）
//	cmd/agenthub-edge（组合根）→ internal/adapters/sdk
//
// 根 internal/adapters 不 import 本子包：根包对 SDK 适配器的唯一残留引用
// 是 registry.go 中的字符串适配器 ID（"anthropic-sdk" / "openai-sdk"），
// 注册由组合根完成，因此方向天然单向。
//
// 仍留在根包、暂未归组的 sdk_fixture_mapper*.go 与根包存在双向耦合
// （mapper 使用根包 BusEvent* 常量；根包 agentspec_fixture.go 构造
// SDKFixture* 类型并调用其它适配器构造函数），强行下沉会形成 import
// cycle，留待后续增量解耦。
package sdk

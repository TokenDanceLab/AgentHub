// AgentHubAgentSpec fixture 投影的 claude-code 构造器注入（#1760 claude 增量）。
//
// sdk 子包（agentspec_fixture.go，随 #1760 mapper 增量归组）的
// CompileAgentSpecV1ToRuntimeInvocationFixture 在 runtimeID "claude-code"
// 时需要构造 ClaudeCodeAdapter 以投影 redacted CLI invocation plan。但 sdk
// 不得 import 本包（claude → adapters/sdk 为单向依赖），因此本包在 init 时
// 经 sdk.RegisterClaudeCodeAdapterProvider 反向注入构造器。
package claude

import (
	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/adapters/sdk"
)

func init() {
	sdk.RegisterClaudeCodeAdapterProvider(func(model string) adapters.AgentAdapter {
		return NewClaudeCodeAdapter("claude", model, "")
	})
}

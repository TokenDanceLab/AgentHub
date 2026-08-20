// AgentHubAgentSpec fixture 投影的 claude-code 构造器注入（#1760 claude 增量）。
//
// 根包 internal/adapters 的 CompileAgentSpecV1ToRuntimeInvocationFixture 在
// runtimeID "claude-code" 时需要构造 ClaudeCodeAdapter 以投影 redacted CLI
// invocation plan。但根包不得 import 本包（claude → adapters 为单向依赖，
// 与 sdk 子包一致），否则形成 import cycle；因此本包在 init 时经根包
// RegisterClaudeCodeAdapterProvider 反向注入构造器。
package claude

import (
	"github.com/agenthub/edge-server/internal/adapters"
)

func init() {
	adapters.RegisterClaudeCodeAdapterProvider(func(model string) adapters.AgentAdapter {
		return NewClaudeCodeAdapter("claude", model, "")
	})
}

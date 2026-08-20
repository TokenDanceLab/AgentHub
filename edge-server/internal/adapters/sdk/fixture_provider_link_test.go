package sdk_test

// Blank-import link for the codex/opencode fixture providers（#1760
// codex/opencode 增量，随 #1760 mapper 增量迁入 sdk 包测试）。sdk 包 unit
// test（sdk_fixture_mapper_test.go 等以 "codex"/"opencode" runtime 投影 CLI
// invocation plan 的测试）需要子包构造器可用；sdk 内部测试文件（package
// sdk）不得 import 子包（子包 → adapters/sdk 为单向依赖，否则 import cycle
// not allowed in test），故以外部测试包（package sdk_test）blank import 两
// 个子包，其 init 在同一测试二进制内经 sdk.RegisterCodexACPadapterProvider /
// sdk.RegisterOpencodeACPadapterProvider 反向注入构造器。
import (
	_ "github.com/agenthub/edge-server/internal/adapters/codex"
	_ "github.com/agenthub/edge-server/internal/adapters/opencode"
)

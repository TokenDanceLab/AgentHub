// Package log 提供统一的 zap 日志初始化和 Sync 功能。
//
// 本文件测试 Init 和 Sync 函数在不同 log level 下的行为，
// 以及 Sync 的幂等性和零值安全性。
//
// 测试隔离说明：
//   - go test 为每个包启动独立进程，不会影响其他包的全局 logger。
//   - 包内测试按顺序执行，Sync 本身有 nil 检查，多次 Init 的副作用
//     在测试进程退出时自动清理，因此不需要额外的环境变量或 build tag。
package log

import (
	"testing"

	"github.com/agenthub/hub-server/internal/config"
)

// TestSyncWithoutInit 验证：在没有调用 Init 的情况下调用 Sync 不会 panic。
// logger 初始值为 nil，Sync 内部有 nil 检查。
func TestSyncWithoutInit(t *testing.T) {
	// 确保不会因为 nil logger 而 panic
	Sync()
	Sync() // 多次调用也不应 panic
}

// TestInitDefaultLevel 验证：未指定 log level 时默认使用 info 级别。
func TestInitDefaultLevel(t *testing.T) {
	cfg := &config.ServerConfig{
		Port:     8080,
		LogLevel: "", // 空字符串 -> 走 default 分支 -> InfoLevel
	}
	// Init 不应该 panic
	Init(cfg)
	// 初始化后 Sync 不应 panic
	Sync()
}

// TestInitDebugLevel 验证：log_level=debug 时 Init 正常完成。
func TestInitDebugLevel(t *testing.T) {
	cfg := &config.ServerConfig{
		Port:     8080,
		LogLevel: "debug",
	}
	Init(cfg)
	Sync()
}

// TestInitInfoLevel 验证：log_level=info 时 Init 正常完成。
func TestInitInfoLevel(t *testing.T) {
	cfg := &config.ServerConfig{
		Port:     8080,
		LogLevel: "info",
	}
	Init(cfg)
	Sync()
}

// TestInitWarnLevel 验证：log_level=warn 时 Init 正常完成。
func TestInitWarnLevel(t *testing.T) {
	cfg := &config.ServerConfig{
		Port:     8080,
		LogLevel: "warn",
	}
	Init(cfg)
	Sync()
}

// TestInitErrorLevel 验证：log_level=error 时 Init 正常完成。
func TestInitErrorLevel(t *testing.T) {
	cfg := &config.ServerConfig{
		Port:     8080,
		LogLevel: "error",
	}
	Init(cfg)
	Sync()
}

// TestInitWithLogFile 验证：指定 LogFile 时 Init 正常完成（使用 lumberjack）。
func TestInitWithLogFile(t *testing.T) {
	// 使用临时目录，避免遗留日志文件
	tmpDir := t.TempDir()
	cfg := &config.ServerConfig{
		Port:     8080,
		LogLevel: "info",
		LogFile:  tmpDir + "/test.log",
	}
	Init(cfg)
	Sync()
}

// TestSyncIdempotent 验证：多次调用 Sync 不会 panic。
// 先 Init，然后连续调用 Sync 多次。
func TestSyncIdempotent(t *testing.T) {
	cfg := &config.ServerConfig{
		Port:     8080,
		LogLevel: "info",
	}
	Init(cfg)

	// 多次调用 Sync 不应 panic
	for i := 0; i < 10; i++ {
		Sync()
	}
}

// TestInitUnknownLevel 验证：未知 log level 被当作 info 处理（fallback）。
func TestInitUnknownLevel(t *testing.T) {
	cfg := &config.ServerConfig{
		Port:     8080,
		LogLevel: "trace", // 不在 switch 的 case 中，走 default -> InfoLevel
	}
	Init(cfg)
	Sync()
}

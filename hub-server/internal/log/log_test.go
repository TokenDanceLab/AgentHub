// Package log 提供统一的 zap 日志初始化和 Sync 功能。
//
// 本文件是包内测试（package log），因此可以直接读私有全局 logger 与
// requestIDHandler，把 Init 的接线结果断言出来，而不是只调一次看它不 panic。
//
// 测试隔离说明：
//   - go test 为每个包启动独立进程，不会影响其他包的全局 logger。
//   - Init 会覆盖包全局 logger 并调用 slog.SetDefault，所以本文件的测试
//     之间是顺序依赖的：TestSyncWithoutInit 依赖「还没有人调用过 Init」，
//     必须保持在本文件（也是本包）第一个。同包的 log_request_id_test.go
//     只构造自己的 slog.Logger，不碰全局，因此不破坏这个前提。
package log

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/pkg/reqlog"
)

// TestSyncWithoutInit 验证 nil logger 时 Sync 的守卫：部分接线的构建
// （单测二进制、只 import 不调 Init 的工具）在关闭时不能崩。
//
// 这里唯一能断言的就是前置条件本身 —— 如果哪天有别的测试先调了 Init，
// 本测试会明确失败，而不是悄悄变成一次无意义的 Sync。
func TestSyncWithoutInit(t *testing.T) {
	if logger != nil {
		t.Fatalf("前置条件被破坏：包全局 logger = %v，want nil（本测试必须跑在任何 Init 之前）", logger)
	}

	Sync()
	Sync() // 幂等：第二次也不应 panic
}

// TestInitLevelFallback 验证 LogLevel 到 zapcore.Level 的映射，包括未知值与
// 空值回落到 info。旧版本这里只调 Init + Sync，注释声称"验证未知 level 被
// 当作 info 处理"却从不检查 level —— 现在直接问 core。
func TestInitLevelFallback(t *testing.T) {
	cases := []struct {
		cfgLevel string
		debug    bool
		info     bool
		warn     bool
		errLvl   bool
	}{
		{cfgLevel: "debug", debug: true, info: true, warn: true, errLvl: true},
		{cfgLevel: "info", debug: false, info: true, warn: true, errLvl: true},
		{cfgLevel: "warn", debug: false, info: false, warn: true, errLvl: true},
		{cfgLevel: "error", debug: false, info: false, warn: false, errLvl: true},
		// 未知值走 switch default -> InfoLevel
		{cfgLevel: "trace", debug: false, info: true, warn: true, errLvl: true},
		{cfgLevel: "verbose", debug: false, info: true, warn: true, errLvl: true},
		// 未设置同样是 info
		{cfgLevel: "", debug: false, info: true, warn: true, errLvl: true},
		// switch 是大小写敏感的，"INFO" 也落到 default -> info
		{cfgLevel: "INFO", debug: false, info: true, warn: true, errLvl: true},
	}

	for _, tc := range cases {
		Init(&config.ServerConfig{Port: 8080, LogLevel: tc.cfgLevel})

		core := logger.Core()
		if got := core.Enabled(zapcore.DebugLevel); got != tc.debug {
			t.Errorf("LogLevel=%q: Debug enabled = %v, want %v", tc.cfgLevel, got, tc.debug)
		}
		if got := core.Enabled(zapcore.InfoLevel); got != tc.info {
			t.Errorf("LogLevel=%q: Info enabled = %v, want %v", tc.cfgLevel, got, tc.info)
		}
		if got := core.Enabled(zapcore.WarnLevel); got != tc.warn {
			t.Errorf("LogLevel=%q: Warn enabled = %v, want %v", tc.cfgLevel, got, tc.warn)
		}
		if got := core.Enabled(zapcore.ErrorLevel); got != tc.errLvl {
			t.Errorf("LogLevel=%q: Error enabled = %v, want %v", tc.cfgLevel, got, tc.errLvl)
		}
	}
}

// TestInitWithLogFile 验证 LogFile 分支真的把日志写进 lumberjack 文件，
// 并且用的是 JSON encoder + ISO8601 的 "time" 键。旧版本只调 Init + Sync，
// 从不检查文件是否产生 —— LogFile 这条分支等于完全没有覆盖。
func TestInitWithLogFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.log")
	Init(&config.ServerConfig{Port: 8080, LogLevel: "info", LogFile: path})

	logger.Info("hello-logfile", zap.String("k", "v"))
	Sync()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读取日志文件 %s: %v", path, err)
	}
	out := string(data)
	if !strings.Contains(out, "hello-logfile") {
		t.Errorf("日志文件缺少写入的记录，内容 = %q", out)
	}
	if !strings.Contains(out, `"time":"`) {
		t.Errorf("日志文件缺少 ISO8601 的 \"time\" 键，内容 = %q", out)
	}
	if !strings.Contains(out, `"k":"v"`) {
		t.Errorf("日志文件缺少字段 k=v，内容 = %q", out)
	}
}

// TestInitInstallsRequestIDSlogDefault 验证 Init 的最后一段接线：slog 默认
// handler 是包内的 requestIDHandler 装饰器，并且带着 request_id 的 ctx 走完
// 「reqlog -> 装饰器 -> zapslog -> zap core -> 文件」这条链后，request_id 真的
// 落在记录里。装饰器本身的单元行为在 log_request_id_test.go 里，这里测的是
// Init 有没有把它装上。
func TestInitInstallsRequestIDSlogDefault(t *testing.T) {
	path := filepath.Join(t.TempDir(), "slog.log")
	Init(&config.ServerConfig{Port: 8080, LogLevel: "info", LogFile: path})

	if _, ok := slog.Default().Handler().(*requestIDHandler); !ok {
		t.Fatalf("slog.Default().Handler() = %T, want *requestIDHandler", slog.Default().Handler())
	}

	ctx := reqlog.WithRequestID(context.Background(), "rid-e2e-1")
	slog.InfoContext(ctx, "service layer event")
	slog.Info("background event without request id")
	Sync()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读取日志文件 %s: %v", path, err)
	}
	out := string(data)
	if !strings.Contains(out, `"request_id":"rid-e2e-1"`) {
		t.Errorf("带 request_id 的记录没有落到文件里，内容 = %q", out)
	}

	// 没有 request_id 的 ctx 不应被塞进空值键。
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if strings.Contains(line, "background event without request id") &&
			strings.Contains(line, requestIDAttrKey) {
			t.Errorf("无 request_id 的记录不应带 %s 键: %q", requestIDAttrKey, line)
		}
	}
}

// TestSyncIdempotent 验证 Init 之后连续 Sync 不 panic、不重复关闭底层 writer。
func TestSyncIdempotent(t *testing.T) {
	Init(&config.ServerConfig{Port: 8080, LogLevel: "info"})

	before := logger
	for i := 0; i < 10; i++ {
		Sync()
	}
	if logger != before {
		t.Error("Sync 改变了包全局 logger，它只应该 flush")
	}

	// Sync 之后 logger 仍然可用（lumberjack 的 Sync 不关闭文件）。
	logger.Info("after-sync")
	Sync()
}

// Hub Server — AgentHub 中心控制面和协作层
//
// 职责：账号/登录、群聊/Conversation、多端同步、Edge 注册/心跳、远程控制/中继
// API 契约见 ../../api/openapi.yaml HubSyncRelay 标签
package main

import (
	"flag"
	"log/slog"
	"os"

	"github.com/agenthub/hub-server/internal/httpserver"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:4210", "listen address")
	jwtSecret := flag.String("jwt-secret", "", "JWT secret for auth token validation")
	flag.Parse()

	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	slog.Info("hub server starting", "addr", *addr)

	if err := httpserver.Run(httpserver.Config{
		Addr:      *addr,
		JWTSecret: *jwtSecret,
	}); err != nil {
		slog.Error("hub server exited", "err", err)
		os.Exit(1)
	}
}

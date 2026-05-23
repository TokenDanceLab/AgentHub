package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/agenthub/hub-server/internal/app"
	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/repository"
)

func main() {
	cfg, err := config.Load("configs/config.yaml")
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	if err := repository.InitDB(&cfg.DB); err != nil {
		slog.Error("failed to init database", "error", err)
		os.Exit(1)
	}

	if err := repository.RunMigrations(&cfg.DB); err != nil {
		slog.Error("failed to run migrations", "error", err)
		os.Exit(1)
	}

	if err := cache.InitRedis(&cfg.Redis); err != nil {
		slog.Error("failed to init redis", "error", err)
		os.Exit(1)
	}
	cacheClient := cache.NewClient(cache.RDB)

	application := app.New(cfg, repository.DB, cacheClient)
	if err := application.Run(context.Background()); err != nil {
		slog.Error("application exited with error", "error", err)
		os.Exit(1)
	}
}

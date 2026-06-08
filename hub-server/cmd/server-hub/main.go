package main

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/agenthub/hub-server/internal/app"
	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/repository"
)

func main() {
	if err := normalizeWorkingDirectory(); err != nil {
		slog.Error("failed to normalize working directory", "error", err)
		os.Exit(1)
	}

	cfg, err := config.Load("configs/config.yaml")
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	if err := cfg.Validate(); err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}

	db, err := repository.InitDB(&cfg.DB)
	if err != nil {
		slog.Error("failed to init database", "error", err)
		os.Exit(1)
	}

	if err := repository.RunMigrations(&cfg.DB); err != nil {
		slog.Error("failed to run migrations", "error", err)
		os.Exit(1)
	}

	rdb, err := cache.InitRedis(&cfg.Redis)
	if err != nil {
		slog.Error("failed to init redis", "error", err)
		os.Exit(1)
	}
	cacheClient := cache.NewClient(rdb)

	application := app.New(cfg, db, cacheClient)
	if err := application.Run(context.Background()); err != nil {
		slog.Error("application exited with error", "error", err)
		os.Exit(1)
	}
}

func normalizeWorkingDirectory() error {
	cwd, err := os.Getwd()
	if err != nil {
		return err
	}

	if hasHubServerLayout(cwd) {
		return nil
	}

	hubServerDir := filepath.Join(cwd, "hub-server")
	if hasHubServerLayout(hubServerDir) {
		return os.Chdir(hubServerDir)
	}

	return nil
}

func hasHubServerLayout(dir string) bool {
	if _, err := os.Stat(filepath.Join(dir, "configs", "config.yaml")); err != nil {
		return false
	}

	info, err := os.Stat(filepath.Join(dir, "migrations"))
	return err == nil && info.IsDir()
}

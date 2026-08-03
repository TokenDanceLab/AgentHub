package main

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

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

	// Auto-load .env file if present so developers don't need to `source .env`
	// before running the binary. This is a convenience for local dev; production
	// deployments set env vars through the container orchestrator.
	loadDotEnv(".env")

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

// loadDotEnv reads a .env file and exports its key=value pairs into the
// process environment. Existing env vars are NOT overwritten so that
// explicit `export AGENTHUB_*` always wins. Lines starting with '#' and
// blank lines are ignored.
func loadDotEnv(path string) {
	// #nosec G304 -- path is a fixed operator config path (".env"), not request input
	data, err := os.ReadFile(path)
	if err != nil {
		return // .env is optional; silently skip if missing
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		// Strip surrounding quotes if present.
		if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[len(value)-1] == value[0] {
			value = value[1 : len(value)-1]
		}
		// Do not overwrite an already-set env var.
		if os.Getenv(key) != "" {
			continue
		}
		if err := os.Setenv(key, value); err != nil {
			slog.Warn("failed to set env var from .env", "key", key, "error", err)
		}
	}
}

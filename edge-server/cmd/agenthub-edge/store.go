package main

import (
	"encoding/json"
	"fmt"
	"io"

	"github.com/agenthub/edge-server/internal/store"
)

func runStoreReadiness(cfg config, out io.Writer) error {
	if cfg.StoreBackend != "sqlite" || cfg.StoreDB == "" {
		return fmt.Errorf("--store-readiness requires --store-backend sqlite and --store-db")
	}
	report, err := store.SQLiteReadiness(cfg.StoreDB)
	if err != nil {
		return err
	}
	manifest := report.Manifest()
	encoder := json.NewEncoder(out)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(manifest); err != nil {
		return err
	}
	if manifest.Status != "ready" {
		return fmt.Errorf("sqlite store readiness blocked: status=%s migration_status=%s", manifest.Status, manifest.MigrationStatus)
	}
	return nil
}

func newStoreFromConfig(cfg config) (store.Repository, error) {
	switch cfg.StoreBackend {
	case "sqlite":
		repository, err := store.NewSQLite(cfg.StoreDB)
		if err != nil {
			return nil, fmt.Errorf("open sqlite store %q: %w", cfg.StoreDB, err)
		}
		return repository, nil
	case "memory":
		return store.New(), nil
	case "file":
		if cfg.StoreFile == "" {
			return nil, fmt.Errorf("--store-backend file requires --store-file")
		}
		repository, err := store.NewFile(cfg.StoreFile)
		if err != nil {
			return nil, fmt.Errorf("open store file %q: %w", cfg.StoreFile, err)
		}
		return repository, nil
	case "":
		if cfg.StoreFile == "" {
			return store.New(), nil
		}
		repository, err := store.NewFile(cfg.StoreFile)
		if err != nil {
			return nil, fmt.Errorf("open store file %q: %w", cfg.StoreFile, err)
		}
		return repository, nil
	default:
		return nil, fmt.Errorf("unknown store backend %q", cfg.StoreBackend)
	}
}

// resolveSDKAPIKey resolves the API key for an SDK adapter. If the value is
// "env" or empty, it reads from the specified environment variable. Otherwise

package repository

import (
	"fmt"
	"log/slog"
	"net/url"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"

	"github.com/agenthub/server-hub/internal/config"
)

func RunMigrations(cfg *config.DBConfig) error {
	password := url.QueryEscape(cfg.Password)
	pgURL := fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable",
		cfg.User, password, cfg.Host, cfg.Port, cfg.Name)

	m, err := migrate.New("file://migrations", pgURL)
	if err != nil {
		return fmt.Errorf("failed to create migrate instance: %w", err)
	}
	defer m.Close()

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("failed to run migrations: %w", err)
	}

	slog.Info("migrations applied")
	return nil
}

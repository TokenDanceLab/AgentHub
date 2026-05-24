package repository

import (
	"fmt"
	"log/slog"
	"net/url"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"

	"github.com/agenthub/hub-server/internal/config"
)

func RunMigrations(cfg *config.DBConfig) error {
	return runMigrations(cfg, "file://migrations")
}

func RunMigrationsFrom(cfg *config.DBConfig, sourceURL string) error {
	return runMigrations(cfg, sourceURL)
}

// VerifyMigrations checks whether all database migrations are applied without
// running any new ones. Returns the current migration version or an error if
// there are pending migrations.
func VerifyMigrations(cfg *config.DBConfig) (version uint, dirty bool, err error) {
	password := url.QueryEscape(cfg.Password)
	pgURL := fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable",
		cfg.User, password, cfg.Host, cfg.Port, cfg.Name)

	m, err := migrate.New("file://migrations", pgURL)
	if err != nil {
		return 0, false, fmt.Errorf("failed to create migrate instance: %w", err)
	}
	defer m.Close()

	v, d, err := m.Version()
	if err == migrate.ErrNilVersion {
		return 0, false, fmt.Errorf("no migrations applied; run migrations first")
	}
	return v, d, err
}

func runMigrations(cfg *config.DBConfig, sourceURL string) error {
	password := url.QueryEscape(cfg.Password)
	pgURL := fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable",
		cfg.User, password, cfg.Host, cfg.Port, cfg.Name)

	m, err := migrate.New(sourceURL, pgURL)
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

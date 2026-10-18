package repository

import (
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"strconv"

	"github.com/golang-migrate/migrate/v4"
	// Register golang-migrate postgres, file, and embedded-FS drivers.
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/golang-migrate/migrate/v4/source/iofs"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/migrations"
)

// postgresURL builds the golang-migrate database URL without embedding a
// credential-shaped literal in the source.
func postgresURL(cfg *config.DBConfig) string {
	u := &url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(cfg.User, cfg.Password),
		Host:   net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port)),
		Path:   "/" + cfg.Name,
	}
	query := u.Query()
	query.Set("sslmode", cfg.SSLMode)
	u.RawQuery = query.Encode()
	return u.String()
}

func RunMigrations(cfg *config.DBConfig) error {
	pgURL := postgresURL(cfg)
	source, err := iofs.New(migrations.FS, ".")
	if err != nil {
		return fmt.Errorf("failed to load embedded migrations: %w", err)
	}
	m, err := migrate.NewWithSourceInstance("iofs", source, pgURL)
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

func RunMigrationsFrom(cfg *config.DBConfig, sourceURL string) error {
	return runMigrations(cfg, sourceURL)
}

// VerifyMigrations checks whether all database migrations are applied without
// running any new ones. Returns the current migration version or an error if
// there are pending migrations.
func VerifyMigrations(cfg *config.DBConfig) (version uint, dirty bool, err error) {
	pgURL := postgresURL(cfg)

	source, err := iofs.New(migrations.FS, ".")
	if err != nil {
		return 0, false, fmt.Errorf("failed to load embedded migrations: %w", err)
	}
	m, err := migrate.NewWithSourceInstance("iofs", source, pgURL)
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
	pgURL := postgresURL(cfg)

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

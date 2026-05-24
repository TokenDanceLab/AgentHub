package repository

import (
	"fmt"
	"log/slog"
	"time"

<<<<<<< HEAD
	"github.com/agenthub/server-hub/internal/config"
=======
	"github.com/agenthub/hub-server/internal/config"
>>>>>>> origin/master
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

<<<<<<< HEAD
var DB *gorm.DB

func InitDB(cfg *config.DBConfig) error {
=======
func InitDB(cfg *config.DBConfig) (*gorm.DB, error) {
>>>>>>> origin/master
	gormLog := gormlogger.New(
		slog.NewLogLogger(slog.Default().Handler(), slog.LevelInfo),
		gormlogger.Config{
			SlowThreshold:             200 * time.Millisecond,
			LogLevel:                  gormlogger.Warn,
			IgnoreRecordNotFoundError: true,
			Colorful:                  false,
		},
	)

	db, err := gorm.Open(postgres.Open(cfg.DSN()), &gorm.Config{
		Logger:                 gormLog,
		SkipDefaultTransaction: true,
		PrepareStmt:            true,
	})
	if err != nil {
<<<<<<< HEAD
		return fmt.Errorf("failed to connect database: %w", err)
=======
		return nil, fmt.Errorf("failed to connect database: %w", err)
>>>>>>> origin/master
	}

	sqlDB, err := db.DB()
	if err != nil {
<<<<<<< HEAD
		return fmt.Errorf("failed to get underlying sql.DB: %w", err)
=======
		return nil, fmt.Errorf("failed to get underlying sql.DB: %w", err)
>>>>>>> origin/master
	}

	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetMaxOpenConns(100)
	sqlDB.SetConnMaxLifetime(time.Hour)

	if err := sqlDB.Ping(); err != nil {
<<<<<<< HEAD
		return fmt.Errorf("failed to ping database: %w", err)
	}

	DB = db
	slog.Info("database connected", "host", cfg.Host, "port", cfg.Port, "name", cfg.Name)
	return nil
=======
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	slog.Info("database connected", "host", cfg.Host, "port", cfg.Port, "name", cfg.Name)
	return db, nil
>>>>>>> origin/master
}

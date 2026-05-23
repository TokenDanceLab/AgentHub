package cache

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/agenthub/server-hub/internal/config"
	"github.com/redis/go-redis/v9"
)

var RDB *redis.Client

func InitRedis(cfg *config.RedisConfig) error {
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.Addr(),
		Password: cfg.Password,
		DB:       cfg.DB,
		PoolSize: 10,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("failed to ping redis: %w", err)
	}

	RDB = rdb
	slog.Info("redis connected", "addr", cfg.Addr())
	return nil
}

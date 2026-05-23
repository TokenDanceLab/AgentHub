package cache

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/redis/go-redis/v9"
)

func InitRedis(cfg *config.RedisConfig) (*redis.Client, error) {
	poolSize := cfg.PoolSize
	if poolSize == 0 {
		poolSize = 100
	}
	minIdleConns := cfg.MinIdleConns
	if minIdleConns == 0 {
		minIdleConns = 10
	}

	rdb := redis.NewClient(&redis.Options{
		Addr:            cfg.Addr(),
		Password:        cfg.Password,
		DB:              cfg.DB,
		PoolSize:        poolSize,
		MinIdleConns:    minIdleConns,
		MaxRetries:      3,
		DialTimeout:     2 * time.Second,
		ReadTimeout:     1 * time.Second,
		WriteTimeout:    1 * time.Second,
		PoolTimeout:     4 * time.Second,
		ConnMaxIdleTime: 10 * time.Minute,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to ping redis: %w", err)
	}

	slog.Info("redis connected", "addr", cfg.Addr())
	return rdb, nil
}

package serviceconfig

import (
	"errors"
	"os"
	"strings"
	"time"
)

type Options struct {
	ServiceName string
	EnvPrefix   string
	DefaultAddr string
}

type Config struct {
	Name              string
	Addr              string
	ReadHeaderTimeout time.Duration
}

func FromEnv(opts Options) (Config, error) {
	if strings.TrimSpace(opts.ServiceName) == "" {
		return Config{}, errors.New("service name is required")
	}
	if strings.TrimSpace(opts.EnvPrefix) == "" {
		return Config{}, errors.New("environment prefix is required")
	}
	if strings.TrimSpace(opts.DefaultAddr) == "" {
		return Config{}, errors.New("default address is required")
	}

	cfg := Config{
		Name:              opts.ServiceName,
		Addr:              opts.DefaultAddr,
		ReadHeaderTimeout: 5 * time.Second,
	}

	if addr := strings.TrimSpace(os.Getenv(opts.EnvPrefix + "_ADDR")); addr != "" {
		cfg.Addr = addr
	}

	if raw := strings.TrimSpace(os.Getenv(opts.EnvPrefix + "_READ_HEADER_TIMEOUT")); raw != "" {
		timeout, err := time.ParseDuration(raw)
		if err != nil {
			return Config{}, err
		}
		cfg.ReadHeaderTimeout = timeout
	}

	return cfg, nil
}

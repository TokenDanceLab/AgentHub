package main

import (
	"fmt"
	"os"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/jwtutil"
)

func main() {
	cfg, err := config.Load("configs/config.yaml")
	if err != nil {
		fmt.Fprintf(os.Stderr, "config load error: %v\n", err)
		os.Exit(1)
	}

	// Print the JWT secret length (not the secret itself for safety)
	fmt.Printf("JWT Secret length: %d\n", len(cfg.JWT.Secret))
	fmt.Printf("JWT Secret first 10 chars: %s...\n", cfg.JWT.Secret[:min(10, len(cfg.JWT.Secret))])

	uidA := "aaeb6975-d2a1-440b-980d-60240e0e00ac"
	uidB := "d32cabc0-e367-41ff-a0e4-1eaf62eb5224"

	tokenA, err := jwtutil.GenerateAccessToken(uidA, "desktop", "dev-a1", cfg.JWT.Secret, 24*time.Hour)
	if err != nil {
		fmt.Fprintf(os.Stderr, "token A error: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("TOKEN_A=" + tokenA)

	tokenB, err := jwtutil.GenerateAccessToken(uidB, "desktop", "dev-b1", cfg.JWT.Secret, 24*time.Hour)
	if err != nil {
		fmt.Fprintf(os.Stderr, "token B error: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("TOKEN_B=" + tokenB)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

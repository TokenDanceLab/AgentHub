package main

import (
	"fmt"
	"os"
)

func main() {
	secret := os.Getenv("AGENTHUB_JWT_SECRET")
	if secret == "" {
		fmt.Println("AGENTHUB_JWT_SECRET is not set in current environment")
	} else {
		fmt.Printf("AGENTHUB_JWT_SECRET is set, length=%d, first10=%s\n", len(secret), secret[:min(10, len(secret))])
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

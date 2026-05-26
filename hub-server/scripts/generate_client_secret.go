// generate_client_secret.go — Utility to generate an OAuth 2.0 client secret and its bcrypt hash.
//
// Usage:
//
//	go run scripts/generate_client_secret.go [secret_length]
//
// Output:
//
//	Plain: cs_...
//	Hash:  $2a$10$...
//
// The plaintext secret goes into AGENTHUB_TOKENDANCE_CLIENT_SECRET in .env.
// The bcrypt hash goes into the TokenDance ID oauth_clients table (secret_hash column).
package main

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"strconv"

	"golang.org/x/crypto/bcrypt"
)

func main() {
	secretLen := 32
	if len(os.Args) > 1 {
		if n, err := strconv.Atoi(os.Args[1]); err == nil && n > 0 {
			secretLen = n
		}
	}

	plain := "cs_" + randomStr(secretLen)
	hash, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: failed to hash secret: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("Plain:", plain)
	fmt.Println("Hash: ", string(hash))
	fmt.Println()
	fmt.Println("# AGENTHUB_TOKENDANCE_CLIENT_SECRET=" + plain)
}

func randomStr(n int) string {
	b := make([]byte, n*2)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)[:n]
}

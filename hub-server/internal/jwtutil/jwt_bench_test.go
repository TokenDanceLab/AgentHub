package jwtutil

import (
	"testing"
	"time"
)

func BenchmarkGenerateAccessToken(b *testing.B) {
	const secret = "bench-test-secret-with-minimum-32-chars!!"
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = GenerateAccessToken("user-1", "desktop", "dev-1", secret, 15*time.Minute)
	}
}

func BenchmarkParseToken(b *testing.B) {
	const secret = "bench-test-secret-with-minimum-32-chars!!"
	token, err := GenerateAccessToken("user-1", "desktop", "dev-1", secret, 15*time.Minute)
	if err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = ParseToken(token, secret)
	}
}

func BenchmarkGenerateAndParseRoundTrip(b *testing.B) {
	const secret = "bench-test-secret-with-minimum-32-chars!!"
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		token, _ := GenerateAccessToken("user-1", "desktop", "dev-1", secret, 15*time.Minute)
		_, _ = ParseToken(token, secret)
	}
}

func BenchmarkKeyManagerSign(b *testing.B) {
	secrets := map[string]string{
		"key-v1": "secret-for-key-v1-minimum-32-chars",
		"key-v2": "secret-for-key-v2-minimum-32-chars",
	}
	km, err := NewKeyManager(secrets, "key-v1")
	if err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = km.SignAccessToken("user-1", "desktop", "dev-1", 15*time.Minute)
	}
}

func BenchmarkKeyManagerParse(b *testing.B) {
	secrets := map[string]string{
		"key-v1": "secret-for-key-v1-minimum-32-chars",
	}
	km, err := NewKeyManager(secrets, "key-v1")
	if err != nil {
		b.Fatal(err)
	}
	token, err := km.SignAccessToken("user-1", "desktop", "dev-1", 15*time.Minute)
	if err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = km.ParseToken(token)
	}
}

func BenchmarkKeyManagerSignVerifyRoundTrip(b *testing.B) {
	secrets := map[string]string{
		"key-v1": "secret-for-key-v1-minimum-32-chars",
	}
	km, err := NewKeyManager(secrets, "key-v1")
	if err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		token, _ := km.SignAccessToken("user-1", "desktop", "dev-1", 15*time.Minute)
		_, _ = km.ParseToken(token)
	}
}

func BenchmarkGenerateRefreshToken(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = GenerateRefreshToken()
	}
}

func BenchmarkHashRefreshToken(b *testing.B) {
	const token = "my-refresh-token-value-for-benchmarking"
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = HashRefreshToken(token)
	}
}

func BenchmarkKeyManagerJWKS(b *testing.B) {
	secrets := map[string]string{
		"key-v1": "secret-for-key-v1-minimum-32-chars",
		"key-v2": "secret-for-key-v2-minimum-32-chars",
		"key-v3": "secret-for-key-v3-minimum-32-chars",
	}
	km, err := NewKeyManager(secrets, "key-v1")
	if err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = km.JWKS()
	}
}

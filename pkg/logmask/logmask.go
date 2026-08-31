// Package logmask provides a small masking convention for structured logs.
//
// Motivation (#2120 slice 2): hub/edge log with bare slog handlers and rely
// on developer discipline for secrets. This helper gives new call sites a
// one-liner to redact sensitive fields (tokens, secrets, authorization
// headers, api keys) so "never log the value" becomes a code-level default
// instead of a review-time reminder.
package logmask

import (
	"log/slog"
	"strings"
)

// SensitiveKey reports whether a log field name carries credential-like
// semantics. Matching is substring-based and case-insensitive so key styles
// like token / accessToken / authorization_header / apiKey are all caught.
func SensitiveKey(key string) bool {
	k := strings.ToLower(key)
	for _, marker := range []string{
		"token", "secret", "password", "passwd", "authorization",
		"api_key", "apikey", "cookie", "private_key", "credential",
	} {
		if strings.Contains(k, marker) {
			return true
		}
	}
	return false
}

// Value masks a single log value: sensitive values collapse to "***", all
// other values pass through unchanged. Use it as:
//
//	slog.Warn("foo", "error", err, "authorization", logmask.Value(authHeader))
func Value(v any) any {
	if _, ok := v.(string); !ok {
		return v
	}
	return "***"
}

// Attr builds a slog.Attr whose value is masked when the key is sensitive.
// Preferred over Value: the decision lives next to the key name.
func Attr(key string, value any) slog.Attr {
	if SensitiveKey(key) {
		return slog.String(key, "***")
	}
	return slog.Any(key, value)
}

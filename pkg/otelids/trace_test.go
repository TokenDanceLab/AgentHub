package otelids

import (
	"context"
	"net/http"
	"regexp"
	"testing"
)

func TestNewTraceIDFormatAndUniqueness(t *testing.T) {
	hex32 := regexp.MustCompile(`^[0-9a-f]{32}$`)
	seen := make(map[string]struct{}, 1000)
	for i := 0; i < 1000; i++ {
		id := NewTraceID()
		if !hex32.MatchString(id) {
			t.Fatalf("trace id %q does not match 32-hex format", id)
		}
		if _, ok := seen[id]; ok {
			t.Fatalf("duplicate trace id %q on iteration %d", id, i)
		}
		seen[id] = struct{}{}
	}
}

func TestWithTraceIDRoundTrips(t *testing.T) {
	ctx := context.Background()
	if got := FromContext(ctx); got != "" {
		t.Fatalf("expected empty trace id from background ctx, got %q", got)
	}
	want := "deadbeefdeadbeefdeadbeefdeadbeef"
	ctx = WithTraceID(ctx, want)
	if got := FromContext(ctx); got != want {
		t.Fatalf("FromContext = %q, want %q", got, want)
	}
}

func TestSetAndReadHTTPHeader(t *testing.T) {
	h := http.Header{}
	SetHTTPHeader(h, "")
	if v := h.Get(TraceIDHeader); v != "" {
		t.Fatalf("expected no header for empty trace id, got %q", v)
	}
	SetHTTPHeader(h, "abcd1234abcd1234abcd1234abcd1234")
	if got := FromHTTPHeader(h); got != "abcd1234abcd1234abcd1234abcd1234" {
		t.Fatalf("FromHTTPHeader = %q, want full trace id", got)
	}
}

func TestSlogAttrKey(t *testing.T) {
	attr := SlogAttr("abc")
	if attr.Key != "trace_id" {
		t.Fatalf("attr key = %q, want trace_id", attr.Key)
	}
	if attr.Value.String() != "abc" {
		t.Fatalf("attr value = %q, want abc", attr.Value.String())
	}
}

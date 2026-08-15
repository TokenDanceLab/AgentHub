package outboundhttp

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestNewClientDefaultTimeoutOnNonPositiveInput(t *testing.T) {
	for _, input := range []time.Duration{0, -1 * time.Second} {
		client := NewClient(input)
		if client.Timeout != DefaultTimeout {
			t.Errorf("NewClient(%v).Timeout = %v, want %v", input, client.Timeout, DefaultTimeout)
		}
	}
}

func TestNewClientKeepsExplicitTimeout(t *testing.T) {
	client := NewClient(3 * time.Second)
	if client.Timeout != 3*time.Second {
		t.Errorf("NewClient(3s).Timeout = %v, want 3s", client.Timeout)
	}
}

func TestNewClientRefusesRedirects(t *testing.T) {
	client := NewClient(time.Second)
	if client.CheckRedirect == nil {
		t.Fatal("NewClient must install a CheckRedirect policy")
	}
	// ErrUseLastResponse is the policy contract: headers/payload must never be
	// replayed to another origin (token exchange / JWKS fetches).
	err := client.CheckRedirect(&http.Request{}, []*http.Request{{}})
	if !errors.Is(err, http.ErrUseLastResponse) {
		t.Errorf("CheckRedirect returned %v, want http.ErrUseLastResponse", err)
	}
}

func TestReadLimitedBoundaries(t *testing.T) {
	tests := []struct {
		name      string
		body      string
		max       int64
		wantBody  string
		wantError bool
	}{
		{name: "exactly at cap", body: "1234", max: 4, wantBody: "1234"},
		{name: "one byte over cap", body: "12345", max: 4, wantError: true},
		{name: "well under cap", body: "hi", max: 1024, wantBody: "hi"},
		{name: "non-positive max falls back to 64KiB", body: strings.Repeat("a", 64*1024), max: 0, wantBody: strings.Repeat("a", 64*1024)},
		{name: "non-positive max with oversized body", body: strings.Repeat("a", 64*1024+1), max: -1, wantError: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			body, err := ReadLimited(strings.NewReader(tc.body), tc.max)
			if tc.wantError {
				if err == nil {
					t.Fatal("ReadLimited returned nil error, want ErrBodyTooLarge")
				}
				if !errors.Is(err, ErrBodyTooLarge) {
					t.Fatalf("ReadLimited error = %v, want ErrBodyTooLarge", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("ReadLimited returned unexpected error: %v", err)
			}
			if string(body) != tc.wantBody {
				t.Errorf("ReadLimited body = %q, want %q", body, tc.wantBody)
			}
		})
	}
}

func TestReadLimitedPropagatesReaderError(t *testing.T) {
	sentinel := errors.New("source broke")
	_, err := ReadLimited(io.MultiReader(strings.NewReader("partial"), errorReader{err: sentinel}), 1024)
	if !errors.Is(err, sentinel) {
		t.Errorf("ReadLimited error = %v, want sentinel reader error", err)
	}
}

// errorReader fails every Read call with a fixed error.
type errorReader struct{ err error }

func (r errorReader) Read([]byte) (int, error) { return 0, r.err }

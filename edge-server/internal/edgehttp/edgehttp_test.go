package edgehttp

import (
	"errors"
	"net/http"
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
	err := client.CheckRedirect(&http.Request{}, []*http.Request{{}})
	if !errors.Is(err, http.ErrUseLastResponse) {
		t.Errorf("CheckRedirect returned %v, want http.ErrUseLastResponse", err)
	}
}

// TestNewClientCarriesOwnTransportWithWideIdlePool pins the connection-churn
// fix (#2154): Edge→Hub callbacks burst concurrently (merged stream chunks
// post at sem=10); sharing DefaultTransport (MaxIdleConnsPerHost=2) forced
// TCP+TLS re-handshakes on every burst above 2 concurrent callbacks.
func TestNewClientCarriesOwnTransportWithWideIdlePool(t *testing.T) {
	client := NewClient(time.Second)
	tr, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("Transport = %T, want *http.Transport", client.Transport)
	}
	if tr.MaxIdleConnsPerHost != DefaultMaxIdleConnsPerHost {
		t.Errorf("MaxIdleConnsPerHost = %d, want %d", tr.MaxIdleConnsPerHost, DefaultMaxIdleConnsPerHost)
	}
	if tr == http.DefaultTransport.(*http.Transport) {
		t.Error("NewClient must not reuse the process-global DefaultTransport")
	}
}

package lifecycle

import (
	"errors"
	"os/exec"
	"regexp"
	"testing"
)

func TestIsSessionConflictError(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		err    error
		stderr string
		want   bool
	}{
		{
			name: "nil error",
			err:  nil,
			want: false,
		},
		{
			name: "already in use in error message",
			err:  errors.New("Session ID abc is already in use"),
			want: true,
		},
		{
			name: "no conversation found in error message",
			err:  errors.New("No conversation found with session ID abc"),
			want: true,
		},
		{
			name:   "already in use in stderr only",
			err:    errors.New("exit status 1"),
			stderr: "error: Session ID abc is already in use",
			want:   true,
		},
		{
			name:   "no conversation in stderr only",
			err:    errors.New("exit status 1"),
			stderr: "No conversation found with session ID abc",
			want:   true,
		},
		{
			name: "unrelated error",
			err:  errors.New("connection refused"),
			want: false,
		},
		{
			name: "exit error with stderr body",
			err: &exec.ExitError{
				Stderr: []byte("Session ID abc is already in use"),
			},
			want: true,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := isSessionConflictError(tt.err, tt.stderr); got != tt.want {
				t.Fatalf("isSessionConflictError() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNewRandomSessionID(t *testing.T) {
	t.Parallel()

	re := regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	seen := make(map[string]struct{}, 8)
	for i := 0; i < 8; i++ {
		id := newRandomSessionID()
		if !re.MatchString(id) {
			t.Fatalf("newRandomSessionID() = %q, want UUID v4 format", id)
		}
		if _, ok := seen[id]; ok {
			t.Fatalf("newRandomSessionID() returned duplicate %q", id)
		}
		seen[id] = struct{}{}
	}
}

func TestNewRandomSessionIDDistinct(t *testing.T) {
	t.Parallel()
	a, b := newRandomSessionID(), newRandomSessionID()
	if a == b {
		t.Fatalf("expected distinct session IDs, both %q", a)
	}
}

package security

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestIsPathWithin(t *testing.T) {
	t.Parallel()

	root := filepath.Clean("/workspace/root")
	cases := []struct {
		name string
		path string
		want bool
	}{
		{name: "root itself", path: root, want: true},
		{name: "child", path: filepath.Join(root, "src", "main.go"), want: true},
		{name: "parent escape", path: filepath.Join(root, "..", "outside"), want: false},
		{name: "double-dot segment", path: filepath.Join(root, "a", "..", "..", "outside"), want: false},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := IsPathWithin(root, tc.path); got != tc.want {
				t.Fatalf("IsPathWithin(%q, %q)=%v want %v", root, tc.path, got, tc.want)
			}
		})
	}
}

func TestValidateWorkDirAgainstAllowlist(t *testing.T) {
	parent := t.TempDir()
	allowedRoot := filepath.Join(parent, "allowed")
	outsideRoot := filepath.Join(parent, "outside")
	inside := filepath.Join(allowedRoot, "project-a")
	if err := os.MkdirAll(inside, 0o755); err != nil {
		t.Fatalf("MkdirAll inside: %v", err)
	}
	if err := os.MkdirAll(outsideRoot, 0o755); err != nil {
		t.Fatalf("MkdirAll outside: %v", err)
	}

	cases := []struct {
		name      string
		workDir   string
		allowlist []string
		wantErr   error
	}{
		{
			name:      "empty allowlist fail-closed",
			workDir:   inside,
			allowlist: nil,
			wantErr:   ErrWorkspaceAllowlistEmpty,
		},
		{
			name:      "happy path child of root",
			workDir:   inside,
			allowlist: []string{allowedRoot},
			wantErr:   nil,
		},
		{
			name:      "outside allowlist",
			workDir:   outsideRoot,
			allowlist: []string{allowedRoot},
			wantErr:   ErrWorkspaceOutsideAllowlist,
		},
		{
			name:      "parent escape via .. segments",
			workDir:   filepath.Join(allowedRoot, "..", "outside"),
			allowlist: []string{allowedRoot},
			wantErr:   ErrWorkspaceOutsideAllowlist,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateWorkDirAgainstAllowlist(tc.workDir, tc.allowlist)
			if tc.wantErr == nil {
				if err != nil {
					t.Fatalf("ValidateWorkDirAgainstAllowlist returned error: %v", err)
				}
				return
			}
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("error = %v, want %v", err, tc.wantErr)
			}
		})
	}
}

func TestValidateWorkDirAgainstAllowlistRejectsSymlinkEscape(t *testing.T) {
	parent := t.TempDir()
	allowedRoot := filepath.Join(parent, "allowed")
	outsideRoot := filepath.Join(parent, "outside")
	if err := os.MkdirAll(allowedRoot, 0o755); err != nil {
		t.Fatalf("MkdirAll allowed: %v", err)
	}
	if err := os.MkdirAll(outsideRoot, 0o755); err != nil {
		t.Fatalf("MkdirAll outside: %v", err)
	}
	linkPath := filepath.Join(allowedRoot, "linked-outside")
	if err := os.Symlink(outsideRoot, linkPath); err != nil {
		t.Skipf("symlink creation unavailable: %v", err)
	}

	err := ValidateWorkDirAgainstAllowlist(linkPath, []string{allowedRoot})
	if !errors.Is(err, ErrWorkspaceOutsideAllowlist) {
		t.Fatalf("symlink escape error = %v, want %v", err, ErrWorkspaceOutsideAllowlist)
	}
}

func TestValidateWorkDirAgainstAllowlistAllowsSymlinkInsideRoot(t *testing.T) {
	parent := t.TempDir()
	allowedRoot := filepath.Join(parent, "allowed")
	insideTarget := filepath.Join(allowedRoot, "real-project")
	if err := os.MkdirAll(insideTarget, 0o755); err != nil {
		t.Fatalf("MkdirAll inside target: %v", err)
	}
	linkPath := filepath.Join(allowedRoot, "alias")
	if err := os.Symlink(insideTarget, linkPath); err != nil {
		t.Skipf("symlink creation unavailable: %v", err)
	}

	if err := ValidateWorkDirAgainstAllowlist(linkPath, []string{allowedRoot}); err != nil {
		t.Fatalf("in-root symlink should be allowed: %v", err)
	}
}

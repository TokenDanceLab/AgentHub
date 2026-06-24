package api

import (
	"os"
	"testing"
)

// ---------------------------------------------------------------------------
// validateSlug
// ---------------------------------------------------------------------------

func TestValidateSlug_Valid(t *testing.T) {
	valid := []string{
		"my-app",
		"app-123",
		"ab", // minimum 2 chars (first + last alphanumeric)
		"a-b",
		"my-cool-app-42",
		"x1y2z3",
		"a--b", // consecutive hyphens are allowed by the pattern
	}
	for _, slug := range valid {
		if err := validateSlug(slug); err != nil {
			t.Errorf("validateSlug(%q) = %v, want nil", slug, err)
		}
	}
}

func TestValidateSlug_Invalid(t *testing.T) {
	tests := []struct {
		slug string
		want string // expected error substring
	}{
		{"", "slug is required"},
		{"UPPERCASE", "slug must be"},
		{"has spaces", "slug must be"},
		{"-leading", "slug must be"},
		{"trailing-", "slug must be"},
		{"a", "slug must be"},                          // single char: pattern requires >=2
		{"aBc", "slug must be"},                        // mixed case
		{"my_app", "slug must be"},                     // underscore not allowed
		{"s p a c e s", "slug must be"},                // spaces
		{".dots", "slug must be"},                      // dots not allowed
		{"a" + string(make([]byte, 64)), "slug must be"}, // >63 chars
	}
	for _, tt := range tests {
		err := validateSlug(tt.slug)
		if err == nil {
			t.Errorf("validateSlug(%q) = nil, want error containing %q", tt.slug, tt.want)
			continue
		}
		if !contains(err.Error(), tt.want) {
			t.Errorf("validateSlug(%q) error = %q, want error containing %q", tt.slug, err.Error(), tt.want)
		}
	}
}

// ---------------------------------------------------------------------------
// DeployTargetHost
// ---------------------------------------------------------------------------

func TestDeployTargetHost_Default(t *testing.T) {
	// Ensure env var is not set.
	os.Unsetenv(envDeployTargetHost)
	t.Cleanup(func() { os.Unsetenv(envDeployTargetHost) })

	got := DeployTargetHost()
	if got != defaultDeployTargetHost {
		t.Errorf("DeployTargetHost() = %q, want %q (default)", got, defaultDeployTargetHost)
	}
}

func TestDeployTargetHost_EnvOverride(t *testing.T) {
	custom := "edge-prod-01.internal"
	t.Setenv(envDeployTargetHost, custom)

	got := DeployTargetHost()
	if got != custom {
		t.Errorf("DeployTargetHost() = %q, want %q", got, custom)
	}
}

func TestDeployTargetHost_EmptyEnvFallsBackToDefault(t *testing.T) {
	t.Setenv(envDeployTargetHost, "")

	got := DeployTargetHost()
	if got != defaultDeployTargetHost {
		t.Errorf("DeployTargetHost() = %q, want %q (default after empty env)", got, defaultDeployTargetHost)
	}
}

// ---------------------------------------------------------------------------
// DeployTargetPath
// ---------------------------------------------------------------------------

func TestDeployTargetPath_Default(t *testing.T) {
	os.Unsetenv(envDeployTargetPath)
	t.Cleanup(func() { os.Unsetenv(envDeployTargetPath) })

	got := DeployTargetPath()
	if got != defaultDeployTargetPath {
		t.Errorf("DeployTargetPath() = %q, want %q (default)", got, defaultDeployTargetPath)
	}
}

func TestDeployTargetPath_EnvOverride(t *testing.T) {
	custom := "/opt/custom-pages"
	t.Setenv(envDeployTargetPath, custom)

	got := DeployTargetPath()
	if got != custom {
		t.Errorf("DeployTargetPath() = %q, want %q", got, custom)
	}
}

func TestDeployTargetPath_EmptyEnvFallsBackToDefault(t *testing.T) {
	t.Setenv(envDeployTargetPath, "")

	got := DeployTargetPath()
	if got != defaultDeployTargetPath {
		t.Errorf("DeployTargetPath() = %q, want %q (default after empty env)", got, defaultDeployTargetPath)
	}
}

// ---------------------------------------------------------------------------
// PagesDomain
// ---------------------------------------------------------------------------

func TestPagesDomain_Default(t *testing.T) {
	os.Unsetenv(envPagesDomain)
	t.Cleanup(func() { os.Unsetenv(envPagesDomain) })

	got := PagesDomain()
	if got != defaultPagesDomain {
		t.Errorf("PagesDomain() = %q, want %q (default)", got, defaultPagesDomain)
	}
}

func TestPagesDomain_EnvOverride(t *testing.T) {
	custom := "deploy.vectorcontrol.tech"
	t.Setenv(envPagesDomain, custom)

	got := PagesDomain()
	if got != custom {
		t.Errorf("PagesDomain() = %q, want %q", got, custom)
	}
}

func TestPagesDomain_EmptyEnvFallsBackToDefault(t *testing.T) {
	t.Setenv(envPagesDomain, "")

	got := PagesDomain()
	if got != defaultPagesDomain {
		t.Errorf("PagesDomain() = %q, want %q (default after empty env)", got, defaultPagesDomain)
	}
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func contains(s, sub string) bool {
	return len(s) >= len(sub) && searchSubstring(s, sub)
}

func searchSubstring(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

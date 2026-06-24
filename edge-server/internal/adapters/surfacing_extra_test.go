package adapters

import "testing"

func TestMimeTypeFromExt(t *testing.T) {
	tests := []struct {
		ext  string
		want string
	}{
		{".html", "application/octet-stream"},
		{".css", "application/octet-stream"},
		{".js", "application/octet-stream"},
		{".json", "application/octet-stream"},
		{".png", "image/png"},
		{".svg", "image/svg+xml"},
		{".pdf", "application/octet-stream"},
		{".zip", "application/octet-stream"},
		{"", "application/octet-stream"},
	}
	for _, tc := range tests {
		t.Run("ext="+tc.ext, func(t *testing.T) {
			got := mimeTypeFromExt(tc.ext)
			if got != tc.want {
				t.Errorf("mimeTypeFromExt(%q) = %q, want %q", tc.ext, got, tc.want)
			}
		})
	}
}

func TestLanguageFromExt(t *testing.T) {
	tests := []struct {
		ext  string
		want string
	}{
		{".go", "go"},
		{".ts", "typescript"},
		{".py", "python"},
		{".rs", "rust"},
		{".html", "html"},
		{"", ""},
		// Case insensitivity.
		{".GO", "go"},
		{".HTML", "html"},
		{".Ts", "typescript"},
		// Unknown extensions return empty string.
		{".foobar", ""},
		{".xyz", ""},
	}
	for _, tc := range tests {
		t.Run("ext="+tc.ext, func(t *testing.T) {
			got := languageFromExt(tc.ext)
			if got != tc.want {
				t.Errorf("languageFromExt(%q) = %q, want %q", tc.ext, got, tc.want)
			}
		})
	}
}

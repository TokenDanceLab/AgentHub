package model

import (
	"testing"
)

func TestProviderBindingValidate(t *testing.T) {
	tests := []struct {
		name    string
		pb      ProviderBinding
		wantErr bool
		errMsg  string
	}{
		{
			name:    "valid provider binding passes",
			pb:      ProviderBinding{Provider: "anthropic", BaseURL: "https://api.anthropic.com", BindingName: "my-binding", Metadata: `{"region":"us"}`},
			wantErr: false,
		},
		{
			name:    "base_url with @ fails",
			pb:      ProviderBinding{Provider: "anthropic", BaseURL: "https://user:pass@api.example.com", BindingName: "leaked"},
			wantErr: true,
			errMsg:  "base_url must not contain credentials",
		},
		{
			name:    "base_url with token= fails",
			pb:      ProviderBinding{Provider: "openai", BaseURL: "https://api.example.com?token=abc123", BindingName: "leaked"},
			wantErr: true,
			errMsg:  "base_url must not contain credentials",
		},
		{
			name:    "base_url with key= fails",
			pb:      ProviderBinding{Provider: "openai", BaseURL: "https://api.example.com?key=sk-abc123", BindingName: "leaked"},
			wantErr: true,
			errMsg:  "base_url must not contain credentials",
		},
		{
			name:    "valid base_url passes",
			pb:      ProviderBinding{Provider: "custom", BaseURL: "https://my-llm.example.com/v1", BindingName: "custom-endpoint"},
			wantErr: false,
		},
		{
			name:    "metadata not object fails",
			pb:      ProviderBinding{Provider: "anthropic", Metadata: `"not-an-object"`, BindingName: "bad"},
			wantErr: true,
			errMsg:  "metadata must be a JSON object",
		},
		{
			name:    "metadata valid object passes",
			pb:      ProviderBinding{Provider: "anthropic", Metadata: `{"team":"ai","cost_center":"cc-123"}`, BindingName: "tagged"},
			wantErr: false,
		},
		{
			name:    "empty metadata passes",
			pb:      ProviderBinding{Provider: "anthropic", Metadata: "", BindingName: "no-meta"},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.pb.Validate()
			if tt.wantErr {
				if err == nil {
					t.Errorf("expected error containing %q, got nil", tt.errMsg)
					return
				}
				if tt.errMsg != "" && !containsSubstr(err.Error(), tt.errMsg) {
					t.Errorf("expected error containing %q, got %q", tt.errMsg, err.Error())
				}
			} else {
				if err != nil {
					t.Errorf("expected no error, got %v", err)
				}
			}
		})
	}
}

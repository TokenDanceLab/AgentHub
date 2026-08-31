package usersettings

import (
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/agenthub/pkg/errcode"
	"github.com/stretchr/testify/require"
)

// Validation runs before the repository is touched, so a nil repo is safe for
// these cases (#2123 P1-1: input errors must surface as 400, not 500).
func TestUpsertSettings_ValidationErrorsAre400(t *testing.T) {
	svc := NewService(nil)

	cases := []struct {
		name   string
		values map[string]string
		match  string
	}{
		{"key too long", map[string]string{strings.Repeat("k", 129): "v"}, "setting key too long"},
		{"value too long", map[string]string{"k": strings.Repeat("v", 4097)}, "setting value too long"},
		{"empty after trim", map[string]string{"   ": ""}, "no valid settings"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.UpsertSettings("user-1", tc.values)
			require.Error(t, err)
			var e *errcode.Error
			require.True(t, errors.As(err, &e), "error must be an *errcode.Error, got %T", err)
			require.Equal(t, http.StatusBadRequest, e.HTTPStatus)
			require.Contains(t, e.Error(), tc.match)
		})
	}
}

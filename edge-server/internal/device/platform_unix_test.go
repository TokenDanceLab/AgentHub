//go:build !windows

package device

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func assertPrivateCredentialStorage(t *testing.T, credential Credential, workspace string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "private", "credential.json")
	require.NoError(t, SaveCredential(path, credential))
	info, err := os.Stat(path)
	require.NoError(t, err)
	require.Equal(t, os.FileMode(0600), info.Mode().Perm())
	loaded, err := LoadCredential(path, []string{workspace})
	require.NoError(t, err)
	require.Equal(t, credential, loaded)
	require.Error(t, SaveCredential(path, credential))
	require.NoError(t, os.Chmod(path, 0644))
	_, err = LoadCredential(path, []string{workspace})
	require.Error(t, err)
}

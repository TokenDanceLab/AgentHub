package device

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestWindowsPairedStorageRejectsBeforeWriting(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "private", "credential.json")
	require.ErrorIs(t, SaveCredential(path, fixtureCredential(t)), ErrUnsupportedPlatform)
	credential, err := LoadCredential(path, []string{root})
	require.ErrorIs(t, err, ErrUnsupportedPlatform)
	require.Empty(t, credential.Secret)
	journal, err := OpenJournal(filepath.Join(root, "private", "journal.sqlite"))
	require.ErrorIs(t, err, ErrUnsupportedPlatform)
	require.Nil(t, journal)
	_, err = os.Stat(filepath.Join(root, "private"))
	require.ErrorIs(t, err, os.ErrNotExist, "unsupported mode must not create credential or journal files")
}

func assertPrivateCredentialStorage(t *testing.T, credential Credential, workspace string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "credential.json")
	require.ErrorIs(t, SaveCredential(path, credential), ErrUnsupportedPlatform)
	_, err := LoadCredential(path, []string{workspace})
	require.ErrorIs(t, err, ErrUnsupportedPlatform)
	_, err = os.Stat(path)
	require.ErrorIs(t, err, os.ErrNotExist)
}

package device

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"

	"github.com/agenthub/edge-server/internal/security"
)

func (c Credential) Validate() error {
	if !validIdentifier(c.DeviceID) || !validIdentifier(c.TargetID) || c.Secret == "" || c.RuntimeID != "openai-sdk" || !filepath.IsAbs(c.WorkspaceRoot) {
		return errors.New("invalid enrolled Edge credential or scope")
	}
	if !c.ExpiresAt.After(time.Now()) {
		return ErrUnauthorized
	}
	return nil
}

// Workspace returns the canonical local directory only after checking the
// operator's allowlist. Browser/Hub values cannot expand this permission.
func Workspace(path string, allowlist []string) (string, error) {
	if path == "" {
		return "", errors.New("enrollment requires a workspace directory")
	}
	if err := security.ValidateWorkDirAgainstAllowlist(path, allowlist); err != nil {
		return "", errors.New("enrollment workspace is outside the local allowlist or unavailable")
	}
	real, err := security.NormalizedRealPath(path)
	if err != nil {
		return "", errors.New("enrollment workspace unavailable")
	}
	info, err := os.Stat(real)
	if err != nil || !info.IsDir() {
		return "", errors.New("enrollment workspace must be a directory")
	}
	return real, nil
}

// SaveCredential creates a complete 0600 file atomically without replacing an
// existing enrollment. Re-pairing requires an explicit operator file decision.
func SaveCredential(path string, c Credential) error {
	if err := c.Validate(); err != nil {
		return err
	}
	if !filepath.IsAbs(path) {
		return errors.New("device credential file must be an absolute path")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return errors.New("cannot create device credential directory")
	}
	data, err := json.Marshal(c)
	if err != nil {
		return errors.New("cannot encode device credential")
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".edge-credential-*")
	if err != nil {
		return errors.New("cannot create device credential file")
	}
	temp := f.Name()
	defer os.Remove(temp)
	if err := f.Chmod(0600); err != nil {
		f.Close()
		return errors.New("cannot secure device credential file")
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		return errors.New("cannot write device credential file")
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return errors.New("cannot persist device credential file")
	}
	if err := f.Close(); err != nil {
		return errors.New("cannot close device credential file")
	}
	// Link is atomic and fails if path exists; unlike rename it cannot silently
	// overwrite a credential another enrollment wrote while this one polled.
	if err := os.Link(temp, path); err != nil {
		return errors.New("cannot install device credential; destination must not exist")
	}
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return errors.New("cannot sync credential directory")
	}
	defer dir.Close()
	if err := dir.Sync(); err != nil {
		return errors.New("cannot sync credential directory")
	}
	return nil
}

func LoadCredential(path string, allowlist []string) (Credential, error) {
	var c Credential
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 16384 {
		return c, errors.New("device credential must be a regular private 0600 file")
	}
	data, err := os.ReadFile(path)
	if err != nil || json.Unmarshal(data, &c) != nil {
		return c, errors.New("cannot read device credential")
	}
	if err := c.Validate(); err != nil {
		return Credential{}, err
	}
	workspace, err := Workspace(c.WorkspaceRoot, allowlist)
	if err != nil || workspace != c.WorkspaceRoot {
		return Credential{}, errors.New("enrolled workspace no longer matches local allowlist")
	}
	return c, nil
}

package api

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/agenthub/edge-server/internal/store"
)

// failingSettingsRepository forces UpsertSettings persist failures while
// delegating everything else to a real in-memory store.
type failingSettingsRepository struct {
	store.Repository
}

func (r *failingSettingsRepository) UpsertSettings(patch map[string]string) (store.UserSettings, error) {
	return store.UserSettings{}, errors.New("forced settings persist failure")
}

func TestPatchSettingsSuccess(t *testing.T) {
	h := newTestHandler()

	req := httptest.NewRequest(http.MethodPatch, "/v1/settings", strings.NewReader(`{"theme":"dark"}`))
	rec := httptest.NewRecorder()
	h.PatchSettings(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("PatchSettings status = %d, want 200; body = %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"theme"`) {
		t.Fatalf("PatchSettings body missing patched key: %s", rec.Body.String())
	}
}

// TestPatchSettingsPersistFailureReturns500 pins the honest error path: a
// settings write whose persistence failed must not be answered with 200 OK.
func TestPatchSettingsPersistFailureReturns500(t *testing.T) {
	h := newTestHandler()
	h.Store = &failingSettingsRepository{Repository: store.New()}

	req := httptest.NewRequest(http.MethodPatch, "/v1/settings", strings.NewReader(`{"theme":"dark"}`))
	rec := httptest.NewRecorder()
	h.PatchSettings(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("PatchSettings status = %d, want 500; body = %s", rec.Code, rec.Body.String())
	}
}

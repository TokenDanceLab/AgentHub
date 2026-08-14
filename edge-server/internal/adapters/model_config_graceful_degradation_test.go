package adapters

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/agenthub/edge-server/internal/ccswitch"
	_ "modernc.org/sqlite"
)

// =============================================================================
// Graceful degradation: cc-switch DB unavailable
// =============================================================================

// TestConsumeCCSwitchModels_DBNotFound verifies graceful degradation when the
// cc-switch database file does not exist. ConsumeCCSwitchModels must:
//
//  1. Return a non-nil error.
//  2. Return nil for the merged aliases map.
//  3. Leave the static ModelAliases completely intact (no mutation).
//
// This guarantees that callers can log a WARNING and continue with static
// configuration only — the cc-switch unavailability is never fatal.
func TestConsumeCCSwitchModels_DBNotFound(t *testing.T) {
	before := copyModelAliases()

	nonExistentPath := filepath.Join(t.TempDir(), "nonexistent", "cc-switch.db")

	merged, err := ConsumeCCSwitchModels(nonExistentPath)
	if err == nil {
		t.Error("expected error when cc-switch database does not exist")
	}
	if merged != nil {
		t.Errorf("expected nil merged aliases on error, got %d entries", len(merged))
	}

	// Static ModelAliases must be completely unchanged.
	for agentID, beforeAliases := range before {
		afterAliases, ok := ModelAliases[agentID]
		if !ok {
			t.Errorf("agent ID %q was removed from ModelAliases during failed consumption", agentID)
			continue
		}
		if len(afterAliases) != len(beforeAliases) {
			t.Errorf("ModelAliases[%q] length = %d, want %d (static config should be unchanged)", agentID, len(afterAliases), len(beforeAliases))
			continue
		}
		for alias, beforeModel := range beforeAliases {
			afterModel := afterAliases[alias]
			if afterModel != beforeModel {
				t.Errorf("ModelAliases[%q][%q] = %q, want %q (static config must be unchanged after DB not found)", agentID, alias, afterModel, beforeModel)
			}
		}
	}

	// Also verify that no extra agent IDs were added.
	for agentID := range ModelAliases {
		if _, ok := before[agentID]; !ok {
			t.Errorf("unexpected agent ID %q added to ModelAliases during failed consumption", agentID)
		}
	}
}

// TestConsumeCCSwitchModels_EmptyPath verifies that an empty dbPath string is
// handled gracefully (NewReaderWithPath returns nil for empty path).
func TestConsumeCCSwitchModels_EmptyPath(t *testing.T) {
	before := copyModelAliases()

	merged, err := ConsumeCCSwitchModels("")
	if err == nil {
		t.Error("expected error for empty db path")
	}
	if merged != nil {
		t.Error("expected nil merged aliases for empty db path")
	}

	// Static aliases must be unchanged.
	for agentID, beforeAliases := range before {
		afterAliases := ModelAliases[agentID]
		for alias, beforeModel := range beforeAliases {
			if afterAliases[alias] != beforeModel {
				t.Errorf("ModelAliases[%q][%q] changed after empty-path degradation", agentID, alias)
			}
		}
	}
}

// =============================================================================
// Successful cc-switch DB consumption
// =============================================================================

// TestConsumeCCSwitchModels_MergesAliases verifies the happy path: when a valid
// cc-switch SQLite database exists with providers, ConsumeCCSwitchModels reads
// the model aliases and merges them into the static ModelAliases. cc-switch
// aliases override static ones on key conflict; static entries with no conflict
// are preserved.
func TestConsumeCCSwitchModels_MergesAliases(t *testing.T) {
	before := copyModelAliases()
	defer restoreModelAliases(before)

	dbPath := createTestCCSwitchDB(t)

	merged, err := ConsumeCCSwitchModels(dbPath)
	if err != nil {
		t.Fatalf("ConsumeCCSwitchModels: %v", err)
	}
	if merged == nil {
		t.Fatal("expected non-nil merged aliases from valid cc-switch DB")
	}
	if len(merged) == 0 {
		t.Error("expected at least one adapter entry in merged aliases")
	}

	// cc-switch "claude" app_type maps to "claude-code" adapter ID.
	ccAliases, ok := merged["claude-code"]
	if !ok {
		t.Fatal("expected claude-code in merged cc-switch aliases")
	}
	if ccAliases["sonnet"] != "glm-5.1" {
		t.Errorf("cc-switch sonnet alias = %q, want glm-5.1", ccAliases["sonnet"])
	}
	if ccAliases["haiku"] != "deepseek-v4-flash" {
		t.Errorf("cc-switch haiku alias = %q, want deepseek-v4-flash", ccAliases["haiku"])
	}

	// Static ModelAliases must be updated (cc-switch overrides static on conflict).
	if ModelAliases["claude-code"]["sonnet"] != "glm-5.1" {
		t.Errorf("ModelAliases[claude-code][sonnet] = %q, want glm-5.1 (cc-switch should override static)", ModelAliases["claude-code"]["sonnet"])
	}

	// Static-only alias keys (not in cc-switch) must be preserved.
	if ModelAliases["claude-code"]["4.7"] != "claude-opus-4-7" {
		t.Errorf("ModelAliases[claude-code][4.7] = %q, want claude-opus-4-7 (static-only alias must be preserved)", ModelAliases["claude-code"]["4.7"])
	}
}

// TestConsumeCCSwitchModels_EmptyDB verifies that a cc-switch database with
// a valid schema but no providers still succeeds (no aliases to merge).
func TestConsumeCCSwitchModels_EmptyDB(t *testing.T) {
	before := copyModelAliases()
	defer restoreModelAliases(before)

	dbPath := filepath.Join(t.TempDir(), "empty-cc-switch.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS providers (
			id TEXT PRIMARY KEY, app_type TEXT NOT NULL, name TEXT NOT NULL,
			settings_config TEXT NOT NULL DEFAULT '{}', provider_type TEXT,
			is_current INTEGER NOT NULL DEFAULT 0, in_failover_queue INTEGER NOT NULL DEFAULT 0,
			cost_multiplier TEXT NOT NULL DEFAULT ''
		);
		CREATE TABLE IF NOT EXISTS provider_endpoints (
			provider_id TEXT NOT NULL, app_type TEXT NOT NULL, url TEXT NOT NULL,
			PRIMARY KEY (provider_id, app_type)
		);
		CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT ''
		);
	`)
	db.Close()
	if err != nil {
		t.Fatalf("create schema: %v", err)
	}

	merged, err := ConsumeCCSwitchModels(dbPath)
	if err != nil {
		t.Fatalf("ConsumeCCSwitchModels on empty DB: %v", err)
	}
	// Empty DB with correct schema: no providers, so merged should be empty.
	if len(merged) != 0 {
		t.Errorf("expected 0 merged aliases for empty DB, got %d", len(merged))
	}

	// Static aliases must be unchanged (no merges happened, no removals).
	for agentID, beforeAliases := range before {
		afterAliases := ModelAliases[agentID]
		for alias, model := range beforeAliases {
			if afterAliases[alias] != model {
				t.Errorf("ModelAliases[%q][%q] changed after empty-DB consumption", agentID, alias)
			}
		}
	}
}

// =============================================================================
// Registry integration: full degradation-to-runtime flow
// =============================================================================

// TestConsumeCCSwitchModels_RegistryIntegration verifies the full graceful
// degradation flow: cc-switch is unavailable, so ConsumeCCSwitchModels returns
// an error, but the adapter registry is built successfully and model resolution
// works using the static configuration.
//
// This is the critical integration path: edge-server must boot and serve runs
// even when cc-switch is not installed or its DB is missing/corrupt.
func TestConsumeCCSwitchModels_RegistryIntegration(t *testing.T) {
	// Step 1: Simulate cc-switch DB being unavailable.
	ccDBPath := filepath.Join(t.TempDir(), "nonexistent", "cc-switch.db")
	merged, err := ConsumeCCSwitchModels(ccDBPath)
	if err == nil {
		t.Fatal("expected error when cc-switch DB is unavailable")
	}
	if merged != nil {
		t.Errorf("expected nil merged aliases on error, got %d entries", len(merged))
	}
	t.Logf("cc-switch degradation: %v (this is expected — continuing with static config)", err)

	// Step 2: Build the adapter registry after graceful degradation.
	reg := NewRegistry()
	a := &stubAdapter{id: "claude-code"}
	if err := reg.Register(a); err != nil {
		t.Fatalf("register adapter after degradation: %v", err)
	}

	// Step 3: Verify registry operations work.
	got, ok := reg.Get("claude-code")
	if !ok {
		t.Fatal("adapter not found in registry after cc-switch degradation")
	}
	if got.Metadata().ID != "claude-code" {
		t.Errorf("got adapter ID %q, want claude-code", got.Metadata().ID)
	}

	resolved, err := reg.Resolve("claude-code")
	if err != nil {
		t.Fatalf("Resolve after degradation: %v", err)
	}
	if resolved == nil {
		t.Fatal("Resolve returned nil adapter")
	}

	// Step 4: Verify static model resolution still works after degradation.
	if got := ResolveModel("claude-code", "sonnet"); got != "claude-sonnet-4-6" {
		t.Errorf("ResolveModel(claude-code, sonnet) = %q, want claude-sonnet-4-6", got)
	}
	if got := ResolveModelWithDefault("claude-code", ""); got != "claude-sonnet-4-6" {
		t.Errorf("ResolveModelWithDefault(claude-code, \"\") = %q, want claude-sonnet-4-6", got)
	}
	if got := ResolveModelWithDefault("openai-sdk", ""); got != "gpt-5.5" {
		t.Errorf("ResolveModelWithDefault(openai-sdk, \"\") = %q, want gpt-5.5", got)
	}
	if got := ResolveModelWithDefault("anthropic-sdk", ""); got != "claude-sonnet-4-6" {
		t.Errorf("ResolveModelWithDefault(anthropic-sdk, \"\") = %q, want claude-sonnet-4-6", got)
	}

	// Step 5: Verify reasoning effort resolution.
	if got := ResolveReasoningEffort("claude-code", "high"); got != "high" {
		t.Errorf("ResolveReasoningEffort(claude-code, high) = %q, want high", got)
	}

	// Step 6: Registry list must include the registered adapter.
	list := reg.List()
	if len(list) != 1 {
		t.Errorf("expected 1 adapter in registry list, got %d", len(list))
	}
	ids := reg.ListIDs()
	if len(ids) != 1 || ids[0] != "claude-code" {
		t.Errorf("ListIDs = %v, want [claude-code]", ids)
	}
}

// TestConsumeCCSwitchModels_ResolveModelAliasReaderNil tests the ccswitch
// Reader.ResolveModelAlias path when NewReader returns nil (DB absent).
// This covers the internal graceful degradation within the ccswitch package.
func TestConsumeCCSwitchModels_ResolveModelAliasWhenDBMissing(t *testing.T) {
	// Override CC_SWITCH_HOME to a non-existent directory so NewReader returns nil.
	orig := os.Getenv("CC_SWITCH_HOME")
	os.Setenv("CC_SWITCH_HOME", filepath.Join(t.TempDir(), "not-cc-switch"))
	defer os.Setenv("CC_SWITCH_HOME", orig)

	// ConsumeCCSwitchModels uses the explicit dbPath path, so it's not affected by
	// the env var. But ResolveModelAlias on a nil Reader must return ("", false).
	// We verify this via the Reader's nil-guard: NewReader returns nil, and
	// ResolveModelAlias is a method on *Reader, so a nil receiver would panic if
	// called. In practice, ResolveModelAlias calls r.ReadProviders() which would
	// dereference r.dbPath and panic.
	//
	// The protection is at NewReader() → returns nil when DB missing.
	// Callers must check reader != nil before calling methods.
	// ConsumeCCSwitchModels does this correctly via NewReaderWithPath.

	// Verify the env override works: NewReader with missing dir returns nil.
	reader := ccswitch.NewReader() // Uses DBPath() which reads CC_SWITCH_HOME
	if reader != nil {
		t.Error("expected nil reader when cc-switch DB directory does not exist")
	}

	// The adapter-level ConsumeCCSwitchModels should also reject this path.
	// (DBPath() may return a different path than our explicit temp dir path,
	// so test with a guaranteed non-existent path.)
	nonExistent := filepath.Join(t.TempDir(), "definitely-not-here", "cc-switch.db")
	merged, err := ConsumeCCSwitchModels(nonExistent)
	if err == nil {
		t.Error("expected error for non-existent cc-switch DB path")
	}
	if merged != nil {
		t.Error("expected nil merged aliases")
	}
}

// =============================================================================
// Helpers
// =============================================================================

// createTestCCSwitchDB creates a temporary SQLite database with the cc-switch
// schema and a test provider for the "claude" app_type. The provider has model
// aliases that should override the static defaults.
func createTestCCSwitchDB(t *testing.T) string {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "test-cc-switch.db")

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	defer db.Close()

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS providers (
			id TEXT PRIMARY KEY,
			app_type TEXT NOT NULL,
			name TEXT NOT NULL,
			settings_config TEXT NOT NULL DEFAULT '{}',
			provider_type TEXT,
			is_current INTEGER NOT NULL DEFAULT 0,
			in_failover_queue INTEGER NOT NULL DEFAULT 0,
			cost_multiplier TEXT NOT NULL DEFAULT ''
		);
		CREATE TABLE IF NOT EXISTS provider_endpoints (
			provider_id TEXT NOT NULL,
			app_type TEXT NOT NULL,
			url TEXT NOT NULL,
			PRIMARY KEY (provider_id, app_type)
		);
		CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL DEFAULT ''
		);
	`)
	if err != nil {
		t.Fatalf("create schema: %v", err)
	}

	// Insert a current provider for "claude" app_type with model aliases that
	// differ from the static defaults (so we can prove merging works).
	_, err = db.Exec(`
		INSERT INTO providers (id, app_type, name, settings_config, provider_type, is_current, in_failover_queue, cost_multiplier)
		VALUES ('test-provider-1', 'claude', 'Test Provider',
			'{"model":"sonnet","env":{"ANTHROPIC_DEFAULT_SONNET_MODEL":"glm-5.1","ANTHROPIC_DEFAULT_HAIKU_MODEL":"deepseek-v4-flash","ANTHROPIC_DEFAULT_OPUS_MODEL":"deepseek-v4-pro[1M]"}}',
			'custom', 1, 0, '');
	`)
	if err != nil {
		t.Fatalf("insert test provider: %v", err)
	}

	_, err = db.Exec(`
		INSERT INTO provider_endpoints (provider_id, app_type, url)
		VALUES ('test-provider-1', 'claude', 'https://api.test.example.com/v1');
	`)
	if err != nil {
		t.Fatalf("insert endpoint: %v", err)
	}

	return dbPath
}

// copyModelAliases returns a deep copy of the current package-level ModelAliases.
func copyModelAliases() map[string]map[string]string {
	cp := make(map[string]map[string]string, len(ModelAliases))
	for agentID, aliases := range ModelAliases {
		cp[agentID] = make(map[string]string, len(aliases))
		for k, v := range aliases {
			cp[agentID][k] = v
		}
	}
	return cp
}

// restoreModelAliases replaces the package-level ModelAliases with the given
// snapshot. Use this in tests that modify ModelAliases to ensure test isolation.
func restoreModelAliases(snapshot map[string]map[string]string) {
	for k := range ModelAliases {
		delete(ModelAliases, k)
	}
	for agentID, aliases := range snapshot {
		ModelAliases[agentID] = make(map[string]string, len(aliases))
		for k, v := range aliases {
			ModelAliases[agentID][k] = v
		}
	}
}

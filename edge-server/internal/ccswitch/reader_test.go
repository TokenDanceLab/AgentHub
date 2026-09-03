package ccswitch

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestDetect(t *testing.T) {
	// cc-switch is absent on CI runners and on most dev boxes: Detect must
	// report "not installed" rather than panic or claim routing is active.
	// (The installed path is covered by TestDetectFixtureDB.)
	t.Setenv("CC_SWITCH_HOME", filepath.Join(t.TempDir(), "absent"))

	status := Detect()

	if status.Installed {
		t.Errorf("Installed = true, want false (no db under %s)", status.ConfigDir)
	}
	if status.RoutingActive {
		t.Error("RoutingActive = true, want false when cc-switch is absent")
	}
	if status.DBPath == "" {
		t.Error(`DBPath = "", want the derived path even when the file is absent`)
	}
}

// ── fixture-backed DB tests ────────────────────────────────────────────────
//
// The three tests that used to live here (TestDetectRealDB / TestReaderRealDB /
// TestReaderResolveModelAlias) all began with
//
//	if _, err := os.Stat(DBPath()); err != nil {
//		t.Skip("cc-switch database not found on this machine")
//	}
//
// CI runners never have ~/.cc-switch/cc-switch.db, so they skipped on every
// single run since they were added, and two of the three had no assertion at
// all (only t.Logf). They gave the impression the DB read path was covered
// while covering nothing. Reader already exposes NewReaderWithPath and honours
// $CC_SWITCH_HOME, so the same behaviour is testable against a real sqlite file
// built in t.TempDir() — which is what the tests below do. Net effect: 3 tests
// that never executed anywhere are replaced by tests that execute everywhere.

// writeFixtureDB creates a cc-switch-shaped sqlite database at dir/cc-switch.db
// and returns its path. The schema mirrors the four tables reader.go queries
// (providers / provider_endpoints / settings / proxy_config); column types are
// the ones database/sql must convert from (INTEGER -> bool, TEXT -> string,
// NULL provider_type -> sql.NullString).
func writeFixtureDB(t *testing.T, dir string, providers, endpoints, settings, proxy []string) string {
	t.Helper()

	dbPath := filepath.Join(dir, "cc-switch.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open fixture db: %v", err)
	}
	defer db.Close()

	stmts := []string{
		`CREATE TABLE providers (
			id TEXT PRIMARY KEY,
			app_type TEXT NOT NULL,
			name TEXT NOT NULL,
			settings_config TEXT NOT NULL,
			provider_type TEXT,
			is_current INTEGER NOT NULL,
			in_failover_queue INTEGER NOT NULL,
			cost_multiplier TEXT NOT NULL
		)`,
		`CREATE TABLE provider_endpoints (
			provider_id TEXT NOT NULL,
			app_type TEXT NOT NULL,
			url TEXT NOT NULL
		)`,
		`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
		`CREATE TABLE proxy_config (
			app_type TEXT NOT NULL,
			proxy_enabled INTEGER NOT NULL,
			listen_port INTEGER NOT NULL
		)`,
	}
	for _, q := range stmts {
		if _, err := db.Exec(q); err != nil {
			t.Fatalf("create fixture schema (%s): %v", q[:40], err)
		}
	}
	for _, q := range append(append(append([]string{}, providers...), endpoints...), append(settings, proxy...)...) {
		if _, err := db.Exec(q); err != nil {
			t.Fatalf("seed fixture (%s): %v", q, err)
		}
	}
	return dbPath
}

// currentClaudeProvider is a settings_config with an API key, an opus alias
// carrying a cc-switch context suffix, and a display-name alias.
const currentClaudeProvider = `{"model":"opus[1m]","env":{` +
	`"ANTHROPIC_AUTH_TOKEN":"sk-fixture",` +
	`"ANTHROPIC_BASE_URL":"https://api.example.com/v1",` +
	`"ANTHROPIC_DEFAULT_OPUS_MODEL":"deepseek-v4-pro[1M]",` +
	`"ANTHROPIC_DEFAULT_OPUS_MODEL_NAME":"glm-5.1"}}`

func TestDetectFixtureDB(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CC_SWITCH_HOME", dir)
	writeFixtureDB(t, dir, nil, nil, nil, []string{
		`INSERT INTO proxy_config VALUES ('claude', 1, 8082)`,
	})

	status := Detect()

	if !status.Installed {
		t.Errorf("Installed = false, want true (db exists at %s)", status.DBPath)
	}
	if !status.RoutingActive {
		t.Error("RoutingActive = false, want true (proxy_enabled=1)")
	}
	if len(status.ActiveAppTypes) != 1 || status.ActiveAppTypes[0] != "claude" {
		t.Errorf("ActiveAppTypes = %v, want [claude]", status.ActiveAppTypes)
	}
	if status.ProxyPort != 8082 {
		t.Errorf("ProxyPort = %d, want 8082", status.ProxyPort)
	}
	if status.ConfigDir != dir {
		t.Errorf("ConfigDir = %q, want %q", status.ConfigDir, dir)
	}
}

func TestDetectFixtureDBProxyDisabled(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CC_SWITCH_HOME", dir)
	writeFixtureDB(t, dir, nil, nil, nil, []string{
		`INSERT INTO proxy_config VALUES ('claude', 0, 8082)`,
	})

	status := Detect()

	if !status.Installed {
		t.Error("Installed = false, want true")
	}
	if status.RoutingActive {
		t.Error("RoutingActive = true, want false (proxy_enabled=0)")
	}
	if len(status.ActiveAppTypes) != 0 {
		t.Errorf("ActiveAppTypes = %v, want empty", status.ActiveAppTypes)
	}
}

func TestReaderFixtureDB(t *testing.T) {
	dir := t.TempDir()
	dbPath := writeFixtureDB(t, dir,
		[]string{
			`INSERT INTO providers VALUES ('p-opus','claude','DeepSeek','` + currentClaudeProvider + `','anthropic',1,0,'1.0')`,
			// provider_type stays NULL on purpose: reader.go scans it into
			// sql.NullString, so this row is the only coverage that column has.
			`INSERT INTO providers VALUES ('p-fail','claude','Failover','',NULL,0,1,'0.5')`,
			`INSERT INTO providers VALUES ('p-codex','codex','Codex','{}','openai',1,0,'1.0')`,
		},
		[]string{
			`INSERT INTO provider_endpoints VALUES ('p-opus','claude','https://api.example.com/v1')`,
		},
		[]string{
			`INSERT INTO settings VALUES ('theme','dark')`,
			`INSERT INTO settings VALUES ('lang','zh')`,
		},
		nil,
	)

	reader := NewReaderWithPath(dbPath)
	if reader == nil {
		t.Fatalf("NewReaderWithPath(%s) = nil, want reader", dbPath)
	}

	claude, err := reader.ReadProviders("claude")
	if err != nil {
		t.Fatalf("ReadProviders(claude): %v", err)
	}
	if len(claude) != 2 {
		t.Fatalf("ReadProviders(claude) returned %d providers, want 2", len(claude))
	}

	byID := map[string]ProviderModelMapping{}
	for _, p := range claude {
		byID[p.ProviderID] = p
	}

	cur, ok := byID["p-opus"]
	if !ok {
		t.Fatal("p-opus missing from ReadProviders(claude)")
	}
	if !cur.IsCurrent {
		t.Error("p-opus IsCurrent = false, want true")
	}
	if !cur.APIKeySet {
		t.Error("p-opus APIKeySet = false, want true (ANTHROPIC_AUTH_TOKEN present)")
	}
	if !cur.IsActive {
		t.Error("p-opus IsActive = false, want true (not in failover queue)")
	}
	if cur.BaseURL != "https://api.example.com/v1" {
		t.Errorf("p-opus BaseURL = %q, want the provider_endpoints join", cur.BaseURL)
	}
	if got := cur.ModelAliases["opus"]; got != "deepseek-v4-pro" {
		t.Errorf("p-opus ModelAliases[opus] = %q, want deepseek-v4-pro (context suffix stripped)", got)
	}
	if got := cur.ModelAliases["opus_name"]; got != "glm-5.1" {
		t.Errorf("p-opus ModelAliases[opus_name] = %q, want glm-5.1", got)
	}

	fail, ok := byID["p-fail"]
	if !ok {
		t.Fatal("p-fail missing from ReadProviders(claude)")
	}
	if !fail.InFailover {
		t.Error("p-fail InFailover = false, want true")
	}
	if fail.IsActive {
		t.Error("p-fail IsActive = true, want false (in failover queue)")
	}
	if fail.APIKeySet {
		t.Error("p-fail APIKeySet = true, want false (settings_config empty)")
	}
	if fail.ProviderType != "" {
		t.Errorf(`p-fail ProviderType = %q, want "" (NULL column)`, fail.ProviderType)
	}
	if len(fail.ModelAliases) != 0 {
		t.Errorf("p-fail ModelAliases = %v, want empty", fail.ModelAliases)
	}

	// app_type filter: the codex provider must not leak into the claude read.
	if _, ok := byID["p-codex"]; ok {
		t.Error("p-codex (app_type=codex) leaked into ReadProviders(claude)")
	}

	codex, err := reader.ReadProviders("codex")
	if err != nil {
		t.Fatalf("ReadProviders(codex): %v", err)
	}
	if len(codex) != 1 || codex[0].ProviderID != "p-codex" {
		t.Errorf("ReadProviders(codex) = %+v, want exactly p-codex", codex)
	}

	all, err := reader.ReadAll()
	if err != nil {
		t.Fatalf("ReadAll: %v", err)
	}
	if len(all.Providers) != 3 {
		t.Errorf("ReadAll providers = %d, want 3 (no app_type filter)", len(all.Providers))
	}
	if len(all.Settings) != 2 {
		t.Errorf("ReadAll settings = %d, want 2", len(all.Settings))
	}

	settings, err := reader.ReadSettings("theme")
	if err != nil {
		t.Fatalf("ReadSettings(theme): %v", err)
	}
	if len(settings) != 1 || settings["theme"] != "dark" {
		t.Errorf("ReadSettings(theme) = %v, want map[theme:dark] (key filter)", settings)
	}
}

func TestResolveModelAliasFixtureDB(t *testing.T) {
	dir := t.TempDir()
	dbPath := writeFixtureDB(t, dir, []string{
		`INSERT INTO providers VALUES ('p-opus','claude','DeepSeek','` + currentClaudeProvider + `','anthropic',1,0,'1.0')`,
	}, nil, nil, nil)

	reader := NewReaderWithPath(dbPath)
	if reader == nil {
		t.Fatal("NewReaderWithPath returned nil")
	}

	if got, ok := reader.ResolveModelAlias("opus", "claude"); !ok || got != "deepseek-v4-pro" {
		t.Errorf(`ResolveModelAlias("opus","claude") = (%q,%v), want ("deepseek-v4-pro",true)`, got, ok)
	}
	if got, ok := reader.ResolveModelAlias("sonnet", "claude"); ok {
		t.Errorf(`ResolveModelAlias("sonnet","claude") = (%q,true), want (_,false) — alias not configured`, got)
	}
	if got, ok := reader.ResolveModelAlias("opus", "codex"); ok {
		t.Errorf(`ResolveModelAlias("opus","codex") = (%q,true), want (_,false) — no codex provider`, got)
	}
}

// TestResolveModelAliasDisplayNameFallback locks the display-name fallback:
// when a provider configures only ANTHROPIC_DEFAULT_OPUS_MODEL_NAME (no
// ANTHROPIC_DEFAULT_OPUS_MODEL), asking for "opus" must still resolve.
//
// parseModelAliases is the only producer of ModelAliases and it emits the key
// "opus_name" (see its aliasMap), so the fallback lookup key has to be
// alias+"_name". It used to be alias+"_NAME", which could never match: the
// fallback was dead, and the sibling consumer in
// internal/api/model_catalog_ccswitch.go already used the lowercase form — two
// handcopies of one key, one of them wrong.
func TestResolveModelAliasDisplayNameFallback(t *testing.T) {
	dir := t.TempDir()
	dbPath := writeFixtureDB(t, dir, []string{
		`INSERT INTO providers VALUES ('p-name','claude','NameOnly','{"env":{` +
			`"ANTHROPIC_AUTH_TOKEN":"sk-fixture",` +
			`"ANTHROPIC_DEFAULT_OPUS_MODEL_NAME":"glm-5.1"}}','anthropic',1,0,'1.0')`,
	}, nil, nil, nil)

	reader := NewReaderWithPath(dbPath)
	if reader == nil {
		t.Fatal("NewReaderWithPath returned nil")
	}

	got, ok := reader.ResolveModelAlias("opus", "claude")
	if !ok || got != "glm-5.1" {
		t.Errorf(`ResolveModelAlias("opus","claude") = (%q,%v), want ("glm-5.1",true) via the opus_name fallback`, got, ok)
	}
}

func TestStripContextSuffix(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"deepseek-v4-pro[1M]", "deepseek-v4-pro"},
		{"deepseek-v4-pro[1M] ", "deepseek-v4-pro"},
		{"glm-5.1", "glm-5.1"},
		{"qwen3.7-max[1M]", "qwen3.7-max"},
		{"deepseek-v4-flash", "deepseek-v4-flash"},
	}
	for _, tt := range tests {
		got := stripContextSuffix(tt.input)
		if got != tt.expected {
			t.Errorf("stripContextSuffix(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}

func TestParseModelAliases(t *testing.T) {
	input := `{"model":"opus[1m]","env":{"ANTHROPIC_AUTH_TOKEN":"sk-test","ANTHROPIC_BASE_URL":"https://api.example.com/v1","ANTHROPIC_DEFAULT_OPUS_MODEL":"deepseek-v4-pro[1M]","ANTHROPIC_DEFAULT_SONNET_MODEL":"glm-5.1","ANTHROPIC_DEFAULT_HAIKU_MODEL":"deepseek-v4-flash","ANTHROPIC_DEFAULT_OPUS_MODEL_NAME":"deepseek-v4-pro","ANTHROPIC_DEFAULT_SONNET_MODEL_NAME":"glm-5.1","ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME":"deepseek-v4-flash"}}`

	aliases := parseModelAliases(input)

	if got := aliases["opus"]; got != "deepseek-v4-pro" {
		t.Errorf("aliases[opus] = %q, want %q", got, "deepseek-v4-pro")
	}
	if got := aliases["sonnet"]; got != "glm-5.1" {
		t.Errorf("aliases[sonnet] = %q, want %q", got, "glm-5.1")
	}
	if got := aliases["haiku"]; got != "deepseek-v4-flash" {
		t.Errorf("aliases[haiku] = %q, want %q", got, "deepseek-v4-flash")
	}
}

func TestParseModelAliasesEmpty(t *testing.T) {
	aliases := parseModelAliases("")
	if len(aliases) != 0 {
		t.Errorf("expected empty aliases for empty input, got %d", len(aliases))
	}

	aliases = parseModelAliases("{}")
	if len(aliases) != 0 {
		t.Errorf("expected empty aliases for {}, got %d", len(aliases))
	}
}

func TestNewReaderMissingDB(t *testing.T) {
	// Temporarily override the config dir to a non-existent path.
	t.Setenv("CC_SWITCH_HOME", filepath.Join(t.TempDir(), "nonexistent"))

	reader := NewReader()
	if reader != nil {
		t.Error("expected nil reader when db does not exist")
	}
}

func TestConfigDir(t *testing.T) {
	// Default: ~/.cc-switch
	dir := ConfigDir()
	if dir == "" {
		t.Error("expected non-empty config dir")
	}
	t.Logf("config dir: %s", dir)

	// With env override.
	t.Setenv("CC_SWITCH_HOME", "/tmp/test-cc-switch")

	dir = ConfigDir()
	if dir != "/tmp/test-cc-switch" {
		t.Errorf("expected /tmp/test-cc-switch, got %s", dir)
	}
}

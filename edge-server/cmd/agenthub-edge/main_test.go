package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/store"
)

func TestBuildConfigDefaultsToMemoryStore(t *testing.T) {
	cfg, err := buildConfig(nil)
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if cfg.Addr != "127.0.0.1:3210" {
		t.Fatalf("Addr = %q, want default listen address", cfg.Addr)
	}
	if cfg.StoreFile != "" {
		t.Fatalf("StoreFile = %q, want empty", cfg.StoreFile)
	}
	if cfg.StoreBackend != "" {
		t.Fatalf("StoreBackend = %q, want empty", cfg.StoreBackend)
	}
	if cfg.StoreDB != "" {
		t.Fatalf("StoreDB = %q, want empty", cfg.StoreDB)
	}
	if cfg.RunnerProfile != "" {
		t.Fatalf("RunnerProfile = %q, want empty", cfg.RunnerProfile)
	}
	if cfg.RunnerCommand != "" {
		t.Fatalf("RunnerCommand = %q, want empty", cfg.RunnerCommand)
	}
	if cfg.RunnerWorkDir != "" {
		t.Fatalf("RunnerWorkDir = %q, want empty", cfg.RunnerWorkDir)
	}
	if len(cfg.RunnerArgs) != 0 {
		t.Fatalf("RunnerArgs = %#v, want empty", cfg.RunnerArgs)
	}
	if len(cfg.RunnerEnv) != 0 {
		t.Fatalf("RunnerEnv = %#v, want empty", cfg.RunnerEnv)
	}
	if cfg.LocalAuthToken != "" {
		t.Fatalf("LocalAuthToken = %q, want empty", cfg.LocalAuthToken)
	}
	if len(cfg.WorkspaceAllowlist) != 0 {
		t.Fatalf("WorkspaceAllowlist = %#v, want empty", []string(cfg.WorkspaceAllowlist))
	}
}

func TestBuildConfigParsesStoreFile(t *testing.T) {
	cfg, err := buildConfig([]string{
		"--addr", "127.0.0.1:4321",
		"--store-file", "edge-store.json",
		"--runner-command", "claude",
		"--runner-workdir", "workspace",
		"--runner-arg", "--mock",
		"--runner-arg", "--addr=127.0.0.1:0",
		"--runner-env", "AGENTHUB_PROFILE_RUN={{run.id}}",
		"--runner-env", "AGENTHUB_PROFILE_THREAD={{run.threadId}}",
	})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if cfg.Addr != "127.0.0.1:4321" {
		t.Fatalf("Addr = %q, want parsed address", cfg.Addr)
	}
	if cfg.StoreFile != "edge-store.json" {
		t.Fatalf("StoreFile = %q, want parsed path", cfg.StoreFile)
	}
	if cfg.RunnerCommand != "claude" {
		t.Fatalf("RunnerCommand = %q, want parsed command", cfg.RunnerCommand)
	}
	if cfg.RunnerWorkDir != "workspace" {
		t.Fatalf("RunnerWorkDir = %q, want parsed path", cfg.RunnerWorkDir)
	}
	if got, want := []string(cfg.RunnerArgs), []string{"--mock", "--addr=127.0.0.1:0"}; strings.Join(got, "\x00") != strings.Join(want, "\x00") {
		t.Fatalf("RunnerArgs = %#v, want %#v", got, want)
	}
	if got, want := []string(cfg.RunnerEnv), []string{"AGENTHUB_PROFILE_RUN={{run.id}}", "AGENTHUB_PROFILE_THREAD={{run.threadId}}"}; strings.Join(got, "\x00") != strings.Join(want, "\x00") {
		t.Fatalf("RunnerEnv = %#v, want %#v", got, want)
	}
}

func TestBuildConfigParsesMemoryStoreBackend(t *testing.T) {
	cfg, err := buildConfig([]string{"--store-backend", "memory"})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if cfg.StoreBackend != "memory" {
		t.Fatalf("StoreBackend = %q, want memory", cfg.StoreBackend)
	}
}

func TestBuildConfigParsesFileStoreBackend(t *testing.T) {
	cfg, err := buildConfig([]string{
		"--store-backend", "file",
		"--store-file", "edge-store.json",
	})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if cfg.StoreBackend != "file" {
		t.Fatalf("StoreBackend = %q, want file", cfg.StoreBackend)
	}
	if cfg.StoreFile != "edge-store.json" {
		t.Fatalf("StoreFile = %q, want edge-store.json", cfg.StoreFile)
	}
}

func TestBuildConfigParsesSQLiteStoreBackend(t *testing.T) {
	cfg, err := buildConfig([]string{
		"--store-backend", "sqlite",
		"--store-db", "edge-store.db",
	})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if cfg.StoreBackend != "sqlite" {
		t.Fatalf("StoreBackend = %q, want sqlite", cfg.StoreBackend)
	}
	if cfg.StoreDB != "edge-store.db" {
		t.Fatalf("StoreDB = %q, want edge-store.db", cfg.StoreDB)
	}
}

func TestBuildConfigParsesStoreReadiness(t *testing.T) {
	cfg, err := buildConfig([]string{
		"--store-readiness",
		"--store-backend", "sqlite",
		"--store-db", "edge-store.db",
	})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if !cfg.StoreReadiness {
		t.Fatal("StoreReadiness = false, want true")
	}
	if cfg.StoreBackend != "sqlite" || cfg.StoreDB != "edge-store.db" {
		t.Fatalf("store config = backend %q db %q, want sqlite edge-store.db", cfg.StoreBackend, cfg.StoreDB)
	}
}

func TestBuildConfigRejectsStoreReadinessWithoutSQLite(t *testing.T) {
	_, err := buildConfig([]string{"--store-readiness", "--store-backend", "memory"})
	if err == nil || !strings.Contains(err.Error(), "--store-readiness requires --store-backend sqlite") {
		t.Fatalf("buildConfig error = %v, want store-readiness sqlite requirement", err)
	}
}

func TestBuildConfigRejectsInvalidStoreBackend(t *testing.T) {
	_, err := buildConfig([]string{"--store-backend", "postgres"})
	if err == nil || !strings.Contains(err.Error(), "supported values: memory, file, sqlite") {
		t.Fatalf("buildConfig error = %v, want supported backend list", err)
	}
}

func TestBuildConfigRejectsMemoryStoreWithFile(t *testing.T) {
	_, err := buildConfig([]string{
		"--store-backend", "memory",
		"--store-file", "edge-store.json",
	})
	if err == nil || !strings.Contains(err.Error(), "--store-file cannot be combined with --store-backend memory") {
		t.Fatalf("buildConfig error = %v, want memory/file conflict", err)
	}
}

func TestBuildConfigRejectsMemoryStoreWithDB(t *testing.T) {
	_, err := buildConfig([]string{
		"--store-backend", "memory",
		"--store-db", "edge-store.db",
	})
	if err == nil || !strings.Contains(err.Error(), "--store-db cannot be combined with --store-backend memory") {
		t.Fatalf("buildConfig error = %v, want memory/db conflict", err)
	}
}

func TestBuildConfigRejectsFileStoreWithoutFile(t *testing.T) {
	_, err := buildConfig([]string{"--store-backend", "file"})
	if err == nil || !strings.Contains(err.Error(), "--store-backend file requires --store-file") {
		t.Fatalf("buildConfig error = %v, want file path requirement", err)
	}
}

func TestBuildConfigRejectsFileStoreWithDB(t *testing.T) {
	_, err := buildConfig([]string{
		"--store-backend", "file",
		"--store-file", "edge-store.json",
		"--store-db", "edge-store.db",
	})
	if err == nil || !strings.Contains(err.Error(), "--store-db cannot be combined with --store-backend file") {
		t.Fatalf("buildConfig error = %v, want file/db conflict", err)
	}
}

func TestBuildConfigRejectsSQLiteStoreWithoutDB(t *testing.T) {
	_, err := buildConfig([]string{"--store-backend", "sqlite"})
	if err == nil || !strings.Contains(err.Error(), "--store-backend sqlite requires --store-db") {
		t.Fatalf("buildConfig error = %v, want sqlite db requirement", err)
	}
}

func TestBuildConfigRejectsStoreDBWithoutSQLiteBackend(t *testing.T) {
	_, err := buildConfig([]string{"--store-db", "edge-store.db"})
	if err == nil || !strings.Contains(err.Error(), "--store-db requires --store-backend sqlite") {
		t.Fatalf("buildConfig error = %v, want sqlite backend requirement", err)
	}
}

func TestBuildConfigRejectsStoreFileWithSQLiteStore(t *testing.T) {
	_, err := buildConfig([]string{
		"--store-file", "edge-store.json",
		"--store-backend", "sqlite",
		"--store-db", "edge-store.db",
	})
	if err == nil || !strings.Contains(err.Error(), "--store-file cannot be combined with --store-backend sqlite") {
		t.Fatalf("buildConfig error = %v, want store backend conflict", err)
	}
}

func TestBuildConfigParsesWorkspaceAllowlist(t *testing.T) {
	envRootA := filepath.Join(t.TempDir(), "env-a")
	envRootB := filepath.Join(t.TempDir(), "env-b")
	flagRoot := filepath.Join(t.TempDir(), "flag")
	t.Setenv("AGENTHUB_WORKSPACE_ALLOWLIST", envRootA+string(os.PathListSeparator)+envRootB)

	cfg, err := buildConfig([]string{"--workspace-allowlist", flagRoot})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	got := []string(cfg.WorkspaceAllowlist)
	want := []string{envRootA, envRootB, flagRoot}
	if strings.Join(got, "\x00") != strings.Join(want, "\x00") {
		t.Fatalf("WorkspaceAllowlist = %#v, want %#v", got, want)
	}
}

func TestBuildConfigAppliesRunnerProfilePreset(t *testing.T) {
	cfg, err := buildConfig([]string{"--runner-profile", "agenthub-runner-mock"})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if cfg.RunnerProfile != "agenthub-runner-mock" {
		t.Fatalf("RunnerProfile = %q, want preset name", cfg.RunnerProfile)
	}
	// Mock profile no longer sets RunnerCommand — it uses the built-in MockExecutor
	if cfg.RunnerCommand != "" {
		t.Fatalf("RunnerCommand = %q, want empty (mock executor is built-in)", cfg.RunnerCommand)
	}
	if len(cfg.RunnerArgs) != 0 {
		t.Fatalf("RunnerArgs = %#v, want empty", cfg.RunnerArgs)
	}
}

func TestBuildConfigRunnerProfileAllowsCommandOverride(t *testing.T) {
	cfg, err := buildConfig([]string{
		"--runner-profile", "agenthub-runner-mock",
		"--runner-command", "custom-runner",
	})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if cfg.RunnerCommand != "custom-runner" {
		t.Fatalf("RunnerCommand = %q, want custom command", cfg.RunnerCommand)
	}
	if len(cfg.RunnerArgs) != 0 {
		t.Fatalf("RunnerArgs = %#v, want empty", cfg.RunnerArgs)
	}
}

func TestBuildConfigRunnerProfileAppliesClaudeCodePreset(t *testing.T) {
	cfg, err := buildConfig([]string{"--runner-profile", "claude-code"})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if cfg.RunnerCommand != "claude" {
		t.Fatalf("RunnerCommand = %q, want claude", cfg.RunnerCommand)
	}
	if cfg.AgentDefault != "claude-acp" {
		t.Fatalf("AgentDefault = %q, want claude-acp", cfg.AgentDefault)
	}
}

func TestBuildConfigRunnerProfilePreservesUserArgOrder(t *testing.T) {
	cfg, err := buildConfig([]string{
		"--runner-profile", "agenthub-runner-mock",
		"--runner-command", "custom-runner",
		"--runner-arg", "--addr=127.0.0.1:0",
	})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if got, want := []string(cfg.RunnerArgs), []string{"--addr=127.0.0.1:0"}; strings.Join(got, "\x00") != strings.Join(want, "\x00") {
		t.Fatalf("RunnerArgs = %#v, want %#v", got, want)
	}
}

func TestBuildConfigRunnerProfileValidatesUserEnvTemplate(t *testing.T) {
	cfg, err := buildConfig([]string{
		"--runner-profile", "agenthub-runner-mock",
		"--runner-command", "custom-runner",
		"--runner-env", "PROFILE_RUN={{run.id}}",
	})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if got, want := []string(cfg.RunnerEnv), []string{"PROFILE_RUN={{run.id}}"}; strings.Join(got, "\x00") != strings.Join(want, "\x00") {
		t.Fatalf("RunnerEnv = %#v, want %#v", got, want)
	}
}

func TestBuildConfigRunnerProfileRejectsInvalidUserEnvTemplate(t *testing.T) {
	_, err := buildConfig([]string{
		"--runner-profile", "agenthub-runner-mock",
		"--runner-command", "custom-runner",
		"--runner-env", "BAD={{unknown}}",
	})
	if err == nil || !strings.Contains(err.Error(), "--runner-env") || !strings.Contains(err.Error(), "unknown placeholder") {
		t.Fatalf("buildConfig error = %v, want runner env unknown placeholder error", err)
	}
}

func TestBuildConfigRejectsUnknownRunnerProfile(t *testing.T) {
	_, err := buildConfig([]string{"--runner-profile", "missing-profile"})
	if err == nil || !strings.Contains(err.Error(), "unknown --runner-profile") {
		t.Fatalf("buildConfig error = %v, want unknown runner profile error", err)
	}
}

func TestBuildConfigRejectsUnexpectedArguments(t *testing.T) {
	_, err := buildConfig([]string{"unexpected"})
	if err == nil || !strings.Contains(err.Error(), "unexpected positional arguments") {
		t.Fatalf("buildConfig error = %v, want unexpected positional arguments error", err)
	}
}

func TestBuildConfigRejectsRunnerArgsWithoutCommand(t *testing.T) {
	_, err := buildConfig([]string{"--runner-arg", "--mock"})
	if err == nil || !strings.Contains(err.Error(), "--runner-arg requires --runner-command") {
		t.Fatalf("buildConfig error = %v, want runner command requirement", err)
	}
}

func TestBuildConfigRejectsRunnerEnvWithoutCommand(t *testing.T) {
	_, err := buildConfig([]string{"--runner-env", "AGENTHUB_PROFILE_RUN={{run.id}}"})
	if err == nil || !strings.Contains(err.Error(), "--runner-env requires --runner-command") {
		t.Fatalf("buildConfig error = %v, want runner command requirement", err)
	}
}

func TestBuildConfigRejectsInvalidRunnerEnv(t *testing.T) {
	tests := []string{"AGENTHUB_PROFILE_RUN", "=value"}
	for _, value := range tests {
		t.Run(value, func(t *testing.T) {
			_, err := buildConfig([]string{"--runner-command", "claude", "--runner-env", value})
			if err == nil || !strings.Contains(err.Error(), "--runner-env") {
				t.Fatalf("buildConfig error = %v, want runner env validation error", err)
			}
		})
	}
}

func TestBuildConfigRejectsRunnerWorkDirWithoutCommand(t *testing.T) {
	_, err := buildConfig([]string{"--runner-workdir", "workspace"})
	if err == nil || !strings.Contains(err.Error(), "--runner-workdir requires --runner-command") {
		t.Fatalf("buildConfig error = %v, want runner command requirement", err)
	}
}

func TestBuildAdapterRegistryRegistersOrchestrator(t *testing.T) {
	reg := buildAdapterRegistry(config{
		AgentDefault:   "claude-code",
		ClaudeCodePath: "claude",
		AgentModel:     "sonnet",
	})

	if _, ok := reg.Get("claude-code"); !ok {
		t.Fatal("claude-code adapter was not registered")
	}
	if _, ok := reg.Get("codex-acp"); !ok {
		t.Fatal("codex-acp adapter was not registered")
	}
	if _, ok := reg.Get("opencode-acp"); !ok {
		t.Fatal("opencode-acp adapter was not registered")
	}
	orchestrator, ok := reg.Get("orchestrator")
	if !ok {
		t.Fatal("orchestrator adapter was not registered")
	}
	if !orchestrator.Capabilities().SubAgentSpawn {
		t.Fatal("orchestrator SubAgentSpawn = false, want true")
	}
	if got, ok := reg.Default("orchestrator"); !ok || got.Metadata().ID != "orchestrator" {
		t.Fatalf("orchestrator default = %#v, ok=%v", got, ok)
	}
	if got, ok := reg.Default("default"); !ok || got.Metadata().ID != "claude-code" {
		t.Fatalf("default adapter = %#v, ok=%v", got, ok)
	}
}

func TestBuildAdapterRegistrySkipsOrchestratorWithoutClaude(t *testing.T) {
	reg := buildAdapterRegistry(config{})

	if _, ok := reg.Get("orchestrator"); ok {
		t.Fatal("orchestrator adapter registered without Claude Code path")
	}
}

func TestNewStoreFromConfigUsesMemoryStoreByDefault(t *testing.T) {
	repository, err := newStoreFromConfig(config{})
	if err != nil {
		t.Fatalf("newStoreFromConfig returned error: %v", err)
	}
	if _, ok := repository.(*store.Store); !ok {
		t.Fatalf("repository type = %T, want *store.Store", repository)
	}
}

func TestNewStoreFromConfigUsesMemoryStore(t *testing.T) {
	repository, err := newStoreFromConfig(config{StoreBackend: "memory"})
	if err != nil {
		t.Fatalf("newStoreFromConfig returned error: %v", err)
	}
	if _, ok := repository.(*store.Store); !ok {
		t.Fatalf("repository type = %T, want *store.Store", repository)
	}
}

func TestNewStoreFromConfigUsesFileStore(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-store.json")

	repository, err := newStoreFromConfig(config{StoreFile: path})
	if err != nil {
		t.Fatalf("newStoreFromConfig returned error: %v", err)
	}
	fileStore, ok := repository.(*store.FileStore)
	if !ok {
		t.Fatalf("repository type = %T, want *store.FileStore", repository)
	}

	_, _ = fileStore.CreateProject("proj_test", "Test Project", "")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("store file was not written: %v", err)
	}
}

func TestNewStoreFromConfigRejectsFileStoreWithoutFile(t *testing.T) {
	_, err := newStoreFromConfig(config{StoreBackend: "file"})
	if err == nil || !strings.Contains(err.Error(), "--store-backend file requires --store-file") {
		t.Fatalf("newStoreFromConfig error = %v, want file path requirement", err)
	}
}

func TestNewStoreFromConfigUsesSQLiteStore(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-store.db")

	repository, err := newStoreFromConfig(config{StoreBackend: "sqlite", StoreDB: path})
	if err != nil {
		t.Fatalf("newStoreFromConfig returned error: %v", err)
	}
	sqliteStore, ok := repository.(*store.SQLiteStore)
	if !ok {
		t.Fatalf("repository type = %T, want *store.SQLiteStore", repository)
	}
	defer sqliteStore.Close()

	_, _ = sqliteStore.CreateProject("proj_test", "Test Project", "")
	restored, err := store.NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite restored returned error: %v", err)
	}
	defer restored.Close()
	if got := restored.ListProjects(); len(got) != 1 || got[0].ID != "proj_test" {
		t.Fatalf("restored projects = %#v, want proj_test", got)
	}
}

func TestSQLiteDurableObservedFixtureSmoke(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "edge-observed-fixture.db")
	cfg, err := buildConfig([]string{
		"--store-backend", "sqlite",
		"--store-db", dbPath,
	})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	repository, err := newStoreFromConfig(cfg)
	if err != nil {
		t.Fatalf("newStoreFromConfig returned error: %v", err)
	}
	sqliteStore, ok := repository.(*store.SQLiteStore)
	if !ok {
		t.Fatalf("repository type = %T, want *store.SQLiteStore", repository)
	}

	project, err := sqliteStore.CreateProject("proj_observed_fixture", "Observed Fixture Project", "")
	if err != nil {
		t.Fatalf("CreateProject returned error: %v", err)
	}
	thread, err := sqliteStore.CreateThread("thread_observed_fixture", project.ID, "Observed Fixture Thread", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	run, err := sqliteStore.CreateRun("run_observed_fixture", project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	if _, ok := sqliteStore.SetRunStatus(run.ID, "started"); !ok {
		t.Fatalf("SetRunStatus(%s, started) returned false", run.ID)
	}
	item, err := sqliteStore.CreateItem(store.Item{
		ID:        "item_observed_fixture",
		ProjectID: project.ID,
		ThreadID:  thread.ID,
		RunID:     run.ID,
		Type:      "run",
		Status:    "observed",
		Content:   "FixtureOnlyObserved: Edge SQLite durable alpha smoke",
	})
	if err != nil {
		t.Fatalf("CreateItem returned error: %v", err)
	}
	if _, err := sqliteStore.PinThreadItem(thread.ID, item.ID, "durable-smoke"); err != nil {
		t.Fatalf("PinThreadItem returned error: %v", err)
	}
	sqliteStore.Close()

	assertObservedSQLiteRows(t, dbPath, map[string]int{
		"project": 1,
		"thread":  1,
		"run":     1,
		"item":    1,
		"pin":     1,
	})
	assertObservedSQLiteRunProjection(t, dbPath, run.ID, project.ID, thread.ID, "started")

	deleteObservedSQLiteSnapshot(t, dbPath)
	reopenedRepository, err := newStoreFromConfig(cfg)
	if err != nil {
		t.Fatalf("newStoreFromConfig restore returned error: %v", err)
	}
	reopened, ok := reopenedRepository.(*store.SQLiteStore)
	if !ok {
		t.Fatalf("restored repository type = %T, want *store.SQLiteStore", reopenedRepository)
	}
	defer reopened.Close()

	if got, ok := reopened.GetThread(thread.ID); !ok || got.ProjectID != project.ID || got.Title != thread.Title {
		t.Fatalf("restored thread = %#v ok=%v, want project/title preserved", got, ok)
	}
	if got, ok := reopened.GetRun(run.ID); !ok || got.ThreadID != thread.ID || got.Status != "started" || got.StartedAt == "" {
		t.Fatalf("restored run = %#v ok=%v, want started fixture run", got, ok)
	}
	if got := reopened.ListThreadItems(thread.ID); len(got) != 1 || got[0].ID != item.ID || got[0].Content != item.Content {
		t.Fatalf("restored thread items = %#v, want observed fixture item", got)
	}
	if got := reopened.ListThreadPins(thread.ID); len(got) != 1 || got[0].ItemID != item.ID || got[0].PinnedBy != "durable-smoke" {
		t.Fatalf("restored pins = %#v, want observed fixture pin", got)
	}
}

func TestRunStoreReadinessPrintsSQLiteManifest(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "edge-readiness-report.db")
	repository, err := store.NewSQLite(dbPath)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}
	project, err := repository.CreateProject("proj_readiness_report", "Readiness Report", "")
	if err != nil {
		t.Fatalf("CreateProject returned error: %v", err)
	}
	thread, err := repository.CreateThread("thread_readiness_report", project.ID, "Readiness Report Thread", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	run, err := repository.CreateRun("run_readiness_report", project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	if _, ok := repository.SetRunStatus(run.ID, "started"); !ok {
		t.Fatalf("SetRunStatus(%s, started) returned false", run.ID)
	}
	repository.Close()

	var out bytes.Buffer
	err = runStoreReadiness(config{
		StoreBackend:   "sqlite",
		StoreDB:        dbPath,
		StoreReadiness: true,
	}, &out)
	if err != nil {
		t.Fatalf("runStoreReadiness returned error: %v", err)
	}

	var report struct {
		Path                   string         `json:"path"`
		IntegrityCheck         string         `json:"integrity_check"`
		LatestMigrationVersion int            `json:"latest_migration_version"`
		RowCounts              map[string]int `json:"row_counts"`
		ProjectionCounts       map[string]int `json:"projection_counts"`
	}
	if err := json.Unmarshal(out.Bytes(), &report); err != nil {
		t.Fatalf("readiness JSON was not valid: %v\n%s", err, out.String())
	}
	if report.Path != dbPath {
		t.Fatalf("Path = %q, want %q", report.Path, dbPath)
	}
	if report.IntegrityCheck != "ok" {
		t.Fatalf("IntegrityCheck = %q, want ok", report.IntegrityCheck)
	}
	if report.LatestMigrationVersion == 0 {
		t.Fatal("LatestMigrationVersion = 0, want applied migrations")
	}
	if report.RowCounts["project"] != 1 || report.RowCounts["thread"] != 1 || report.RowCounts["run"] != 1 {
		t.Fatalf("RowCounts = %#v, want project/thread/run rows", report.RowCounts)
	}
	if report.ProjectionCounts["edge_runs"] != 1 {
		t.Fatalf("edge_runs projection count = %d, want 1", report.ProjectionCounts["edge_runs"])
	}
}

func TestRunStoreReadinessBlocksStaleSQLiteMigrationState(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "edge-readiness-blocked.db")
	repository, err := store.NewSQLite(dbPath)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}
	repository.Close()

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open sqlite db returned error: %v", err)
	}
	if _, err := db.Exec(`DELETE FROM agenthub_sqlite_migrations WHERE version = ?`, store.LatestSQLiteMigrationVersion()); err != nil {
		_ = db.Close()
		t.Fatalf("delete latest migration returned error: %v", err)
	}
	_ = db.Close()

	var out bytes.Buffer
	err = runStoreReadiness(config{
		StoreBackend:   "sqlite",
		StoreDB:        dbPath,
		StoreReadiness: true,
	}, &out)
	if err == nil || !strings.Contains(err.Error(), "blocked") {
		t.Fatalf("runStoreReadiness error = %v, want blocked readiness error", err)
	}

	var manifest struct {
		Schema                   string `json:"schema"`
		Status                   string `json:"status"`
		MigrationStatus          string `json:"migration_status"`
		ExpectedMigrationVersion int    `json:"expected_migration_version"`
		MissingMigrationVersions []int  `json:"missing_migration_versions"`
	}
	if err := json.Unmarshal(out.Bytes(), &manifest); err != nil {
		t.Fatalf("blocked readiness JSON was not valid: %v\n%s", err, out.String())
	}
	if manifest.Schema != store.SQLiteReadinessManifestSchema {
		t.Fatalf("Schema = %q, want %q", manifest.Schema, store.SQLiteReadinessManifestSchema)
	}
	if manifest.Status != "blocked" || manifest.MigrationStatus != "behind" {
		t.Fatalf("manifest status = %q migration = %q, want blocked/behind", manifest.Status, manifest.MigrationStatus)
	}
	if got := manifest.MissingMigrationVersions; len(got) != 1 || got[0] != manifest.ExpectedMigrationVersion {
		t.Fatalf("missing migrations = %v, want latest %d", got, manifest.ExpectedMigrationVersion)
	}
}

func assertObservedSQLiteRows(t *testing.T, dbPath string, want map[string]int) {
	t.Helper()
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open sqlite db returned error: %v", err)
	}
	defer db.Close()

	for kind, wantCount := range want {
		var got int
		if err := db.QueryRow(`SELECT COUNT(*) FROM agenthub_store_rows WHERE row_kind = ?`, kind).Scan(&got); err != nil {
			t.Fatalf("query agenthub_store_rows kind %s returned error: %v", kind, err)
		}
		if got != wantCount {
			t.Fatalf("agenthub_store_rows kind %s count = %d, want %d", kind, got, wantCount)
		}
	}
}

func assertObservedSQLiteRunProjection(t *testing.T, dbPath, runID, workspaceID, threadID, status string) {
	t.Helper()
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open sqlite db returned error: %v", err)
	}
	defer db.Close()

	var gotWorkspaceID, gotThreadID, gotStatus, gotStartedAt string
	if err := db.QueryRow(
		`SELECT workspace_id, thread_id, status, started_at FROM edge_runs WHERE run_id = ?`,
		runID,
	).Scan(&gotWorkspaceID, &gotThreadID, &gotStatus, &gotStartedAt); err != nil {
		t.Fatalf("query edge_runs returned error: %v", err)
	}
	if gotWorkspaceID != workspaceID || gotThreadID != threadID || gotStatus != status || gotStartedAt == "" {
		t.Fatalf("edge_runs projection = workspace=%q thread=%q status=%q started=%q, want workspace=%q thread=%q status=%q with started_at", gotWorkspaceID, gotThreadID, gotStatus, gotStartedAt, workspaceID, threadID, status)
	}
}

func deleteObservedSQLiteSnapshot(t *testing.T, dbPath string) {
	t.Helper()
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open sqlite db returned error: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`DELETE FROM agenthub_store_snapshots`); err != nil {
		t.Fatalf("delete agenthub_store_snapshots returned error: %v", err)
	}
}

func TestNewStoreFromConfigReturnsSQLiteStoreErrors(t *testing.T) {
	dir := t.TempDir()
	blocker := filepath.Join(dir, "blocker")
	if err := os.WriteFile(blocker, []byte("not a directory"), 0o644); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}
	path := filepath.Join(blocker, "edge-store.db")

	_, err := newStoreFromConfig(config{StoreBackend: "sqlite", StoreDB: path})
	if err == nil {
		t.Fatal("newStoreFromConfig returned nil error for invalid sqlite store")
	}
	if !strings.Contains(err.Error(), "open sqlite store") {
		t.Fatalf("newStoreFromConfig error = %v, want clear sqlite store error", err)
	}
}

func TestNewStoreFromConfigReturnsFileStoreErrors(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-store.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o644); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}

	_, err := newStoreFromConfig(config{StoreFile: path})
	if err == nil {
		t.Fatal("newStoreFromConfig returned nil error for invalid file store")
	}
	if !strings.Contains(err.Error(), "open store file") || !strings.Contains(err.Error(), "decode store snapshot") {
		t.Fatalf("newStoreFromConfig error = %v, want clear store file decode error", err)
	}
}

// --- buildAdapterRegistry tests ---

func TestBuildAdapterRegistryEmpty(t *testing.T) {
	reg := buildAdapterRegistry(config{})
	if reg == nil {
		t.Fatal("buildAdapterRegistry should not return nil")
	}
	adapters := reg.List()
	if len(adapters) != 3 {
		t.Fatalf("expected 3 ACP adapters (claude/codex/opencode) with empty config, got %d", len(adapters))
	}
}

func TestBuildAdapterRegistryWithClaudeCode(t *testing.T) {
	reg := buildAdapterRegistry(config{
		ClaudeCodePath: "claude",
		AgentModel:     "sonnet",
	})
	if reg == nil {
		t.Fatal("buildAdapterRegistry should not return nil")
	}
	a, ok := reg.Get("claude-code")
	if !ok {
		t.Fatal("claude-code adapter should be registered")
	}
	if a.Metadata().ID != "claude-code" {
		t.Fatalf("adapter ID = %q, want claude-code", a.Metadata().ID)
	}
}

func TestBuildAdapterRegistryWithCodexACP(t *testing.T) {
	reg := buildAdapterRegistry(config{})
	if reg == nil {
		t.Fatal("buildAdapterRegistry should not return nil")
	}
	a, ok := reg.Get("codex-acp")
	if !ok {
		t.Fatal("codex-acp adapter should be registered")
	}
	if a.Metadata().ID != "codex-acp" {
		t.Fatalf("adapter ID = %q, want codex-acp", a.Metadata().ID)
	}
}

func TestBuildAdapterRegistryWithOpenCodeACP(t *testing.T) {
	reg := buildAdapterRegistry(config{})
	if reg == nil {
		t.Fatal("buildAdapterRegistry should not return nil")
	}
	a, ok := reg.Get("opencode-acp")
	if !ok {
		t.Fatal("opencode-acp adapter should be registered")
	}
	if a.Metadata().ID != "opencode-acp" {
		t.Fatalf("adapter ID = %q, want opencode-acp", a.Metadata().ID)
	}
}

func TestBuildAdapterRegistryAllAdapters(t *testing.T) {
	reg := buildAdapterRegistry(config{
		ClaudeCodePath: "claude",
	})
	adapters := reg.List()
	if len(adapters) != 5 {
		t.Fatalf("expected 5 adapters, got %d", len(adapters))
	}
}

// --- applyRunnerProfile additional profile tests ---

func TestBuildConfigRunnerProfileAppliesCodexPreset(t *testing.T) {
	cfg, err := buildConfig([]string{"--runner-profile", "codex"})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if cfg.RunnerCommand != "" {
		t.Fatalf("RunnerCommand = %q, want empty (codex is ACP-only, must not run the claude binary)", cfg.RunnerCommand)
	}
	if cfg.AgentDefault != "codex-acp" {
		t.Fatalf("AgentDefault = %q, want codex-acp", cfg.AgentDefault)
	}
}

func TestBuildConfigRunnerProfileAppliesOpenCodePreset(t *testing.T) {
	cfg, err := buildConfig([]string{"--runner-profile", "opencode"})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if cfg.RunnerCommand != "" {
		t.Fatalf("RunnerCommand = %q, want empty (opencode is ACP-only, must not run the claude binary)", cfg.RunnerCommand)
	}
	if cfg.AgentDefault != "opencode-acp" {
		t.Fatalf("AgentDefault = %q, want opencode-acp", cfg.AgentDefault)
	}
}

func TestBuildConfigRunnerProfileCodexPreservesCommandOverride(t *testing.T) {
	cfg, err := buildConfig([]string{
		"--runner-profile", "codex",
		"--runner-command", "custom-codex",
		"--agent-default", "custom-agent",
	})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if cfg.RunnerCommand != "custom-codex" {
		t.Fatalf("RunnerCommand = %q, want custom-codex", cfg.RunnerCommand)
	}
	if cfg.AgentDefault != "custom-agent" {
		t.Fatalf("AgentDefault = %q, want custom-agent", cfg.AgentDefault)
	}
}

func TestBuildConfigRunnerProfileOpenCodePreservesCommandOverride(t *testing.T) {
	cfg, err := buildConfig([]string{
		"--runner-profile", "opencode",
		"--runner-command", "custom-opencode",
		"--agent-default", "custom-agent",
	})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if cfg.RunnerCommand != "custom-opencode" {
		t.Fatalf("RunnerCommand = %q, want custom-opencode", cfg.RunnerCommand)
	}
	if cfg.AgentDefault != "custom-agent" {
		t.Fatalf("AgentDefault = %q, want custom-agent", cfg.AgentDefault)
	}
}

func TestRepeatedString(t *testing.T) {
	var rs repeatedString
	if rs.String() != "[]" {
		t.Fatalf("String() = %q, want []", rs.String())
	}

	if err := rs.Set("first"); err != nil {
		t.Fatalf("Set: %v", err)
	}
	if err := rs.Set("second"); err != nil {
		t.Fatalf("Set: %v", err)
	}

	if got := rs.String(); got != "[first second]" {
		t.Fatalf("String() = %q, want [first second]", got)
	}

	if len(rs) != 2 {
		t.Fatalf("len = %d, want 2", len(rs))
	}
	if rs[0] != "first" || rs[1] != "second" {
		t.Fatalf("values = %v, want [first second]", []string(rs))
	}
}

func TestBuildConfigAgentFlags(t *testing.T) {
	cfg, err := buildConfig([]string{
		"--claude-code-path", "/usr/local/bin/claude",
		"--codex-acp-path", "/usr/local/bin/npx",
		"--opencode-acp-path", "/usr/local/bin/opencode",
		"--agent-model", "claude-sonnet-4-6",
		"--agent-default", "claude-acp",
	})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}

	if cfg.ClaudeCodePath != "/usr/local/bin/claude" {
		t.Fatalf("ClaudeCodePath = %q", cfg.ClaudeCodePath)
	}
	if cfg.CodexACPPath != "/usr/local/bin/npx" {
		t.Fatalf("CodexACPPath = %q", cfg.CodexACPPath)
	}
	if cfg.OpencodeACPPath != "/usr/local/bin/opencode" {
		t.Fatalf("OpencodeACPPath = %q", cfg.OpencodeACPPath)
	}
	if cfg.AgentModel != "claude-sonnet-4-6" {
		t.Fatalf("AgentModel = %q", cfg.AgentModel)
	}
	if cfg.AgentDefault != "claude-acp" {
		t.Fatalf("AgentDefault = %q", cfg.AgentDefault)
	}
}

func TestBuildConfigSkillsDirs(t *testing.T) {
	cfg, err := buildConfig([]string{
		"--skills-dir", "first",
		"--skills-dir", "second",
	})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	if len(cfg.SkillsDirs) != 2 || cfg.SkillsDirs[0] != "first" || cfg.SkillsDirs[1] != "second" {
		t.Fatalf("SkillsDirs = %#v, want [first second]", []string(cfg.SkillsDirs))
	}
}

// --- Environment variable fallback tests ---

func TestBuildConfigEnvVarAddr(t *testing.T) {
	t.Setenv("AGENTHUB_ADDR", "127.0.0.1:4321")
	cfg, err := buildConfig(nil)
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	if cfg.Addr != "127.0.0.1:4321" {
		t.Fatalf("Addr = %q, want 127.0.0.1:4321 from env", cfg.Addr)
	}
}

func TestBuildConfigRejectsNonLoopbackAddr(t *testing.T) {
	tests := []struct {
		name string
		args []string
		env  string
	}{
		{"flag wildcard", []string{"--addr", ":4321"}, ""},
		{"env wildcard", nil, ":4321"},
		{"ipv4 wildcard", []string{"--addr", "0.0.0.0:4321"}, ""},
		{"ipv6 wildcard", []string{"--addr", "[::]:4321"}, ""},
		{"lan ip", []string{"--addr", "192.168.1.10:4321"}, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.env != "" {
				t.Setenv("AGENTHUB_ADDR", tt.env)
			}
			if _, err := buildConfig(tt.args); err == nil {
				t.Fatalf("buildConfig(%v) returned nil error", tt.args)
			}
		})
	}
}

func TestBuildConfigEnvVarStoreFile(t *testing.T) {
	t.Setenv("AGENTHUB_STORE_FILE", "env-store.json")
	cfg, err := buildConfig(nil)
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	if cfg.StoreFile != "env-store.json" {
		t.Fatalf("StoreFile = %q, want env-store.json from env", cfg.StoreFile)
	}
}

func TestBuildConfigEnvVarMemoryStore(t *testing.T) {
	t.Setenv("AGENTHUB_STORE_BACKEND", "memory")
	cfg, err := buildConfig(nil)
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	if cfg.StoreBackend != "memory" {
		t.Fatalf("StoreBackend = %q, want memory from env", cfg.StoreBackend)
	}
}

func TestBuildConfigEnvVarFileStore(t *testing.T) {
	t.Setenv("AGENTHUB_STORE_BACKEND", "file")
	t.Setenv("AGENTHUB_STORE_FILE", "env-store.json")
	cfg, err := buildConfig(nil)
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	if cfg.StoreBackend != "file" {
		t.Fatalf("StoreBackend = %q, want file from env", cfg.StoreBackend)
	}
	if cfg.StoreFile != "env-store.json" {
		t.Fatalf("StoreFile = %q, want env-store.json from env", cfg.StoreFile)
	}
}

func TestBuildConfigEnvVarSQLiteStore(t *testing.T) {
	t.Setenv("AGENTHUB_STORE_BACKEND", "sqlite")
	t.Setenv("AGENTHUB_STORE_DB", "env-store.db")
	cfg, err := buildConfig(nil)
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	if cfg.StoreBackend != "sqlite" {
		t.Fatalf("StoreBackend = %q, want sqlite from env", cfg.StoreBackend)
	}
	if cfg.StoreDB != "env-store.db" {
		t.Fatalf("StoreDB = %q, want env-store.db from env", cfg.StoreDB)
	}
}

func TestBuildConfigEnvVarRunnerProfile(t *testing.T) {
	t.Setenv("AGENTHUB_RUNNER_PROFILE", "claude-code")
	cfg, err := buildConfig(nil)
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	if cfg.RunnerCommand != "claude" {
		t.Fatalf("RunnerCommand = %q, want claude from claude-code profile via env", cfg.RunnerCommand)
	}
	if cfg.AgentDefault != "claude-acp" {
		t.Fatalf("AgentDefault = %q, want claude-acp from env profile", cfg.AgentDefault)
	}
}

func TestBuildConfigEnvVarRunnerCommand(t *testing.T) {
	t.Setenv("AGENTHUB_RUNNER_COMMAND", "my-runner")
	t.Setenv("AGENTHUB_RUNNER_WORKDIR", "my-workspace")
	cfg, err := buildConfig(nil)
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	if cfg.RunnerCommand != "my-runner" {
		t.Fatalf("RunnerCommand = %q, want my-runner from env", cfg.RunnerCommand)
	}
	if cfg.RunnerWorkDir != "my-workspace" {
		t.Fatalf("RunnerWorkDir = %q, want my-workspace from env", cfg.RunnerWorkDir)
	}
}

func TestBuildConfigEnvVarAgentFlags(t *testing.T) {
	t.Setenv("AGENTHUB_CLAUDE_CODE_PATH", "/env/claude")
	t.Setenv("AGENTHUB_CODEX_ACP_PATH", "/env/npx")
	t.Setenv("AGENTHUB_OPENCODE_ACP_PATH", "/env/opencode")
	t.Setenv("AGENTHUB_AGENT_MODEL", "env-model")
	t.Setenv("AGENTHUB_AGENT_DEFAULT", "codex-acp")
	cfg, err := buildConfig(nil)
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	if cfg.ClaudeCodePath != "/env/claude" {
		t.Fatalf("ClaudeCodePath = %q, want /env/claude", cfg.ClaudeCodePath)
	}
	if cfg.CodexACPPath != "/env/npx" {
		t.Fatalf("CodexACPPath = %q, want /env/npx", cfg.CodexACPPath)
	}
	if cfg.OpencodeACPPath != "/env/opencode" {
		t.Fatalf("OpencodeACPPath = %q, want /env/opencode", cfg.OpencodeACPPath)
	}
	if cfg.AgentModel != "env-model" {
		t.Fatalf("AgentModel = %q, want env-model", cfg.AgentModel)
	}
	if cfg.AgentDefault != "codex-acp" {
		t.Fatalf("AgentDefault = %q, want codex-acp", cfg.AgentDefault)
	}
}

func TestBuildConfigParsesLocalAuthTokenFromFlag(t *testing.T) {
	cfg, err := buildConfig([]string{"--local-auth-token", " edge-secret "})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	if cfg.LocalAuthToken != "edge-secret" {
		t.Fatalf("LocalAuthToken = %q, want trimmed token", cfg.LocalAuthToken)
	}
}

func TestBuildConfigParsesEdgeDeviceID(t *testing.T) {
	tests := []struct {
		name string
		env  string
		args []string
		want string
	}{
		{
			name: "flag",
			env:  " env-edge-device ",
			args: []string{"--edge-device-id", " flag-edge-device "},
			want: "flag-edge-device",
		},
		{
			name: "env",
			env:  " env-edge-device ",
			want: "env-edge-device",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("AGENTHUB_EDGE_DEVICE_ID", tt.env)
			cfg, err := buildConfig(tt.args)
			if err != nil {
				t.Fatalf("buildConfig returned error: %v", err)
			}
			if got := cfg.EdgeDeviceID; got != tt.want {
				t.Fatalf("EdgeDeviceID = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestBuildConfigRejectsHubJWTSecretWithoutEdgeDeviceID(t *testing.T) {
	_, err := buildConfig([]string{"--hub-jwt-secret", " hub-secret "})
	if err == nil || !strings.Contains(err.Error(), "--hub-jwt-secret requires --edge-device-id") {
		t.Fatalf("buildConfig error = %v, want hub jwt edge device requirement", err)
	}
}

func TestBuildConfigParsesAllowedOriginsFromFlag(t *testing.T) {
	cfg, err := buildConfig([]string{
		"--allowed-origin", " https://app.example.com ",
		"--allowed-origin", "http://edge.example.com:3210",
	})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	want := []string{"https://app.example.com", "http://edge.example.com:3210"}
	if len(cfg.AllowedOrigins) != len(want) {
		t.Fatalf("AllowedOrigins = %v, want %v", []string(cfg.AllowedOrigins), want)
	}
	for i := range want {
		if cfg.AllowedOrigins[i] != want[i] {
			t.Fatalf("AllowedOrigins[%d] = %q, want %q", i, cfg.AllowedOrigins[i], want[i])
		}
	}
}

func TestBuildConfigEnvVarAllowedOrigins(t *testing.T) {
	t.Setenv("AGENTHUB_ALLOWED_ORIGINS", "https://app.example.com,http://edge.example.com:3210")
	cfg, err := buildConfig(nil)
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	want := []string{"https://app.example.com", "http://edge.example.com:3210"}
	if len(cfg.AllowedOrigins) != len(want) {
		t.Fatalf("AllowedOrigins = %v, want %v", []string(cfg.AllowedOrigins), want)
	}
	for i := range want {
		if cfg.AllowedOrigins[i] != want[i] {
			t.Fatalf("AllowedOrigins[%d] = %q, want %q", i, cfg.AllowedOrigins[i], want[i])
		}
	}
}

func TestBuildConfigEnvVarLocalAuthToken(t *testing.T) {
	t.Setenv("AGENTHUB_EDGE_AUTH_TOKEN", "env-edge-secret")
	cfg, err := buildConfig(nil)
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	if cfg.LocalAuthToken != "env-edge-secret" {
		t.Fatalf("LocalAuthToken = %q, want env token", cfg.LocalAuthToken)
	}
}

func TestBuildConfigFlagOverridesEnvVar(t *testing.T) {
	t.Setenv("AGENTHUB_ADDR", "127.0.0.1:9999")
	cfg, err := buildConfig([]string{"--addr", "127.0.0.1:4321"})
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	if cfg.Addr != "127.0.0.1:4321" {
		t.Fatalf("Addr = %q, want 127.0.0.1:4321 (flag should override env)", cfg.Addr)
	}
}

func TestBuildConfigEnvVarDefaultWhenNotSet(t *testing.T) {
	// No env vars set -- defaults should apply
	cfg, err := buildConfig(nil)
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	if cfg.Addr != "127.0.0.1:3210" {
		t.Fatalf("Addr = %q, want 127.0.0.1:3210", cfg.Addr)
	}
	if cfg.ClaudeCodePath != "claude" {
		t.Fatalf("ClaudeCodePath = %q, want claude", cfg.ClaudeCodePath)
	}
	if cfg.CodexACPPath != "" {
		t.Fatalf("CodexACPPath = %q, want empty (platform-native npx fallback)", cfg.CodexACPPath)
	}
	if cfg.OpencodeACPPath != "" {
		t.Fatalf("OpencodeACPPath = %q, want empty (opencode fallback)", cfg.OpencodeACPPath)
	}
}

func TestBuildConfigEnvVarEmptyStringNotUsed(t *testing.T) {
	// Empty env var should fall through to default
	t.Setenv("AGENTHUB_ADDR", "")
	t.Setenv("AGENTHUB_STORE_FILE", "")
	cfg, err := buildConfig(nil)
	if err != nil {
		t.Fatalf("buildConfig returned error: %v", err)
	}
	if cfg.Addr != "127.0.0.1:3210" {
		t.Fatalf("Addr = %q, want default when env is empty", cfg.Addr)
	}
	if cfg.StoreFile != "" {
		t.Fatalf("StoreFile = %q, want empty when env is empty", cfg.StoreFile)
	}
}

// --- pure utility function behavioral tests ---

func TestParseDurationOrDefault(t *testing.T) {
	tests := []struct {
		name  string
		input string
		def   string
		want  string
	}{
		{"30s literal", "30s", "5m", "30s"},
		{"5m literal", "5m", "1s", "5m0s"},
		{"1h30m", "1h30m", "1s", "1h30m0s"},
		{"empty returns default", "", "5m", "5m0s"},
		{"invalid returns default", "bad", "5m", "5m0s"},
		{"negative duration", "-1s", "5s", "-1s"},
		{"whitespace only returns default", "  ", "5m", "5m0s"},
		{"zero duration", "0s", "5m", "0s"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			def, err := time.ParseDuration(tt.def)
			if err != nil {
				t.Fatalf("bad test data: cannot parse default %q: %v", tt.def, err)
			}
			got := parseDurationOrDefault(tt.input, def)
			want, err := time.ParseDuration(tt.want)
			if err != nil {
				t.Fatalf("bad test data: cannot parse want %q: %v", tt.want, err)
			}
			if got != want {
				t.Fatalf("parseDurationOrDefault(%q, %v) = %v, want %v", tt.input, def, got, want)
			}
		})
	}
}

func TestResolveSDKAPIKey(t *testing.T) {
	t.Run("ANTHROPIC_API_KEY set, value=env", func(t *testing.T) {
		t.Setenv("ANTHROPIC_API_KEY", "sk-ant-test-key")
		got := resolveSDKAPIKey("env", "ANTHROPIC_API_KEY")
		if got != "sk-ant-test-key" {
			t.Fatalf("resolveSDKAPIKey(env, ANTHROPIC_API_KEY) = %q, want sk-ant-test-key", got)
		}
	})

	t.Run("ANTHROPIC_API_KEY set, value=ENV (case-insensitive)", func(t *testing.T) {
		t.Setenv("ANTHROPIC_API_KEY", "sk-ant-test-key")
		got := resolveSDKAPIKey("ENV", "ANTHROPIC_API_KEY")
		if got != "sk-ant-test-key" {
			t.Fatalf("resolveSDKAPIKey(ENV, ANTHROPIC_API_KEY) = %q, want sk-ant-test-key", got)
		}
	})

	t.Run("ANTHROPIC_API_KEY set, value empty → reads env", func(t *testing.T) {
		t.Setenv("ANTHROPIC_API_KEY", "sk-ant-test-key")
		got := resolveSDKAPIKey("", "ANTHROPIC_API_KEY")
		if got != "sk-ant-test-key" {
			t.Fatalf("resolveSDKAPIKey(\"\", ANTHROPIC_API_KEY) = %q, want sk-ant-test-key", got)
		}
	})

	t.Run("OPENAI_API_KEY set, value=env", func(t *testing.T) {
		t.Setenv("OPENAI_API_KEY", "sk-openai-test-key")
		got := resolveSDKAPIKey("env", "OPENAI_API_KEY")
		if got != "sk-openai-test-key" {
			t.Fatalf("resolveSDKAPIKey(env, OPENAI_API_KEY) = %q, want sk-openai-test-key", got)
		}
	})

	t.Run("neither env var set, value=env → returns empty", func(t *testing.T) {
		got := resolveSDKAPIKey("env", "ANTHROPIC_API_KEY")
		if got != "" {
			t.Fatalf("resolveSDKAPIKey(env, ANTHROPIC_API_KEY) with no env = %q, want empty", got)
		}
	})

	t.Run("neither env var set, value empty → returns empty", func(t *testing.T) {
		got := resolveSDKAPIKey("", "OPENAI_API_KEY")
		if got != "" {
			t.Fatalf("resolveSDKAPIKey(\"\", OPENAI_API_KEY) with no env = %q, want empty", got)
		}
	})

	t.Run("literal value returned directly", func(t *testing.T) {
		t.Setenv("ANTHROPIC_API_KEY", "sk-should-not-read")
		got := resolveSDKAPIKey("direct-key-value", "ANTHROPIC_API_KEY")
		if got != "direct-key-value" {
			t.Fatalf("resolveSDKAPIKey(direct-key-value, ...) = %q, want direct-key-value", got)
		}
	})
}

func TestSplitPathList(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  []string
	}{
		{
			name:  "empty string",
			input: "",
			want:  nil,
		},
		{
			name:  "single path",
			input: "/a/b",
			want:  []string{"/a/b"},
		},
		{
			name:  "OS path list separator",
			input: "/a/b" + string(os.PathListSeparator) + "/c/d",
			want:  []string{"/a/b", "/c/d"},
		},
		{
			name:  "trims whitespace",
			input: " /a/b " + string(os.PathListSeparator) + " /c/d ",
			want:  []string{"/a/b", "/c/d"},
		},
		{
			name:  "skips empty parts",
			input: "/a/b" + string(os.PathListSeparator) + string(os.PathListSeparator) + "/c/d",
			want:  []string{"/a/b", "/c/d"},
		},
		{
			name:  "trailing separator",
			input: "/a/b" + string(os.PathListSeparator),
			want:  []string{"/a/b"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := splitPathList(tt.input)
			if len(got) == 0 && len(tt.want) == 0 {
				return // both nil/empty
			}
			if strings.Join(got, "\x00") != strings.Join(tt.want, "\x00") {
				t.Fatalf("splitPathList(%q) = %#v, want %#v", tt.input, got, tt.want)
			}
		})
	}
}

func TestSplitCommaList(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  []string
	}{
		{
			name:  "empty string",
			input: "",
			want:  nil,
		},
		{
			name:  "single value",
			input: "v1",
			want:  []string{"v1"},
		},
		{
			name:  "comma separated",
			input: "v1,v2,v3",
			want:  []string{"v1", "v2", "v3"},
		},
		{
			name:  "trims whitespace",
			input: " v1 , v2 , v3 ",
			want:  []string{"v1", "v2", "v3"},
		},
		{
			name:  "skips empty parts",
			input: "v1,,v3",
			want:  []string{"v1", "v3"},
		},
		{
			name:  "trailing comma",
			input: "v1,v2,",
			want:  []string{"v1", "v2"},
		},
		{
			name:  "leading comma",
			input: ",v1,v2",
			want:  []string{"v1", "v2"},
		},
		{
			name:  "only commas",
			input: ",,",
			want:  nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := splitCommaList(tt.input)
			if len(got) == 0 && len(tt.want) == 0 {
				return
			}
			if strings.Join(got, "\x00") != strings.Join(tt.want, "\x00") {
				t.Fatalf("splitCommaList(%q) = %#v, want %#v", tt.input, got, tt.want)
			}
		})
	}
}

func TestTrimRepeatedStrings(t *testing.T) {
	tests := []struct {
		name  string
		input repeatedString
		want  repeatedString
	}{
		{
			name:  "empty",
			input: repeatedString{},
			want:  repeatedString{},
		},
		{
			name:  "nil",
			input: nil,
			want:  nil,
		},
		{
			name:  "single value no trim",
			input: repeatedString{"val1"},
			want:  repeatedString{"val1"},
		},
		{
			name:  "trims whitespace",
			input: repeatedString{" val1 ", " val2 "},
			want:  repeatedString{"val1", "val2"},
		},
		{
			name:  "filters empty strings",
			input: repeatedString{"val1", "", "val2"},
			want:  repeatedString{"val1", "val2"},
		},
		{
			name:  "filters whitespace-only strings",
			input: repeatedString{"val1", "  ", "val2"},
			want:  repeatedString{"val1", "val2"},
		},
		{
			name:  "all empty",
			input: repeatedString{"", "", ""},
			want:  repeatedString{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := trimRepeatedStrings(tt.input)
			if len(got) == 0 && len(tt.want) == 0 {
				return
			}
			if strings.Join([]string(got), "\x00") != strings.Join([]string(tt.want), "\x00") {
				t.Fatalf("trimRepeatedStrings(%#v) = %#v, want %#v", tt.input, got, tt.want)
			}
		})
	}
}

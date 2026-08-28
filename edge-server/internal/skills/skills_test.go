package skills

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/testkit"
)

// ============================================================================
// Test helpers
// ============================================================================

// createTempSkillDir creates a temp dir structure:
//
//	base/
//	  skill-name/
//	    SKILL.md  (with given content)
func createTempSkillDir(t *testing.T, name, content string) string {
	t.Helper()
	dir := t.TempDir()
	skillDir := filepath.Join(dir, name)
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	return dir
}

// basicSkillMD returns a minimal valid SKILL.md frontmatter + body.
func basicSkillMD(name, desc string) string {
	return `---
name: ` + name + `
description: "` + desc + `"
---
# ` + name + `

This is the body of ` + name + `.
`
}

// ============================================================================
// TestSkillParser
// ============================================================================

func TestSkillParser(t *testing.T) {
	content := `---
name: adapter-dev
description: "SOP for developing new Agent CLI adapters"
triggers: adapter, new agent, cli integration
---
# Adapter Dev

Full markdown body here.
`
	dir := createTempSkillDir(t, "adapter-dev", content)

	skill, err := ParseFrontmatter(filepath.Join(dir, "adapter-dev", "SKILL.md"))
	if err != nil {
		t.Fatalf("ParseFrontmatter: %v", err)
	}

	if skill.Name != "adapter-dev" {
		t.Fatalf("Name = %q, want adapter-dev", skill.Name)
	}
	if skill.Description != "SOP for developing new Agent CLI adapters" {
		t.Fatalf("Description = %q, want 'SOP for developing new Agent CLI adapters'", skill.Description)
	}
	if len(skill.Triggers) != 3 {
		t.Fatalf("len(Triggers) = %d, want 3", len(skill.Triggers))
	}
	if skill.Triggers[0] != "adapter" {
		t.Fatalf("Triggers[0] = %q, want adapter", skill.Triggers[0])
	}
	if skill.Triggers[1] != "new agent" {
		t.Fatalf("Triggers[1] = %q, want 'new agent'", skill.Triggers[1])
	}
	if skill.Triggers[2] != "cli integration" {
		t.Fatalf("Triggers[2] = %q, want 'cli integration'", skill.Triggers[2])
	}

	// Verify body is NOT loaded yet (ParseFrontmatter is lightweight).
	if skill.Body != "" {
		t.Fatal("Body should be empty after ParseFrontmatter (lightweight)")
	}

	// Verify full body can be loaded separately.
	body, err := ParseBody(skill.Path)
	if err != nil {
		t.Fatalf("ParseBody: %v", err)
	}
	if !strings.Contains(body, "Full markdown body here.") {
		t.Fatalf("Body does not contain expected content: %s", body)
	}
}

func TestSkillParserMinimal(t *testing.T) {
	content := `---
name: minimal-skill
description: ""
---
Minimal body.
`
	dir := createTempSkillDir(t, "minimal-skill", content)

	skill, err := ParseFrontmatter(filepath.Join(dir, "minimal-skill", "SKILL.md"))
	if err != nil {
		t.Fatalf("ParseFrontmatter: %v", err)
	}
	if skill.Name != "minimal-skill" {
		t.Fatalf("Name = %q, want minimal-skill", skill.Name)
	}
	if len(skill.Triggers) != 0 {
		t.Fatalf("Triggers should be empty, got %v", skill.Triggers)
	}
}

func TestSkillParserMissingName(t *testing.T) {
	content := `---
description: "no name here"
---
Body
`
	dir := createTempSkillDir(t, "no-name", content)

	_, err := ParseFrontmatter(filepath.Join(dir, "no-name", "SKILL.md"))
	if err == nil {
		t.Fatal("expected error for missing name")
	}
	if !strings.Contains(err.Error(), "missing 'name'") {
		t.Fatalf("wrong error: %v", err)
	}
}

func TestSkillParserMissingFrontmatter(t *testing.T) {
	content := `# Just a markdown file
No frontmatter.
`
	dir := createTempSkillDir(t, "no-fm", content)

	_, err := ParseFrontmatter(filepath.Join(dir, "no-fm", "SKILL.md"))
	if err == nil {
		t.Fatal("expected error for missing frontmatter")
	}
}

func TestSkillParserEmptyFile(t *testing.T) {
	dir := createTempSkillDir(t, "empty", "")

	_, err := ParseFrontmatter(filepath.Join(dir, "empty", "SKILL.md"))
	if err == nil {
		t.Fatal("expected error for empty file")
	}
}

func TestParseFull(t *testing.T) {
	content := `---
name: full-skill
description: "Full parse test"
---
# Body Section

Some markdown content.
`
	dir := createTempSkillDir(t, "full-skill", content)

	skill, err := ParseFull(filepath.Join(dir, "full-skill", "SKILL.md"))
	if err != nil {
		t.Fatalf("ParseFull: %v", err)
	}
	if skill.Name != "full-skill" {
		t.Fatalf("Name = %q, want full-skill", skill.Name)
	}
	if !strings.Contains(skill.Body, "Some markdown content.") {
		t.Fatalf("Body doesn't have expected content: %s", skill.Body)
	}
}

// ============================================================================
// TestSkillDiscovery
// ============================================================================

func TestSkillDiscovery(t *testing.T) {
	baseDir := t.TempDir()

	// Create .agents/skills/ structure.
	agentsDir := filepath.Join(baseDir, ".agents", "skills")
	mustMkdirAll(t, agentsDir)
	mustWriteFile(t, filepath.Join(agentsDir, "skill-a", "SKILL.md"), basicSkillMD("skill-a", "First skill"))
	mustWriteFile(t, filepath.Join(agentsDir, "skill-b", "SKILL.md"), basicSkillMD("skill-b", "Second skill"))

	paths, err := DiscoverSKILL(filepath.Join(baseDir, ".agents", "skills"))
	if err != nil {
		t.Fatalf("DiscoverSKILL: %v", err)
	}
	if len(paths) != 2 {
		t.Fatalf("len(paths) = %d, want 2", len(paths))
	}
}

func TestSkillDiscoveryNonExistentDir(t *testing.T) {
	paths, err := DiscoverSKILL(filepath.Join(t.TempDir(), "nonexistent"))
	if err != nil {
		t.Fatalf("DiscoverSKILL on nonexistent dir: %v", err)
	}
	if paths != nil {
		t.Fatalf("paths should be nil for nonexistent dir, got %v", paths)
	}
}

func TestSkillDiscoveryEmptyDir(t *testing.T) {
	emptyDir := t.TempDir()
	paths, err := DiscoverSKILL(emptyDir)
	if err != nil {
		t.Fatalf("DiscoverSKILL on empty dir: %v", err)
	}
	if len(paths) != 0 {
		t.Fatalf("len(paths) = %d, want 0", len(paths))
	}
}

func TestSkillDiscoverySkipsFiles(t *testing.T) {
	baseDir := t.TempDir()
	// Create a file directly in the skills dir (not a subdirectory) — should be ignored.
	mustWriteFile(t, filepath.Join(baseDir, "README.md"), "not a skill")
	// Create a proper skill.
	mustMkdirAll(t, filepath.Join(baseDir, "real-skill"))
	mustWriteFile(t, filepath.Join(baseDir, "real-skill", "SKILL.md"), basicSkillMD("real-skill", "A real skill"))

	paths, err := DiscoverSKILL(baseDir)
	if err != nil {
		t.Fatalf("DiscoverSKILL: %v", err)
	}
	if len(paths) != 1 {
		t.Fatalf("len(paths) = %d, want 1", len(paths))
	}
}

// ============================================================================
// TestProgressiveLoading
// ============================================================================

func TestProgressiveLoading(t *testing.T) {
	baseDir := t.TempDir()
	mustWriteFile(t, filepath.Join(baseDir, "alpha", "SKILL.md"), basicSkillMD("alpha", "Alpha skill description"))
	mustWriteFile(t, filepath.Join(baseDir, "beta", "SKILL.md"), basicSkillMD("beta", "Beta skill description"))

	reg := NewSkillRegistry([]string{baseDir})

	// Before Discover, registry should be empty.
	if reg.IsLoaded() {
		t.Fatal("registry should not be loaded before Discover")
	}
	if reg.Count() != 0 {
		t.Fatalf("Count = %d, want 0", reg.Count())
	}

	// First load: Discover (lightweight, no bodies).
	if err := reg.Discover(); err != nil {
		t.Fatalf("Discover: %v", err)
	}
	if reg.Count() != 2 {
		t.Fatalf("Count = %d, want 2", reg.Count())
	}
	if !reg.IsLoaded() {
		t.Fatal("registry should be loaded after Discover")
	}

	// Verify summaries (no body loaded yet).
	summaries := reg.List()
	if len(summaries) != 2 {
		t.Fatalf("len(summaries) = %d, want 2", len(summaries))
	}

	skill, ok := reg.Get("alpha")
	if !ok {
		t.Fatal("Get(alpha) failed")
	}
	if skill.Body != "" {
		t.Fatal("Body should be empty after Discover (progressive loading)")
	}

	// Load body on demand.
	body, ok := reg.LoadBody("alpha")
	if !ok {
		t.Fatal("LoadBody(alpha) failed")
	}
	if !strings.Contains(body, "This is the body of alpha.") {
		t.Fatalf("Body doesn't contain expected text: %s", body)
	}

	// Getting the skill again should have body populated.
	skill, ok = reg.Get("alpha")
	if !ok {
		t.Fatal("Get(alpha) failed after LoadBody")
	}
	if !strings.Contains(skill.Body, "This is the body of alpha.") {
		t.Fatalf("skill.Body not populated: %s", skill.Body)
	}

	// LoadBody on already-loaded body should return same content.
	body2, ok := reg.LoadBody("alpha")
	if !ok {
		t.Fatal("LoadBody(alpha) second call failed")
	}
	if body2 != body {
		t.Fatal("LoadBody returned different content on second call")
	}
}

func TestProgressiveLoadingMissingSkill(t *testing.T) {
	reg := NewSkillRegistry([]string{t.TempDir()})
	_, ok := reg.LoadBody("nonexistent")
	if ok {
		t.Fatal("LoadBody should return false for nonexistent skill")
	}
}

// ============================================================================
// TestTriggerMatch
// ============================================================================

func TestTriggerMatch(t *testing.T) {
	baseDir := t.TempDir()

	mustWriteFile(t, filepath.Join(baseDir, "build-tool", "SKILL.md"), `---
name: build-tool
description: "Build automation"
triggers: build, compile, make
---
# Build Tool
Body
`)
	mustWriteFile(t, filepath.Join(baseDir, "deploy-tool", "SKILL.md"), `---
name: deploy-tool
description: "Deployment automation"
triggers: deploy, release, ship
---
# Deploy Tool
Body
`)
	mustWriteFile(t, filepath.Join(baseDir, "no-trigger", "SKILL.md"), `---
name: no-trigger
description: "No triggers defined"
---
# No Trigger
Body
`)

	reg := NewSkillRegistry([]string{baseDir})
	if err := reg.Discover(); err != nil {
		t.Fatalf("Discover: %v", err)
	}

	tests := []struct {
		name     string
		input    string
		wantN    int
		wantName string // if wantN==1, check this name
	}{
		{"exact match", "build", 1, "build-tool"},
		{"substring match", "I need to compile this", 1, "build-tool"},
		{"case insensitive", "DEPLOY to production", 1, "deploy-tool"},
		{"no match", "nothing relevant here", 0, ""},
		{"empty input", "", 0, ""},
		{"skill without triggers", "no-trigger", 0, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			matched := reg.MatchTrigger(tt.input)
			if len(matched) != tt.wantN {
				t.Fatalf("MatchTrigger(%q).len = %d, want %d (matched: %v)", tt.input, len(matched), tt.wantN, skillNames(matched))
			}
			if tt.wantN > 0 && matched[0].Name != tt.wantName {
				t.Fatalf("MatchTrigger(%q)[0].Name = %q, want %q", tt.input, matched[0].Name, tt.wantName)
			}
		})
	}
}

func TestTriggerMatchMultipleMatches(t *testing.T) {
	baseDir := t.TempDir()
	mustWriteFile(t, filepath.Join(baseDir, "a", "SKILL.md"), `---
name: a
description: "A"
triggers: build, test
---
Body A
`)
	mustWriteFile(t, filepath.Join(baseDir, "b", "SKILL.md"), `---
name: b
description: "B"
triggers: test, lint
---
Body B
`)

	reg := NewSkillRegistry([]string{baseDir})
	if err := reg.Discover(); err != nil {
		t.Fatalf("Discover: %v", err)
	}

	matched := reg.MatchTrigger("run the test suite")
	if len(matched) != 2 {
		t.Fatalf("MatchTrigger('test') matched %d skills, want 2: %v", len(matched), skillNames(matched))
	}
}

// ============================================================================
// TestMatchTriggerWordBoundary — package-level function
// ============================================================================

func TestMatchTriggerWordBoundary(t *testing.T) {
	tests := []struct {
		name    string
		trigger string
		message string
		want    bool
	}{
		{"exact word match", "build", "run the build now", true},
		{"word at start", "build", "build the project", true},
		{"word at end", "build", "let us build", true},
		{"case insensitive", "BUILD", "run the Build now", true},
		{"substring no match", "build", "rebuilding the house", false},
		{"partial prefix no match", "build", "builder pattern", false},
		{"partial suffix no match", "build", "shipbuild", false},
		{"empty trigger", "", "hello world", false},
		{"empty message", "build", "", false},
		{"multi-word trigger", "new agent", "create a new agent today", true},
		{"multi-word trigger no match", "new agent", "renew agency", false},
		{"special regex chars escaped", "c++.build", "run c++.build now", true},
		{"special regex chars in message", "build", "run c++.build now", true},
		{"punctuation boundary", "build", "run build, then test", true},
		{"hyphenated word", "build", "run pre-build now", true},
		// Explicit test/test match scenarios (as required by the spec).
		{"test matches 'test'", "test", "run the test now", true},
		{"test does not match 'testing'", "test", "testing the waters", false},
		{"test does not match 'contest'", "test", "enter the contest", false},
		{"test does not match 'testament'", "test", "a testament to", false},
		{"test matches standalone", "test", "test", true},
		{"test matches surrounded by punctuation", "test", "run test, then deploy", true},
		{"test matches question mark", "test", "should I run the test?", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := MatchTriggerWordBoundary(tt.trigger, tt.message)
			if got != tt.want {
				t.Fatalf("MatchTriggerWordBoundary(%q, %q) = %v, want %v", tt.trigger, tt.message, got, tt.want)
			}
		})
	}
}

// ============================================================================
// TestTriggerMatchWordBoundary — SkillRegistry with UseWordBoundary=true
// ============================================================================

func TestTriggerMatchWordBoundaryRegistry(t *testing.T) {
	baseDir := t.TempDir()

	mustWriteFile(t, filepath.Join(baseDir, "build-tool", "SKILL.md"), `---
name: build-tool
description: "Build automation"
triggers: build, compile, make
---
# Build Tool
Body
`)
	mustWriteFile(t, filepath.Join(baseDir, "test-tool", "SKILL.md"), `---
name: test-tool
description: "Test automation"
triggers: test, spec
---
# Test Tool
Body
`)
	mustWriteFile(t, filepath.Join(baseDir, "deploy-tool", "SKILL.md"), `---
name: deploy-tool
description: "Deployment automation"
triggers: deploy, release, ship
---
# Deploy Tool
Body
`)
	mustWriteFile(t, filepath.Join(baseDir, "no-trigger", "SKILL.md"), `---
name: no-trigger
description: "No triggers defined"
---
# No Trigger
Body
`)

	reg := NewSkillRegistry([]string{baseDir})
	reg.UseWordBoundary = true
	if err := reg.Discover(); err != nil {
		t.Fatalf("Discover: %v", err)
	}

	tests := []struct {
		name     string
		input    string
		wantN    int
		wantName string // if wantN==1, check this name
	}{
		{"exact word match", "run the build", 1, "build-tool"},
		{"case insensitive word", "let us BUILD it", 1, "build-tool"},
		{"substring does not match", "rebuilding the house", 0, ""},
		{"prefix does not match", "builder pattern", 0, ""},
		{"suffix does not match", "shipbuild", 0, ""},
		{"word at punctuation boundary", "run build, then deploy", 2, ""},
		{"no match", "nothing relevant here", 0, ""},
		{"empty input", "", 0, ""},
		{"skill without triggers", "no-trigger is here", 0, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			matched := reg.MatchTrigger(tt.input)
			if len(matched) != tt.wantN {
				t.Fatalf("MatchTrigger(%q).len = %d, want %d (matched: %v)", tt.input, len(matched), tt.wantN, skillNames(matched))
			}
			if tt.wantN > 0 && tt.wantName != "" && matched[0].Name != tt.wantName {
				t.Fatalf("MatchTrigger(%q)[0].Name = %q, want %q", tt.input, matched[0].Name, tt.wantName)
			}
		})
	}
}

// TestTriggerMatchBackwardCompat verifies that UseWordBoundary=false (default)
// preserves the original substring-matching behavior.
func TestTriggerMatchBackwardCompat(t *testing.T) {
	baseDir := t.TempDir()

	mustWriteFile(t, filepath.Join(baseDir, "build-tool", "SKILL.md"), `---
name: build-tool
description: "Build automation"
triggers: build
---
# Build Tool
Body
`)

	reg := NewSkillRegistry([]string{baseDir})
	// UseWordBoundary defaults to false — do not set it.
	if err := reg.Discover(); err != nil {
		t.Fatalf("Discover: %v", err)
	}

	// Substring matching should work (backward compat).
	matched := reg.MatchTrigger("rebuilding the house")
	if len(matched) != 1 {
		t.Fatalf("MatchTrigger('rebuilding') with UseWordBoundary=false matched %d skills, want 1 (substring matching)", len(matched))
	}
	if matched[0].Name != "build-tool" {
		t.Fatalf("MatchTrigger matched %q, want build-tool", matched[0].Name)
	}
}

// TestMatchTriggerWordBoundarySpecialChars verifies that special regex
// characters in triggers are safely escaped (no ReDoS risk).
func TestMatchTriggerWordBoundarySpecialChars(t *testing.T) {
	baseDir := t.TempDir()

	// Trigger with regex-special characters: ., +, *, ?, (, ), [, ], {, }, ^, $, |
	mustWriteFile(t, filepath.Join(baseDir, "cpp-tool", "SKILL.md"), `---
name: cpp-tool
description: "C++ build tool"
triggers: c++.build, c++17, hello.world
---
# C++ Tool
Body
`)

	reg := NewSkillRegistry([]string{baseDir})
	reg.UseWordBoundary = true
	if err := reg.Discover(); err != nil {
		t.Fatalf("Discover: %v", err)
	}

	tests := []struct {
		name  string
		input string
		wantN int
	}{
		{"literal dot in trigger", "use c++.build for this", 1},
		{"literal plus in trigger", "compile with c++17 standard", 1},
		{"dot in trigger word boundary", "run hello.world now", 1},
		{"dot in trigger as regex wildcard - should not match", "run helloXworld now", 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			matched := reg.MatchTrigger(tt.input)
			if len(matched) != tt.wantN {
				t.Fatalf("MatchTrigger(%q).len = %d, want %d (matched: %v)", tt.input, len(matched), tt.wantN, skillNames(matched))
			}
		})
	}
}

// ============================================================================
// TestSystemPromptContext
// ============================================================================

func TestSystemPromptContext(t *testing.T) {
	baseDir := t.TempDir()
	mustWriteFile(t, filepath.Join(baseDir, "alpha", "SKILL.md"), basicSkillMD("alpha", "Alpha description"))
	mustWriteFile(t, filepath.Join(baseDir, "beta", "SKILL.md"), `---
name: beta
description: ""
---
# Beta
`)

	reg := NewSkillRegistry([]string{baseDir})
	if err := reg.Discover(); err != nil {
		t.Fatalf("Discover: %v", err)
	}

	ctx := reg.SystemPromptContext()
	if !strings.Contains(ctx, "Available skills:") {
		t.Fatal("SystemPromptContext should start with 'Available skills:'")
	}
	if !strings.Contains(ctx, "- alpha: Alpha description") {
		t.Fatalf("SystemPromptContext should contain alpha skill: %s", ctx)
	}
	if !strings.Contains(ctx, "- beta") {
		t.Fatalf("SystemPromptContext should contain beta skill: %s", ctx)
	}
}

func TestSystemPromptContextEmpty(t *testing.T) {
	reg := NewSkillRegistry([]string{t.TempDir()})
	ctx := reg.SystemPromptContext()
	if ctx != "" {
		t.Fatalf("SystemPromptContext should be empty for empty registry, got: %s", ctx)
	}
}

// ============================================================================
// TestDefaultDirs
// ============================================================================

func TestDefaultDirs(t *testing.T) {
	dirs := DefaultDirs("/home/user/project")
	if len(dirs) != 2 {
		t.Fatalf("len(dirs) = %d, want 2", len(dirs))
	}
	if !strings.Contains(dirs[0], ".agents") {
		t.Fatalf("dirs[0] = %s, should contain .agents", dirs[0])
	}
	if !strings.Contains(dirs[1], ".codex") {
		t.Fatalf("dirs[1] = %s, should contain .codex", dirs[1])
	}

	// Empty workDir.
	dirsEmpty := DefaultDirs("")
	if len(dirsEmpty) != 2 {
		t.Fatalf("len(dirs) = %d, want 2 (empty workDir)", len(dirsEmpty))
	}
}

// ============================================================================
// Helpers
// ============================================================================

func mustMkdirAll(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatalf("MkdirAll(%s): %v", path, err)
	}
}

func mustWriteFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("MkdirAll(%s): %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile(%s): %v", path, err)
	}
}

func skillNames(skills []*Skill) []string {
	names := make([]string, len(skills))
	for i, s := range skills {
		names[i] = s.Name
	}
	return names
}

// ============================================================================
// TestHotReload
// ============================================================================

// hotReloadWaitTimeout is the Eventually budget for positive hot-reload
// assertions (#2033): far larger than hotReloadDebounce (500ms) so busy CI
// machines still converge, while tests return as soon as the reload lands.
const hotReloadWaitTimeout = 5 * time.Second

// waitForDebounce performs a BOUNDED wait of the hot-reload debounce window
// plus margin. It is retained only for the negative assertion in
// TestHotReloadStopWatch: a negative assertion ("the skill must NOT be
// picked up") cannot be expressed with testkit.Eventually — that condition
// would have to be polled forever — so it must wait a bounded window in
// which a broken (still-active) watcher could react, then assert absence.
// Positive hot-reload assertions must use testkit.Eventually instead. The
// margin is generous so that even on a busy machine a hypothetical
// still-active watcher has time to expose itself before we assert absence.
func waitForDebounce() {
	time.Sleep(hotReloadDebounce + 500*time.Millisecond)
}

// registryDump returns a state snapshot printer for testkit.Eventually: on
// timeout it shows the current skill count and sorted names so a flake can
// be diagnosed from the failure message alone.
func registryDump(reg *SkillRegistry) func() string {
	return func() string {
		list := reg.List()
		names := make([]string, 0, len(list))
		for _, s := range list {
			names = append(names, s.Name)
		}
		sort.Strings(names)
		return fmt.Sprintf("registry state: Count=%d skills=%v", reg.Count(), names)
	}
}

func TestHotReloadNewSkill(t *testing.T) {
	baseDir := t.TempDir()

	// Create an initial skill so the registry is non-empty.
	mustWriteFile(t, filepath.Join(baseDir, "alpha", "SKILL.md"), basicSkillMD("alpha", "Alpha skill"))

	reg := NewSkillRegistry([]string{baseDir})
	if err := reg.Discover(); err != nil {
		t.Fatalf("Discover: %v", err)
	}
	defer reg.StopWatch()

	if reg.Count() != 1 {
		t.Fatalf("Count = %d, want 1", reg.Count())
	}

	// Start watching.
	if err := reg.StartWatch(baseDir); err != nil {
		t.Fatalf("StartWatch: %v", err)
	}

	// Create a new skill after watcher started.
	mustWriteFile(t, filepath.Join(baseDir, "beta", "SKILL.md"), basicSkillMD("beta", "Beta skill"))

	// Positive assertion: poll the real registry state instead of sleeping a
	// fixed debounce window, which flakes when event delivery exceeds the
	// window on busy machines (#2033).
	testkit.Eventually(t, hotReloadWaitTimeout, func() bool {
		return reg.Count() == 2
	}, "hot reload should add the new skill beta (Count=2)", registryDump(reg))

	if reg.Count() != 2 {
		t.Fatalf("Count = %d, want 2 after hot reload of new skill", reg.Count())
	}

	skill, ok := reg.Get("beta")
	if !ok {
		t.Fatal("Get(beta) should return the hot-reloaded skill")
	}
	if skill.Name != "beta" {
		t.Fatalf("Name = %q, want beta", skill.Name)
	}
}

func TestHotReloadModifiedSkill(t *testing.T) {
	baseDir := t.TempDir()

	mustWriteFile(t, filepath.Join(baseDir, "alpha", "SKILL.md"), basicSkillMD("alpha", "Original description"))

	reg := NewSkillRegistry([]string{baseDir})
	if err := reg.Discover(); err != nil {
		t.Fatalf("Discover: %v", err)
	}
	defer reg.StopWatch()

	if err := reg.StartWatch(baseDir); err != nil {
		t.Fatalf("StartWatch: %v", err)
	}

	// Modify the SKILL.md to change description and add triggers.
	updated := `---
name: alpha
description: "Updated description"
triggers: hello, world
---
# Alpha

Updated body content.
`
	mustWriteFile(t, filepath.Join(baseDir, "alpha", "SKILL.md"), updated)

	// Positive assertion: poll until the reloaded entry is visible. The
	// reload swaps the whole skill entry atomically under the registry lock,
	// so once the new Description is observable, the new Triggers are too.
	testkit.Eventually(t, hotReloadWaitTimeout, func() bool {
		skill, ok := reg.Get("alpha")
		return ok && skill.Description == "Updated description"
	}, "hot reload should apply the modified description for alpha", registryDump(reg))

	skill, ok := reg.Get("alpha")
	if !ok {
		t.Fatal("Get(alpha) should still exist after modification")
	}
	if skill.Description != "Updated description" {
		t.Fatalf("Description = %q, want 'Updated description'", skill.Description)
	}
	if len(skill.Triggers) != 2 {
		t.Fatalf("len(Triggers) = %d, want 2", len(skill.Triggers))
	}
}

func TestHotReloadRemovedSkill(t *testing.T) {
	baseDir := t.TempDir()

	mustWriteFile(t, filepath.Join(baseDir, "alpha", "SKILL.md"), basicSkillMD("alpha", "Alpha skill"))

	reg := NewSkillRegistry([]string{baseDir})
	if err := reg.Discover(); err != nil {
		t.Fatalf("Discover: %v", err)
	}
	defer reg.StopWatch()

	if err := reg.StartWatch(baseDir); err != nil {
		t.Fatalf("StartWatch: %v", err)
	}

	// Remove the SKILL.md.
	if err := os.Remove(filepath.Join(baseDir, "alpha", "SKILL.md")); err != nil {
		t.Fatalf("Remove: %v", err)
	}

	// Positive assertion: poll until the removal is reflected in the registry.
	testkit.Eventually(t, hotReloadWaitTimeout, func() bool {
		return reg.Count() == 0
	}, "hot reload should remove alpha (Count=0)", registryDump(reg))

	if reg.Count() != 0 {
		t.Fatalf("Count = %d, want 0 after removal", reg.Count())
	}

	_, ok := reg.Get("alpha")
	if ok {
		t.Fatal("Get(alpha) should return false after removal")
	}
}

func TestHotReloadDebouncePreventsDoubleLoad(t *testing.T) {
	baseDir := t.TempDir()

	reg := NewSkillRegistry([]string{baseDir})
	if err := reg.Discover(); err != nil {
		t.Fatalf("Discover: %v", err)
	}
	defer reg.StopWatch()

	if err := reg.StartWatch(baseDir); err != nil {
		t.Fatalf("StartWatch: %v", err)
	}

	// Rapidly write the same file multiple times.
	content := basicSkillMD("beta", "Beta skill")
	mustWriteFile(t, filepath.Join(baseDir, "beta", "SKILL.md"), content)

	// Write multiple times quickly — all should be coalesced.
	for i := 0; i < 5; i++ {
		mustWriteFile(t, filepath.Join(baseDir, "beta", "SKILL.md"), content)
		time.Sleep(50 * time.Millisecond)
	}

	// Positive assertion: poll until the (coalesced) reload lands. All writes
	// target the same path, so the count transitions 0 -> 1 exactly once and
	// stays 1; any Count > 1 would mean debounce failed to coalesce.
	testkit.Eventually(t, hotReloadWaitTimeout, func() bool {
		return reg.Count() == 1
	}, "debounced hot reload should load beta exactly once (Count=1)", registryDump(reg))

	// Should still be exactly 1 skill, not 5.
	if reg.Count() != 1 {
		t.Fatalf("Count = %d, want 1 (debounce should coalesce writes)", reg.Count())
	}
}

func TestHotReloadStopWatch(t *testing.T) {
	baseDir := t.TempDir()

	mustWriteFile(t, filepath.Join(baseDir, "alpha", "SKILL.md"), basicSkillMD("alpha", "Alpha skill"))

	reg := NewSkillRegistry([]string{baseDir})
	if err := reg.Discover(); err != nil {
		t.Fatalf("Discover: %v", err)
	}

	if err := reg.StartWatch(baseDir); err != nil {
		t.Fatalf("StartWatch: %v", err)
	}

	// Stop the watcher.
	if err := reg.StopWatch(); err != nil {
		t.Fatalf("StopWatch: %v", err)
	}

	// Create a new skill after stop — should NOT be picked up.
	mustWriteFile(t, filepath.Join(baseDir, "beta", "SKILL.md"), basicSkillMD("beta", "Beta skill"))
	waitForDebounce()

	if reg.Count() != 1 {
		t.Fatalf("Count = %d, want 1 (new skill should not be picked up after StopWatch)", reg.Count())
	}
}

func TestHotReloadNonExistentDir(t *testing.T) {
	reg := NewSkillRegistry([]string{t.TempDir()})
	defer reg.StopWatch()

	// StartWatch on a non-existent directory should not error (graceful degradation).
	nonexistent := filepath.Join(t.TempDir(), "does-not-exist")
	err := reg.StartWatch(nonexistent)
	if err != nil {
		t.Fatalf("StartWatch on nonexistent dir should return nil (graceful degradation), got: %v", err)
	}
}

func TestHotReloadEmptyDir(t *testing.T) {
	baseDir := t.TempDir()

	reg := NewSkillRegistry([]string{baseDir})
	if err := reg.Discover(); err != nil {
		t.Fatalf("Discover: %v", err)
	}
	defer reg.StopWatch()

	if err := reg.StartWatch(baseDir); err != nil {
		t.Fatalf("StartWatch: %v", err)
	}

	// Create a new skill subdirectory and SKILL.md at once.
	mustWriteFile(t, filepath.Join(baseDir, "gamma", "SKILL.md"), basicSkillMD("gamma", "Gamma skill"))
	waitForDebounce()

	if reg.Count() != 1 {
		t.Fatalf("Count = %d, want 1 (skill created in new subdirectory under watched dir)", reg.Count())
	}

	skill, ok := reg.Get("gamma")
	if !ok {
		t.Fatal("Get(gamma) should return the skill created after watcher started")
	}
	if skill.Name != "gamma" {
		t.Fatalf("Name = %q, want gamma", skill.Name)
	}
}

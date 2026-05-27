package skills

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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

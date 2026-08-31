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

// ============================================================================
// TestSkillDiscovery
// ============================================================================

func TestSkillDiscovery(t *testing.T) {
	baseDir := t.TempDir()

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
	// A file directly in the skills dir (not a subdirectory) is ignored.
	mustWriteFile(t, filepath.Join(baseDir, "README.md"), "not a skill")
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
	if got := reg.Count(); got != 2 {
		t.Fatalf("Count() = %d, want 2", got)
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

	dirsEmpty := DefaultDirs("")
	if len(dirsEmpty) != 2 {
		t.Fatalf("len(dirs) = %d, want 2 (empty workDir)", len(dirsEmpty))
	}
}

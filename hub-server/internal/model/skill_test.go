package model

import (
	"testing"
)

func validSkill() *Skill {
	return &Skill{
		OwnerID:      "00000000-0000-0000-0000-000000000001",
		Name:         "Test Skill",
		Description:  "A test skill",
		SkillType:    "agent_skill",
		RuntimeIDs:   `["nodejs", "python"]`,
		EntryPoint:   "index.js",
		ConfigSchema: `{"port": 8080}`,
	}
}

func TestSkill_Validate_Valid(t *testing.T) {
	s := validSkill()
	if err := s.Validate(); err != nil {
		t.Fatalf("expected valid skill to pass validation, got: %v", err)
	}
}

func TestSkill_Validate_RuntimeIDsNotArray(t *testing.T) {
	s := validSkill()
	s.RuntimeIDs = `"not_an_array"`
	if err := s.Validate(); err == nil {
		t.Fatal("expected error for runtime_ids not being a JSON array, got nil")
	}
}

func TestSkill_Validate_RuntimeIDsInvalidJSON(t *testing.T) {
	s := validSkill()
	s.RuntimeIDs = `not_json`
	if err := s.Validate(); err == nil {
		t.Fatal("expected error for runtime_ids not being valid JSON, got nil")
	}
}

func TestSkill_Validate_ConfigSchemaNotObject(t *testing.T) {
	s := validSkill()
	s.ConfigSchema = `"not_an_object"`
	if err := s.Validate(); err == nil {
		t.Fatal("expected error for config_schema not being a JSON object, got nil")
	}
}

func TestSkill_Validate_EmptyJSONBFields(t *testing.T) {
	s := validSkill()
	s.RuntimeIDs = `[]`
	s.ConfigSchema = `{}`
	if err := s.Validate(); err != nil {
		t.Fatalf("expected empty JSONB default values to pass validation, got: %v", err)
	}
}

func TestSkill_Validate_EmptyStrings(t *testing.T) {
	s := validSkill()
	s.RuntimeIDs = ""
	s.ConfigSchema = ""
	if err := s.Validate(); err != nil {
		t.Fatalf("expected empty strings to pass validation, got: %v", err)
	}
}

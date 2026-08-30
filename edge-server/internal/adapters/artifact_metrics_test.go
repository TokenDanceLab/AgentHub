package adapters

import "testing"

type stubArtifactRecorder struct {
	kinds []string
}

func (s *stubArtifactRecorder) RecordArtifactSurfaced(k string) {
	s.kinds = append(s.kinds, k)
}

func TestSetArtifactSurfacedRecorderWires(t *testing.T) {
	stub := &stubArtifactRecorder{}
	SetArtifactSurfacedRecorder(stub)
	defer SetArtifactSurfacedRecorder(nil)

	if artifactSurfacedRecorder == nil {
		t.Fatal("recorder not set")
	}
	artifactSurfacedRecorder.RecordArtifactSurfaced("preview")
	artifactSurfacedRecorder.RecordArtifactSurfaced("artifact")
	if len(stub.kinds) != 2 || stub.kinds[0] != "preview" || stub.kinds[1] != "artifact" {
		t.Fatalf("unexpected kinds: %v", stub.kinds)
	}
}

func TestNewArtifactSurfacedRecorderNilSafe(t *testing.T) {
	r := NewArtifactSurfacedRecorder(nil)
	if r != nil {
		t.Fatal("expected nil for nil metrics")
	}
}

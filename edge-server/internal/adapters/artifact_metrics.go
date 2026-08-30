package adapters

// ArtifactSurfacedRecorder abstracts the edge_artifacts_surfaced_total counter
// so surfacing stays decoupled from the concrete metrics package. Nil-safe.
type ArtifactSurfacedRecorder interface {
	RecordArtifactSurfaced(kind string)
}

// artifactSurfacedRecorder is the package-level recorder; set by init or
// SetArtifactSurfacedRecorder. Nil means no-op (tests, early startup).
var artifactSurfacedRecorder ArtifactSurfacedRecorder

// SetArtifactSurfacedRecorder wires the concrete metrics adapter. Safe to
// call with nil (disables recording).
func SetArtifactSurfacedRecorder(r ArtifactSurfacedRecorder) {
	artifactSurfacedRecorder = r
}

// ArtifactSurfacedRecorderForTest exposes the current recorder for assertions.
func ArtifactSurfacedRecorderForTest() ArtifactSurfacedRecorder {
	return artifactSurfacedRecorder
}

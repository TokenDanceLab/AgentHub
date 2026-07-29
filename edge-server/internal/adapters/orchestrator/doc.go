// Package orchestrator is the target leaf package for the A-V1 orchestrator
// extraction RFC §6. It currently contains only the pre-conditions test stub
// that gates the extraction: when this test passes in a scratch branch with
// the 13 orchestrator_*.go files moved here, the extraction is safe to PR.
//
// Extraction plan (RFC §6):
//  1. Run this test to confirm no import cycles → gate passes
//  2. Move the 13 files + 5 test files from parent adapters package
//  3. Fix package declarations: package adapters → package orchestrator
//  4. Add adapters parent import where needed
//  5. Move shared types (PlanTask etc.) to a shared location or keep in parent
//  6. Run this test again → all checks pass → PR sign-off
package orchestrator

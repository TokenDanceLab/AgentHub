package config

// ClampPageSize normalizes a caller-supplied page size into the range the
// endpoint actually enforces:
//
//   - requested <= 0 → def (a missing or unparsable pageSize must not mean
//     "everything", and must not mean "nothing");
//   - requested > max → **max**, not def;
//   - otherwise the requested value, unchanged.
//
// max and def are parameters rather than constants because each endpoint family
// has its own ceiling: MaxListPageSize (200) for the generic cursor-paged lists
// (the value api/openapi.yaml declares for the shared PageSize parameter),
// MaxMessagePageLimit (100) for payload-size-sensitive message lists,
// MaxPageLimit (500) for run-event, team-event and document lists, and
// MaxIncrementalMessageLimit (500) for message sync.
//
// A caller passes the ceiling its own endpoint declares in api/openapi.yaml and
// its own query layer enforces; passing a higher one moves the clamp down a
// layer, where the shortening is invisible to the client.
//
// Callers whose endpoint treats 0 as "no explicit limit" rather than as a
// request for def pass the requested value as def, so the sentinel survives the
// first branch (handler/agent.go runEventFilterFromQuery).
func ClampPageSize(requested, max, def int) int {
	if requested <= 0 {
		return def
	}
	if requested > max {
		return max
	}
	return requested
}

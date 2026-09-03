package config

// ClampPageSize normalizes a caller-supplied page size into the range the
// endpoint actually enforces:
//
//   - requested <= 0 → def (a missing or unparsable pageSize must not mean
//     "everything", and must not mean "nothing");
//   - requested > max → **max**, not def;
//   - otherwise the requested value, unchanged.
//
// The middle rule is the one that was gotten wrong in twelve repository list
// entry points (#2154, pinned by repository/pagination_clamp_test.go). They all
// read:
//
//	if pageSize <= 0 || pageSize > 200 { pageSize = defaultXPageSize }
//
// which turns "you asked for too many" into "here is a quarter of a page", with
// HTTP 200 and no error. Clamping to max keeps the request satisfiable and makes
// the declared contract (api/openapi.yaml: PageSize maximum 200 for the generic
// list endpoints) the bound the endpoint really enforces. Falling back to def is
// only correct for the non-positive branch, where there is no request to honour.
//
// The handler layer had its own twelve copies of the two-branch shape and got
// the middle rule right while getting `max` wrong: ten of the twelve clamped to
// MaxPageLimit (500) above a query that clamped to 200 (the cursor-paged lists)
// or 100 (notifications, project-thread messages), so pageSize=300 came back as
// a silently shortened page; session search had no query-side ceiling at all
// while its openapi parameter declared 200. The other two — agent-task run
// events and team-run events — declare maximum: 500 in their own right and keep
// it (#2243).
//
// max and def are parameters rather than constants because the codebase has
// three legitimate maxima, one per endpoint family: MaxListPageSize (200) for
// the generic cursor-paged lists, MaxMessagePageLimit (100) for the
// payload-size-sensitive message, notification and thread-message lists, and
// MaxPageLimit (500) for the run-event, team-event and document lists. A caller
// passes the one its own endpoint declares in api/openapi.yaml and its own query
// layer enforces; passing a higher one moves the clamp down a layer, where the
// shortening is invisible to the client.
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

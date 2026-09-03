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
// The handler layer had fifteen hand-written copies of the two-branch shape —
// twelve converged by #2243's first slice, the three in message.go by its tail
// batch — plus a sixteenth endpoint, audit-events, with no clamp at all. They
// got the middle rule right while getting `max` wrong: nine clamped to
// MaxPageLimit (500) above a query that clamped lower (200 for the cursor-paged
// lists, 100 for notifications and project-thread messages), so pageSize=300
// came back as a silently shortened page; a tenth, session search, clamped to
// 500 above a query with no ceiling at all while its openapi parameter declared
// 200; two more — agent-task run events and team-run events — declare
// maximum: 500 in their own right and keep it; the three in message.go already
// carried the right ceiling and only the shape was duplicated (#2243).
//
// max and def are parameters rather than constants because the codebase has one
// legitimate maximum per endpoint family: MaxListPageSize (200) for the generic
// cursor-paged lists, MaxMessagePageLimit (100) for the payload-size-sensitive
// message, notification, thread-message and message-search lists, MaxPageLimit
// (500) for the run-event, team-event and document lists, and
// MaxIncrementalMessageLimit (500) for message sync, which legitimately fetches
// larger batches than the interactive lists. An earlier revision of this comment
// said "three legitimate maxima" and was contradicted by the fourth.
//
// Every handler-side list clamp now goes through this function. The one
// hand-written branch left anywhere on this path is repository/message.go
// GetMessagesIncrement, whose non-positive case falls to the maximum instead of
// to def — the opposite of the rule documented above — and is tracked in #2243.
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

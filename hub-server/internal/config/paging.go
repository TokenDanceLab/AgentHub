package config

// ClampPageSize normalizes a caller-supplied page size into the range the
// endpoint actually enforces:
//
//   - requested <= 0 → def (a missing or unparsable pageSize must not mean
//     "everything", and must not mean "nothing");
//   - requested > max → **max**, not def;
//   - otherwise the requested value, unchanged.
//
// The middle rule is the one that was gotten wrong in twelve places (#2154).
// They all read:
//
//	if pageSize <= 0 || pageSize > 200 { pageSize = defaultXPageSize }
//
// which turns "you asked for too many" into "here is a quarter of a page", with
// HTTP 200 and no error. Clamping to max keeps the request satisfiable and makes
// the declared contract (api/openapi.yaml: PageSize maximum 200) the bound the
// endpoint really enforces. Falling back to def is only correct for the
// non-positive branch, where there is no request to honour.
//
// max and def are parameters rather than constants because the codebase has two
// legitimate maxima: MaxListPageSize (200) for the generic list endpoints and
// MaxMessagePageLimit (100) / MaxPageLimit (500) for message and document
// families. Callers pass the one their endpoint declares.
func ClampPageSize(requested, max, def int) int {
	if requested <= 0 {
		return def
	}
	if requested > max {
		return max
	}
	return requested
}

// Package publicstats holds the public-facing statistics service for Hub.
//
// PublicStatsService serves aggregate counts (users, agents, online agents,
// messages) to the public stats endpoint. It neither uses nor is used by any
// sibling of the flat service package, so it is the first low-coupling domain
// grouped into a subpackage.
//
// See #1761.
package publicstats

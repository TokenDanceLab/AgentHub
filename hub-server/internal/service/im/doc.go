// Package im holds pure IM message-content, reaction, attachment, and
// workspace field helpers for Hub.
//
// These helpers are free of DB, WS, cache, and *Service dependencies so service
// packages can reuse them without pulling orchestration code.
package im

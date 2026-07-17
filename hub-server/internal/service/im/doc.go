// Package im holds pure IM message-content, reaction, attachment, and
// workspace field helpers for Hub.
//
// These helpers are intentionally free of DB / WS / cache / *Service
// dependencies so later message/session/contact/attachment/reaction/workspace
// package extracts can reuse them without pulling orchestration code.
//
// See docs/analysis/hub-service-boundary-map.md (#628, #639, #651).
package im

package errcode

import "net/http"

// Common error codes shared by Edge Server and Hub Server.
// Domain-specific codes (MSG_NOT_FOUND, EXECUTOR_UNAVAILABLE, etc.) live in
// each server's internal errcode package, constructed with errcode.New().

// Rate-limiter error code strings (snake_case per api/conventions.md).
// Middleware constructs the *Error via errcode.New(Code, message, status) so
// the snake_case spelling is owned in exactly one place.
const (
	// RateLimited is the code returned when a request exceeds a rate limit
	// (HTTP 429). Snake_case per the API code-name convention.
	RateLimited = "rate_limited"
	// RateLimitUnavailable is the code returned when the rate-limit backing
	// store (Redis) is unavailable and the limiter is configured to fail
	// closed for non-auth paths (HTTP 503).
	RateLimitUnavailable = "rate_limit_unavailable"
	// WSRateLimited is the code returned when a WebSocket connection attempt
	// exceeds the per-IP WS connection rate limit (HTTP 429).
	WSRateLimited = "ws_rate_limited"
)

var (
	// --- Generic ---
	ErrInternal         = &Error{Code: "internal_error", Message: "internal server error", HTTPStatus: http.StatusInternalServerError}
	ErrBadRequest       = &Error{Code: "bad_request", Message: "invalid request", HTTPStatus: http.StatusBadRequest}
	ErrNotFound         = &Error{Code: "not_found", Message: "resource not found", HTTPStatus: http.StatusNotFound}
	ErrMethodNotAllowed = &Error{Code: "method_not_allowed", Message: "method not allowed", HTTPStatus: http.StatusMethodNotAllowed}
	ErrTimeout          = &Error{Code: "request_timeout", Message: "request timed out", HTTPStatus: http.StatusGatewayTimeout}
	ErrNotImplemented   = &Error{Code: "not_implemented", Message: "endpoint not yet implemented", HTTPStatus: http.StatusNotImplemented}
	ErrTooManyRequests  = &Error{Code: "too_many_requests", Message: "rate limit exceeded", HTTPStatus: http.StatusTooManyRequests}

	// --- Auth ---
	ErrUnauthorized = &Error{Code: "unauthorized", Message: "authentication required", HTTPStatus: http.StatusUnauthorized}
	ErrForbidden    = &Error{Code: "forbidden", Message: "permission denied", HTTPStatus: http.StatusForbidden}
	ErrInvalidToken = &Error{Code: "invalid_token", Message: "token is invalid or expired", HTTPStatus: http.StatusUnauthorized}
	ErrTokenExpired = &Error{Code: "token_expired", Message: "token has expired", HTTPStatus: http.StatusUnauthorized}

	// --- Validation ---
	ErrInvalidJSON     = &Error{Code: "invalid_json", Message: "invalid json body", HTTPStatus: http.StatusBadRequest}
	ErrValidation      = &Error{Code: "validation_error", Message: "validation failed", HTTPStatus: http.StatusBadRequest}
	ErrContentRequired = &Error{Code: "content_required", Message: "content is required", HTTPStatus: http.StatusBadRequest}
	ErrTooLarge        = &Error{Code: "payload_too_large", Message: "request payload too large", HTTPStatus: http.StatusRequestEntityTooLarge}

	// --- Conflict ---
	ErrConflict      = &Error{Code: "conflict", Message: "resource conflict", HTTPStatus: http.StatusConflict}
	ErrAlreadyExists = &Error{Code: "already_exists", Message: "resource already exists", HTTPStatus: http.StatusConflict}
)

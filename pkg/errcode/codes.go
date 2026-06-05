package errcode

import "net/http"

// Common error codes shared by Edge Server and Hub Server.
// Domain-specific codes (MSG_NOT_FOUND, EXECUTOR_UNAVAILABLE, etc.) live in
// each server's internal errcode package, constructed with errcode.New().

var (
	// --- Generic ---
	ErrInternal         = &Error{Code: "INTERNAL_ERROR", Message: "internal server error", HTTPStatus: http.StatusInternalServerError}
	ErrBadRequest       = &Error{Code: "BAD_REQUEST", Message: "invalid request", HTTPStatus: http.StatusBadRequest}
	ErrNotFound         = &Error{Code: "NOT_FOUND", Message: "resource not found", HTTPStatus: http.StatusNotFound}
	ErrMethodNotAllowed = &Error{Code: "METHOD_NOT_ALLOWED", Message: "method not allowed", HTTPStatus: http.StatusMethodNotAllowed}
	ErrTimeout          = &Error{Code: "REQUEST_TIMEOUT", Message: "request timed out", HTTPStatus: http.StatusGatewayTimeout}
	ErrNotImplemented   = &Error{Code: "NOT_IMPLEMENTED", Message: "endpoint not yet implemented", HTTPStatus: http.StatusNotImplemented}
	ErrTooManyRequests  = &Error{Code: "TOO_MANY_REQUESTS", Message: "rate limit exceeded", HTTPStatus: http.StatusTooManyRequests}

	// --- Auth ---
	ErrUnauthorized  = &Error{Code: "UNAUTHORIZED", Message: "authentication required", HTTPStatus: http.StatusUnauthorized}
	ErrForbidden     = &Error{Code: "FORBIDDEN", Message: "permission denied", HTTPStatus: http.StatusForbidden}
	ErrInvalidToken  = &Error{Code: "INVALID_TOKEN", Message: "token is invalid or expired", HTTPStatus: http.StatusUnauthorized}
	ErrTokenExpired  = &Error{Code: "TOKEN_EXPIRED", Message: "token has expired", HTTPStatus: http.StatusUnauthorized}

	// --- Validation ---
	ErrInvalidJSON     = &Error{Code: "INVALID_JSON", Message: "invalid json body", HTTPStatus: http.StatusBadRequest}
	ErrValidation      = &Error{Code: "VALIDATION_ERROR", Message: "validation failed", HTTPStatus: http.StatusBadRequest}
	ErrContentRequired = &Error{Code: "CONTENT_REQUIRED", Message: "content is required", HTTPStatus: http.StatusBadRequest}
	ErrTooLarge        = &Error{Code: "PAYLOAD_TOO_LARGE", Message: "request payload too large", HTTPStatus: http.StatusRequestEntityTooLarge}

	// --- Conflict ---
	ErrConflict      = &Error{Code: "CONFLICT", Message: "resource conflict", HTTPStatus: http.StatusConflict}
	ErrAlreadyExists = &Error{Code: "ALREADY_EXISTS", Message: "resource already exists", HTTPStatus: http.StatusConflict}
)

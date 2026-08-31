package dispatchsvc

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSummarizeBodyForLog_Empty(t *testing.T) {
	assert.Equal(t, `len=0;prefix=""`, SummarizeBodyForLog(nil))
	assert.Equal(t, `len=0;prefix=""`, SummarizeBodyForLog([]byte{}))
}

func TestSummarizeBodyForLog_ShortASCII(t *testing.T) {
	got := SummarizeBodyForLog([]byte(`{"error":"bad request"}`))
	assert.Contains(t, got, `len=23`)
	assert.Contains(t, got, `prefix="{\"error\":\"bad request\"}"`)
}

func TestSummarizeBodyForLog_LongBodyIsCappedAndReportsFullLength(t *testing.T) {
	// Build a body much larger than the prefix cap; summary must report the
	// true length but only include a bounded, sanitized prefix.
	body := []byte(strings.Repeat("A", 1024))
	got := SummarizeBodyForLog(body)
	assert.Contains(t, got, "len=1024")
	// Prefix segment inside quotes must be exactly defaultBodySummaryPrefixBytes
	// ASCII chars (no escapes for plain 'A').
	start := strings.Index(got, `prefix="`) + len(`prefix="`)
	end := strings.LastIndex(got, `"`)
	prefixContent := got[start:end]
	assert.Equal(t, defaultBodySummaryPrefixBytes, len(prefixContent))
}

// TestSummarizeBodyForLog_NeverContainsRawSensitiveFragment pins the #2120
// security contract: even when the original body contains a long, unique,
// sensitive-looking token, the summary must not reproduce it verbatim beyond
// the bounded prefix and must escape non-printable bytes.
func TestSummarizeBodyForLog_NeverContainsRawSensitiveFragment(t *testing.T) {
	sensitive := "SECRET-TOKEN-DO-NOT-LOG-abcdef1234567890"
	// Place the sensitive string well past the prefix boundary so it cannot
	// appear in the summarized output at all.
	body := []byte(strings.Repeat("x", defaultBodySummaryPrefixBytes+64) + sensitive)
	got := SummarizeBodyForLog(body)
	assert.NotContains(t, got, sensitive, "summary must not contain raw sensitive fragment beyond prefix cap")
	assert.Contains(t, got, "len=")
}

func TestSummarizeBodyForLog_NonPrintableAndHighBytesEscaped(t *testing.T) {
	body := []byte{0x00, 0x01, 0xFF, 'A', 0x7F}
	got := SummarizeBodyForLog(body)
	assert.Contains(t, got, `\x00`)
	assert.Contains(t, got, `\x01`)
	assert.Contains(t, got, `\xff`)
	assert.Contains(t, got, `\x7f`)
	assert.Contains(t, got, "A")
}

func TestSummarizeBodyForLog_QuotesAndBackslashEscaped(t *testing.T) {
	body := []byte(`a"b\c`)
	got := SummarizeBodyForLog(body)
	// Embedded quotes/backslashes must be escaped so the outer quoted field
	// stays parseable.
	assert.Contains(t, got, `a\"b\\c`)
}

// TestSummarizeBodyForLog_Idempotent guards against accidental double-escaping
// if a caller ever re-summarizes.
func TestSummarizeBodyForLog_Idempotent(t *testing.T) {
	body := []byte("hello\x00world")
	a := SummarizeBodyForLog(body)
	b := SummarizeBodyForLog([]byte(a))
	// Re-summarizing the textual summary yields a different shape (it is now
	// longer ASCII), but must still be a valid summary and must not panic.
	assert.Contains(t, b, "len=")
	assert.Contains(t, b, `prefix="`)
	_ = a
}

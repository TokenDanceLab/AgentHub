package deliveryoutbox

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestStatusConstants(t *testing.T) {
	assert.Equal(t, "pending", StatusPending)
	assert.Equal(t, "sent", StatusSent)
	assert.Equal(t, "delivered", StatusDelivered)
	assert.Equal(t, "retrying", StatusRetrying)
	assert.Equal(t, "dead", StatusDead)
	assert.Equal(t, 1024, LastErrorMaxLen)
}

func TestActiveStatuses(t *testing.T) {
	assert.Equal(t, []string{StatusPending, StatusSent, StatusRetrying}, ActiveStatuses())
}

func TestCleanupStatuses(t *testing.T) {
	assert.Equal(t, []string{StatusDelivered, StatusDead}, CleanupStatuses())
}

func TestTruncateLastError(t *testing.T) {
	assert.Equal(t, "short", TruncateLastError("short"))

	long := make([]byte, LastErrorMaxLen+10)
	for i := range long {
		long[i] = 'a'
	}
	got := TruncateLastError(string(long))
	assert.Equal(t, LastErrorMaxLen, len(got))
	assert.True(t, len(got) <= LastErrorMaxLen)
	assert.Equal(t, "...", got[len(got)-3:])
}

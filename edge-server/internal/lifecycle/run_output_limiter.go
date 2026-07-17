package lifecycle

import "sync"

type runOutputLimiter struct {
	mu        sync.Mutex
	maxBytes  int64
	written   int64
	truncated bool
}

func newRunOutputLimiter(maxBytes int64) *runOutputLimiter {
	if maxBytes <= 0 {
		maxBytes = defaultRunOutputMaxBytes
	}
	return &runOutputLimiter{maxBytes: maxBytes}
}

func (l *runOutputLimiter) allow(data []byte) (allowed []byte, truncatedNow bool, written int64, maxBytes int64) {
	l.mu.Lock()
	defer l.mu.Unlock()

	maxBytes = l.maxBytes
	remaining := maxBytes - l.written
	if remaining <= 0 {
		if !l.truncated {
			l.truncated = true
			return nil, true, l.written, maxBytes
		}
		return nil, false, l.written, maxBytes
	}
	if int64(len(data)) <= remaining {
		l.written += int64(len(data))
		return data, false, l.written, maxBytes
	}

	allowed = data[:int(remaining)]
	l.written = maxBytes
	if !l.truncated {
		l.truncated = true
		truncatedNow = true
	}
	return allowed, truncatedNow, l.written, maxBytes
}

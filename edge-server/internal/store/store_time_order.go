package store

import "time"

func nowString() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func removeString(values []string, target string) []string {
	out := values[:0]
	for _, value := range values {
		if value != target {
			out = append(out, value)
		}
	}
	return out
}

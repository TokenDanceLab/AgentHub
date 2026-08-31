package logmask

import "testing"

func TestSensitiveKey(t *testing.T) {
	sensitive := []string{"token", "access_token", "refreshToken", "authorization", "Authorization_Header", "api_key", "apikey", "clientSecret", "password", "cookie", "private_key", "credential"}
	for _, k := range sensitive {
		if !SensitiveKey(k) {
			t.Errorf("SensitiveKey(%q) = false, want true", k)
		}
	}
	benign := []string{"user_id", "task_id", "body_summary", "name", "id", "request_id"}
	for _, k := range benign {
		if SensitiveKey(k) {
			t.Errorf("SensitiveKey(%q) = true, want false", k)
		}
	}
}

func TestAttrMasksSensitive(t *testing.T) {
	a := Attr("access_token", "sk-123")
	if a.Value.String() != "***" {
		t.Fatalf("sensitive attr value = %v, want ***", a.Value)
	}
	b := Attr("task_id", "t-1")
	if b.Value.String() != "t-1" {
		t.Fatalf("benign attr value = %v, want t-1", b.Value)
	}
}

func TestValueNonStringPassthrough(t *testing.T) {
	if got := Value(42); got != 42 {
		t.Fatalf("non-string value = %v, want 42", got)
	}
	if got := Value("anything"); got != "***" {
		t.Fatalf("string value = %v, want ***", got)
	}
}

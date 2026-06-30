package awsx

import (
	"encoding/json"
	"testing"
)

func TestQueueKind(t *testing.T) {
	cases := map[string]string{
		"orders":                 "standard",
		"payments.fifo":          "fifo",
		"notifications-dlq-main": "dlq",
	}
	for in, want := range cases {
		if got := queueKind(in); got != want {
			t.Errorf("queueKind(%q)=%q want %q", in, got, want)
		}
	}
}

func TestParseBody(t *testing.T) {
	if _, ok := parseBody(`{"a":1}`).(json.RawMessage); !ok {
		t.Error("json object should become RawMessage")
	}
	if _, ok := parseBody(`[1,2]`).(json.RawMessage); !ok {
		t.Error("json array should become RawMessage")
	}
	if v, ok := parseBody("hello").(string); !ok || v != "hello" {
		t.Errorf("plain text should stay string, got %T %v", v, v)
	}
	if _, ok := parseBody("{not json").(string); !ok {
		t.Error("invalid json should stay string")
	}
}

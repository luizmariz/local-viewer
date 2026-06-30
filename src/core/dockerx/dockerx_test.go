package dockerx

import (
	"bytes"
	"encoding/binary"
	"testing"
)

func frame(stream byte, payload string) []byte {
	h := make([]byte, 8)
	h[0] = stream
	binary.BigEndian.PutUint32(h[4:], uint32(len(payload)))
	return append(h, []byte(payload)...)
}

func TestDemuxFramed(t *testing.T) {
	var buf bytes.Buffer
	buf.Write(frame(1, "hello "))
	buf.Write(frame(2, "world"))
	if got := demux(&buf); got != "hello world" {
		t.Fatalf("demux framed = %q", got)
	}
}

func TestDemuxRawFallback(t *testing.T) {
	raw := "plain tty log line without frame headers\n"
	if got := demux(bytes.NewBufferString(raw)); got != raw {
		t.Fatalf("demux raw = %q", got)
	}
}

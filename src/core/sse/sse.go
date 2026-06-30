// Package sse implements the Operations Log: an in-memory ring buffer plus a
// Server-Sent Events endpoint, mirroring the Node prototype's /api/logs.
package sse

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type Entry struct {
	Ts      string `json:"ts"`
	Level   string `json:"level"`
	Message string `json:"message"`
	Meta    any    `json:"meta"`
}

type Hub struct {
	mu      sync.Mutex
	buf     []Entry
	max     int
	subs    map[chan Entry]struct{}
}

func NewHub() *Hub {
	return &Hub{max: 200, subs: make(map[chan Entry]struct{})}
}

// Log records an entry and fans it out to subscribers.
func (h *Hub) Log(level, message string, meta any) {
	e := Entry{Ts: time.Now().UTC().Format(time.RFC3339Nano), Level: level, Message: message, Meta: meta}
	h.mu.Lock()
	h.buf = append(h.buf, e)
	if len(h.buf) > h.max {
		h.buf = h.buf[len(h.buf)-h.max:]
	}
	for ch := range h.subs {
		select {
		case ch <- e:
		default:
		}
	}
	h.mu.Unlock()
}

// Handler streams the buffer then live entries as SSE.
func (h *Hub) Handler(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ch := make(chan Entry, 64)
	h.mu.Lock()
	backlog := append([]Entry(nil), h.buf...)
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.subs, ch)
		h.mu.Unlock()
	}()

	fmt.Fprint(w, ":ok\n\n")
	flusher.Flush()
	for _, e := range backlog {
		writeEvent(w, e)
	}
	flusher.Flush()

	ctx := r.Context()
	ping := time.NewTicker(25 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case e := <-ch:
			writeEvent(w, e)
			flusher.Flush()
		case <-ping.C:
			fmt.Fprint(w, ":ping\n\n")
			flusher.Flush()
		}
	}
}

func writeEvent(w http.ResponseWriter, e Entry) {
	b, _ := json.Marshal(e)
	fmt.Fprintf(w, "data: %s\n\n", b)
}

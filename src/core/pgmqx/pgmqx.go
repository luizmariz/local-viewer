// Package pgmqx is a lean viewer for Postgres PGMQ queues. It reads queues,
// metrics and peeks messages non-destructively (querying the underlying
// pgmq.q_<name> tables directly rather than consuming via pgmq.read).
package pgmqx

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/luizmariz/local-viewer/src/core/sse"
)

// Resolver maps a saved connection id to a Postgres DSN.
type Resolver func(id string) (string, bool)

type API struct {
	resolve Resolver
	log     *sse.Hub
}

func New(resolve Resolver, log *sse.Hub) *API { return &API{resolve: resolve, log: log} }

func (a *API) dsn(r *http.Request) string {
	if id := r.URL.Query().Get("conn"); id != "" && a.resolve != nil {
		if dsn, ok := a.resolve(id); ok {
			return dsn
		}
	}
	return r.URL.Query().Get("dsn")
}

func (a *API) connect(ctx context.Context, dsn string) (*pgx.Conn, error) {
	c, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	return pgx.Connect(c, dsn)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (a *API) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/pgmq/queues", a.queues)
	mux.HandleFunc("GET /api/pgmq/messages", a.messages)
}

type pqueue struct {
	Name        string `json:"name"`
	Length      int64  `json:"length"`
	Total       int64  `json:"total"`
	OldestSec   *int64 `json:"oldestSec"`
	NewestSec   *int64 `json:"newestSec"`
	Partitioned bool   `json:"partitioned"`
}

func (a *API) queues(w http.ResponseWriter, r *http.Request) {
	dsn := a.dsn(r)
	if dsn == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing conn or dsn"})
		return
	}
	conn, err := a.connect(r.Context(), dsn)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	defer conn.Close(r.Context())

	rows, err := conn.Query(r.Context(), `SELECT queue_name, is_partitioned FROM pgmq.list_queues()`)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	type qrow struct {
		name        string
		partitioned bool
	}
	var qs []qrow
	for rows.Next() {
		var q qrow
		if err := rows.Scan(&q.name, &q.partitioned); err == nil {
			qs = append(qs, q)
		}
	}
	rows.Close()

	out := make([]pqueue, 0, len(qs))
	for _, q := range qs {
		pq := pqueue{Name: q.name, Partitioned: q.partitioned}
		// metrics: queue_length, total_messages, oldest/newest age
		var ql, tot *int64
		var oldest, newest *int64
		_ = conn.QueryRow(r.Context(),
			`SELECT queue_length, total_messages, oldest_msg_age_sec, newest_msg_age_sec FROM pgmq.metrics($1)`, q.name).
			Scan(&ql, &tot, &oldest, &newest)
		if ql != nil {
			pq.Length = *ql
		}
		if tot != nil {
			pq.Total = *tot
		}
		pq.OldestSec, pq.NewestSec = oldest, newest
		out = append(out, pq)
	}
	writeJSON(w, http.StatusOK, map[string]any{"queues": out})
}

var safeName = regexp.MustCompile(`^[A-Za-z0-9_]+$`)

type pmsg struct {
	MsgID     int64  `json:"msgId"`
	ReadCt    int    `json:"readCt"`
	EnqueuedAt string `json:"enqueuedAt"`
	Body      any    `json:"body"`
}

func (a *API) messages(w http.ResponseWriter, r *http.Request) {
	dsn := a.dsn(r)
	queue := r.URL.Query().Get("queue")
	if dsn == "" || queue == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing conn/dsn or queue"})
		return
	}
	if !safeName.MatchString(queue) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid queue name"})
		return
	}
	conn, err := a.connect(r.Context(), dsn)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	defer conn.Close(r.Context())

	// Non-destructive peek: read the underlying queue table directly.
	rows, err := conn.Query(r.Context(),
		`SELECT msg_id, read_ct, enqueued_at, message FROM pgmq.q_`+queue+` ORDER BY msg_id LIMIT 20`)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	out := []pmsg{}
	for rows.Next() {
		var m pmsg
		var enq time.Time
		var body []byte
		if err := rows.Scan(&m.MsgID, &m.ReadCt, &enq, &body); err != nil {
			continue
		}
		m.EnqueuedAt = enq.UTC().Format(time.RFC3339)
		if json.Valid(body) {
			m.Body = json.RawMessage(body)
		} else {
			m.Body = string(body)
		}
		out = append(out, m)
	}
	writeJSON(w, http.StatusOK, map[string]any{"queue": queue, "messages": out})
}

// Package kafkax is a lean Kafka viewer: list topics (partitions + approx
// message counts) and peek recent messages. Uses segmentio/kafka-go.
package kafkax

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"time"

	kafka "github.com/segmentio/kafka-go"

	"github.com/luizmariz/local-viewer/src/core/sse"
)

// Resolver maps a saved connection id to a broker address (host:port).
type Resolver func(id string) (string, bool)

type API struct {
	resolve Resolver
	log     *sse.Hub
}

func New(resolve Resolver, log *sse.Hub) *API { return &API{resolve: resolve, log: log} }

func (a *API) broker(r *http.Request) string {
	if id := r.URL.Query().Get("conn"); id != "" && a.resolve != nil {
		if b, ok := a.resolve(id); ok {
			return b
		}
	}
	return r.URL.Query().Get("broker")
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (a *API) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/kafka/topics", a.topics)
	mux.HandleFunc("GET /api/kafka/messages", a.messages)
}

type topic struct {
	Name       string `json:"name"`
	Partitions int    `json:"partitions"`
	Messages   int64  `json:"messages"`
}

func (a *API) topics(w http.ResponseWriter, r *http.Request) {
	broker := a.broker(r)
	if broker == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing conn or broker"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	conn, err := kafka.DialContext(ctx, "tcp", broker)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	defer conn.Close()
	parts, err := conn.ReadPartitions()
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	byTopic := map[string][]kafka.Partition{}
	for _, p := range parts {
		byTopic[p.Topic] = append(byTopic[p.Topic], p)
	}
	out := make([]topic, 0, len(byTopic))
	for name, ps := range byTopic {
		t := topic{Name: name, Partitions: len(ps)}
		for _, p := range ps {
			lc, err := kafka.DialLeader(ctx, "tcp", broker, name, p.ID)
			if err != nil {
				continue
			}
			first, _ := lc.ReadFirstOffset()
			last, _ := lc.ReadLastOffset()
			lc.Close()
			if last > first {
				t.Messages += last - first
			}
		}
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	writeJSON(w, http.StatusOK, map[string]any{"topics": out})
}

type kmsg struct {
	Partition int    `json:"partition"`
	Offset    int64  `json:"offset"`
	Key       string `json:"key"`
	Time      string `json:"time"`
	Body      any    `json:"body"`
}

func (a *API) messages(w http.ResponseWriter, r *http.Request) {
	broker := a.broker(r)
	topicName := r.URL.Query().Get("topic")
	if broker == "" || topicName == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing conn/broker or topic"})
		return
	}
	limit := 20
	if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && v > 0 && v <= 100 {
		limit = v
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	conn, err := kafka.DialContext(ctx, "tcp", broker)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	parts, err := conn.ReadPartitions(topicName)
	conn.Close()
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}

	out := []kmsg{}
	for _, p := range parts {
		lc, err := kafka.DialLeader(ctx, "tcp", broker, topicName, p.ID)
		if err != nil {
			continue
		}
		first, _ := lc.ReadFirstOffset()
		last, _ := lc.ReadLastOffset()
		lc.Close()
		if last <= first {
			continue
		}
		start := last - int64(limit)
		if start < first {
			start = first
		}
		rd := kafka.NewReader(kafka.ReaderConfig{Brokers: []string{broker}, Topic: topicName, Partition: p.ID})
		_ = rd.SetOffset(start)
		for read := int64(0); read < last-start; read++ {
			m, err := rd.ReadMessage(ctx)
			if err != nil {
				break
			}
			msg := kmsg{Partition: m.Partition, Offset: m.Offset, Key: string(m.Key), Time: m.Time.UTC().Format(time.RFC3339)}
			if json.Valid(m.Value) {
				msg.Body = json.RawMessage(m.Value)
			} else {
				msg.Body = string(m.Value)
			}
			out = append(out, msg)
			if m.Offset >= last-1 {
				break
			}
		}
		rd.Close()
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Time < out[j].Time })
	if len(out) > limit {
		out = out[len(out)-limit:]
	}
	writeJSON(w, http.StatusOK, map[string]any{"topic": topicName, "messages": out})
}

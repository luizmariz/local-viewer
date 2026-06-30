// Command local-viewer is the Go backend for the viewer (embedded SPA + APIs).
//
// Serves the embedded SPA plus the AWS-compatible viewer API. SQLite
// connections, OTP auth, and the Docker view are layered on in later phases —
// see IMPLEMENTATION_PLAN.md.
package main

import (
	"context"
	"embed"
	"encoding/json"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/luizmariz/local-viewer/src/core/auth"
	"github.com/luizmariz/local-viewer/src/core/awsx"
	"github.com/luizmariz/local-viewer/src/core/dockerx"
	"github.com/luizmariz/local-viewer/src/core/kafkax"
	"github.com/luizmariz/local-viewer/src/core/pgmqx"
	"github.com/luizmariz/local-viewer/src/core/sse"
	"github.com/luizmariz/local-viewer/src/core/store"
)

//go:embed view
var viewFS embed.FS

// Version is overridable at build time: -ldflags "-X main.Version=1.2.3".
var Version = "0.1.0-dev"

func main() {
	addr := envOr("LSV_ADDR", ":8080")
	flag.StringVar(&addr, "addr", addr, "listen address (env: LSV_ADDR)")
	flag.Parse()

	ui, err := fs.Sub(viewFS, "view")
	if err != nil {
		log.Fatalf("embed view: %v", err)
	}

	dataDir := envOr("LSV_DATA", "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		log.Fatalf("data dir: %v", err)
	}
	st, err := store.Open(filepath.Join(dataDir, "lsv.db"))
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer st.Close()

	hub := sse.NewHub()
	api := awsx.New(awsx.Conn{
		Endpoint:  envOr("LSV_AWS_ENDPOINT", "http://localhost:4566"),
		Region:    envOr("AWS_DEFAULT_REGION", "us-east-1"),
		AccessKey: envOr("AWS_ACCESS_KEY_ID", "test"),
		SecretKey: envOr("AWS_SECRET_ACCESS_KEY", "test"),
	}, atoiDefault(os.Getenv("LSV_PEEK"), 5), hub)
	api.Resolver = st
	docker := dockerx.New(envOr("LSV_DOCKER_HOST", "/var/run/docker.sock"), hub)
	pgmq := pgmqx.New(func(id string) (string, bool) { return st.ResolveEndpoint(id, "pgmq") }, hub)
	kfk := kafkax.New(func(id string) (string, bool) { return st.ResolveEndpoint(id, "kafka") }, hub)
	authMgr := auth.New(st)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"status": "ok", "version": Version, "time": time.Now().UTC().Format(time.RFC3339)})
	})
	mux.HandleFunc("GET /api/version", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"version": Version})
	})
	mux.HandleFunc("GET /api/logs", hub.Handler)
	api.Register(mux)
	docker.Register(mux)
	pgmq.Register(mux)
	kfk.Register(mux)
	st.RegisterConnections(mux)
	authMgr.Register(mux)
	mux.Handle("/", http.FileServer(http.FS(ui)))

	handler := withRecover(withLogging(authMgr.Guard(mux)))
	srv := &http.Server{Addr: addr, Handler: handler, ReadHeaderTimeout: 10 * time.Second}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		log.Printf("local-viewer %s listening on %s", Version, addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	<-ctx.Done()
	log.Println("shutting down…")
	sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(sctx)
}

func withRecover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				log.Printf("panic: %v", v)
				w.Header().Set("content-type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": "internal error"})
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func atoiDefault(s string, def int) int {
	n := 0
	if s == "" {
		return def
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return def
		}
		n = n*10 + int(c-'0')
	}
	return n
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}

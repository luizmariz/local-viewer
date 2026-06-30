package awsx

import (
	"encoding/json"
	"io"
	"net/http"
)

func (a *API) connFromQuery(r *http.Request) Conn {
	if id := r.URL.Query().Get("conn"); id != "" && a.Resolver != nil {
		if c, ok := a.Resolver.Resolve(id); ok {
			return c
		}
	}
	return Conn{Endpoint: r.URL.Query().Get("endpoint")}
}

func (a *API) connFromBody(b map[string]string) Conn {
	if id := b["conn"]; id != "" && a.Resolver != nil {
		if c, ok := a.Resolver.Resolve(id); ok {
			return c
		}
	}
	return Conn{Endpoint: b["endpoint"]}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// Register wires the AWS viewer endpoints onto mux.
func (a *API) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/state", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, a.buildState(r.Context(), a.connFromQuery(r)))
	})

	mux.HandleFunc("GET /api/objects", func(w http.ResponseWriter, r *http.Request) {
		bkt := r.URL.Query().Get("bucket")
		writeJSON(w, http.StatusOK, map[string]any{"bucket": bkt, "objects": a.listObjects(r.Context(), a.connFromQuery(r), bkt)})
	})

	mux.HandleFunc("GET /api/object", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		bkt, key := q.Get("bucket"), q.Get("key")
		if bkt == "" || key == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing bucket or key"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"key": key, "body": a.readObject(r.Context(), a.connFromQuery(r), bkt, key)})
	})

	mux.HandleFunc("PUT /api/object", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Conn, Endpoint, Bucket, Key, Body, ContentType string }
		_ = json.NewDecoder(r.Body).Decode(&b)
		if b.Bucket == "" || b.Key == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing bucket or key"})
			return
		}
		a.log.Log("info", "saving s3://"+b.Bucket+"/"+b.Key, nil)
		if err := a.putObject(r.Context(), a.connFromBody(map[string]string{"conn": b.Conn, "endpoint": b.Endpoint}), b.Bucket, b.Key, b.Body, b.ContentType); err != nil {
			a.log.Log("error", "save failed for "+b.Key, map[string]string{"error": err.Error()})
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		a.log.Log("ok", "saved "+b.Key, map[string]string{"bucket": b.Bucket})
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	// raw bytes of an object, served with its content type — used by the UI to
	// render images in an <img> and to offer binary downloads (no byte-dumping).
	mux.HandleFunc("GET /api/object/raw", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		bkt, key := q.Get("bucket"), q.Get("key")
		if bkt == "" || key == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing bucket or key"})
			return
		}
		data, ct, err := a.getObjectRaw(r.Context(), a.connFromQuery(r), bkt, key)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
			return
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(data)
	})

	// raw binary upload (files / images): body is the object bytes, content type
	// from the request header; bucket/key/conn from the query string.
	mux.HandleFunc("PUT /api/object/raw", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		bkt, key := q.Get("bucket"), q.Get("key")
		if bkt == "" || key == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing bucket or key"})
			return
		}
		data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<20)) // 64 MiB cap
		if err != nil {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "file too large (max 64 MiB)"})
			return
		}
		a.log.Log("info", "uploading s3://"+bkt+"/"+key+" ("+itoa(len(data))+" bytes)", nil)
		if err := a.putObjectBytes(r.Context(), a.connFromQuery(r), bkt, key, data, r.Header.Get("Content-Type")); err != nil {
			a.log.Log("error", "upload failed for "+key, map[string]string{"error": err.Error()})
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		a.log.Log("ok", "uploaded "+key, map[string]string{"bucket": bkt})
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	mux.HandleFunc("DELETE /api/object", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		bkt, key := q.Get("bucket"), q.Get("key")
		if bkt == "" || key == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing bucket or key"})
			return
		}
		a.log.Log("info", "deleting s3://"+bkt+"/"+key, nil)
		if err := a.deleteObject(r.Context(), a.connFromQuery(r), bkt, key); err != nil {
			a.log.Log("error", "delete failed for "+key, map[string]string{"error": err.Error()})
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		a.log.Log("ok", "deleted "+key, map[string]string{"bucket": bkt})
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	mux.HandleFunc("POST /api/queue/purge", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		url := body["queueUrl"]
		name := lastSeg(url)
		a.log.Log("info", "purging queue "+name, nil)
		if err := a.purgeQueue(r.Context(), a.connFromBody(body), url); err != nil {
			a.log.Log("error", "purge failed for "+name, map[string]string{"error": err.Error()})
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		a.log.Log("ok", "purged "+name, nil)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	mux.HandleFunc("POST /api/queue/redrive", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		url := body["queueUrl"]
		name := lastSeg(url)
		a.log.Log("info", "redriving "+name, nil)
		moved, src, err := a.redriveDLQ(r.Context(), a.connFromBody(body), url)
		if err != nil {
			a.log.Log("error", "redrive failed for "+name, map[string]string{"error": err.Error()})
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		a.log.Log("ok", "redrove "+itoa(moved)+" message(s) from "+name, map[string]string{"source": lastSeg(src)})
		writeJSON(w, http.StatusOK, map[string]any{"moved": moved, "sourceUrl": src})
	})

	mux.HandleFunc("POST /api/changeset/execute", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		ref := body["stackId"]
		if ref == "" {
			ref = body["stackName"]
		}
		cs := body["changeSetName"]
		a.log.Log("info", "executing changeset "+cs+" on "+body["stackName"], nil)
		if err := a.executeChangeset(r.Context(), a.connFromBody(body), ref, cs); err != nil {
			a.log.Log("error", "execute failed for "+cs, map[string]string{"error": err.Error()})
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		a.log.Log("ok", "submitted changeset "+cs, map[string]string{"stack": body["stackName"]})
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
}

func lastSeg(s string) string {
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] == '/' {
			return s[i+1:]
		}
	}
	return s
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

// Package auth provides a lean first-run lock: the user sets a 6-digit PIN,
// which is stored hashed (sha256 over the server signing key + PIN, then
// encrypted at rest by the store). Login verifies the PIN and issues a signed,
// httpOnly session cookie. It's deliberately simple — just a lock, not TOTP.
package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Store is the subset of the persistence layer auth needs.
type Store interface {
	AuthConfigured() (bool, error)
	SetAuthHash(hash string) error
	AuthHash() (hash string, ok bool, err error)
	DeleteAuth() error
	SigningKey() []byte
}

type Manager struct {
	store  Store
	ttl    time.Duration
	cookie string
}

func New(s Store) *Manager {
	return &Manager{store: s, ttl: 12 * time.Hour, cookie: "lsv_session"}
}

// ---- PIN ----

// ValidPIN reports whether s is exactly 6 digits.
func ValidPIN(s string) bool {
	s = strings.TrimSpace(s)
	if len(s) != 6 {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// HashPIN derives a stable hash for a PIN, keyed by the server signing key.
func (m *Manager) HashPIN(pin string) string {
	mac := hmac.New(sha256.New, m.store.SigningKey())
	mac.Write([]byte(strings.TrimSpace(pin)))
	return hex.EncodeToString(mac.Sum(nil))
}

// CheckPIN constant-time compares a PIN against the stored hash.
func (m *Manager) CheckPIN(pin string) bool {
	if !ValidPIN(pin) {
		return false
	}
	stored, ok, err := m.store.AuthHash()
	if err != nil || !ok {
		return false
	}
	return hmac.Equal([]byte(stored), []byte(m.HashPIN(pin)))
}

// ---- sessions (signed cookie) ----

func (m *Manager) issue() string {
	exp := strconv.FormatInt(time.Now().Add(m.ttl).Unix(), 10)
	return exp + "." + m.sign(exp)
}

func (m *Manager) sign(payload string) string {
	mac := hmac.New(sha256.New, m.store.SigningKey())
	mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

func (m *Manager) verify(tok string) bool {
	parts := strings.SplitN(tok, ".", 2)
	if len(parts) != 2 {
		return false
	}
	if !hmac.Equal([]byte(m.sign(parts[0])), []byte(parts[1])) {
		return false
	}
	exp, err := strconv.ParseInt(parts[0], 10, 64)
	return err == nil && time.Now().Unix() < exp
}

func (m *Manager) setCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: m.cookie, Value: m.issue(), Path: "/",
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Expires: time.Now().Add(m.ttl),
	})
}
func (m *Manager) clearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: m.cookie, Value: "", Path: "/", HttpOnly: true, MaxAge: -1})
}
func (m *Manager) authed(r *http.Request) bool {
	c, err := r.Cookie(m.cookie)
	return err == nil && m.verify(c.Value)
}

// ---- middleware ----

// Guard protects /api/* once auth is configured. Health, version and the
// /api/auth/* endpoints stay open; static assets are always served (the SPA
// shows a login overlay on 401).
func (m *Manager) Guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		gated := strings.HasPrefix(p, "/api/") && p != "/api/version" && !strings.HasPrefix(p, "/api/auth/")
		if !gated {
			next.ServeHTTP(w, r)
			return
		}
		configured, _ := m.store.AuthConfigured()
		if !configured || m.authed(r) {
			next.ServeHTTP(w, r)
			return
		}
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
	})
}

// ---- handlers ----

func (m *Manager) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/auth/status", func(w http.ResponseWriter, r *http.Request) {
		configured, _ := m.store.AuthConfigured()
		writeJSON(w, http.StatusOK, map[string]any{"configured": configured, "authenticated": !configured || m.authed(r)})
	})

	// Setup: enroll a 6-digit PIN in one step (only allowed when unconfigured).
	mux.HandleFunc("POST /api/auth/setup", func(w http.ResponseWriter, r *http.Request) {
		if configured, _ := m.store.AuthConfigured(); configured {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "already configured"})
			return
		}
		var b struct{ Code string }
		_ = json.NewDecoder(r.Body).Decode(&b)
		if !ValidPIN(b.Code) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "PIN must be exactly 6 digits"})
			return
		}
		if err := m.store.SetAuthHash(m.HashPIN(b.Code)); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		m.setCookie(w)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	mux.HandleFunc("POST /api/auth/login", func(w http.ResponseWriter, r *http.Request) {
		if configured, _ := m.store.AuthConfigured(); !configured {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "not configured"})
			return
		}
		var b struct{ Code string }
		_ = json.NewDecoder(r.Body).Decode(&b)
		if !m.CheckPIN(b.Code) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid PIN"})
			return
		}
		m.setCookie(w)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	mux.HandleFunc("POST /api/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		m.clearCookie(w)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	// Change the PIN: requires the current PIN (so it's safe even though
	// /api/auth/* is not session-gated).
	mux.HandleFunc("POST /api/auth/change", func(w http.ResponseWriter, r *http.Request) {
		if configured, _ := m.store.AuthConfigured(); !configured {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "not configured"})
			return
		}
		var b struct{ Current, Code string }
		_ = json.NewDecoder(r.Body).Decode(&b)
		if !m.CheckPIN(b.Current) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "current PIN is incorrect"})
			return
		}
		if !ValidPIN(b.Code) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "new PIN must be exactly 6 digits"})
			return
		}
		if err := m.store.SetAuthHash(m.HashPIN(b.Code)); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		m.setCookie(w)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	// Disable the lock entirely: requires the current PIN.
	mux.HandleFunc("POST /api/auth/disable", func(w http.ResponseWriter, r *http.Request) {
		if configured, _ := m.store.AuthConfigured(); !configured {
			writeJSON(w, http.StatusOK, map[string]any{"ok": true})
			return
		}
		var b struct{ Current string }
		_ = json.NewDecoder(r.Body).Decode(&b)
		if !m.CheckPIN(b.Current) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "current PIN is incorrect"})
			return
		}
		if err := m.store.DeleteAuth(); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		m.clearCookie(w)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

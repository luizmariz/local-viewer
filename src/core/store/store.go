// Package store is the SQLite-backed persistence layer: connections (to
// AWS-compatible / Kafka / PGMQ targets) and the single auth record. Secrets
// are encrypted at rest with AES-GCM using a key generated on first run.
package store

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/luizmariz/local-viewer/src/core/awsx"

	_ "modernc.org/sqlite"
)

type Store struct {
	db  *sql.DB
	key []byte // 32-byte AES key
}

// Connection is a saved target. Kind ∈ {aws, kafka, pgmq}.
type Connection struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Kind      string            `json:"kind"`
	Endpoint  string            `json:"endpoint"`
	Region    string            `json:"region"`
	AccessKey string            `json:"accessKey"`
	SecretKey string            `json:"secretKey,omitempty"`
	Opts      map[string]string `json:"opts"`
	CreatedAt string            `json:"createdAt"`
}

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // SQLite: serialize writers
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		return nil, err
	}
	if err := s.loadOrCreateKey(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  endpoint TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  access_key TEXT NOT NULL DEFAULT '',
  secret_enc TEXT NOT NULL DEFAULT '',
  opts TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  otp_secret_enc TEXT NOT NULL,
  created_at TEXT NOT NULL
);`)
	return err
}

// ---- settings kv ----

func (s *Store) getSetting(k string) (string, bool, error) {
	var v string
	err := s.db.QueryRow(`SELECT v FROM settings WHERE k=?`, k).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	return v, err == nil, err
}
func (s *Store) setSetting(k, v string) error {
	_, err := s.db.Exec(`INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`, k, v)
	return err
}

// ---- encryption ----

func (s *Store) loadOrCreateKey() error {
	if v, ok, err := s.getSetting("enc_key"); err != nil {
		return err
	} else if ok {
		s.key, err = base64.StdEncoding.DecodeString(v)
		return err
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return err
	}
	s.key = key
	return s.setSetting("enc_key", base64.StdEncoding.EncodeToString(key))
}

func (s *Store) encrypt(plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	block, err := aes.NewCipher(s.key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ct := gcm.Seal(nonce, nonce, []byte(plain), nil)
	return base64.StdEncoding.EncodeToString(ct), nil
}

func (s *Store) decrypt(enc string) (string, error) {
	if enc == "" {
		return "", nil
	}
	raw, err := base64.StdEncoding.DecodeString(enc)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(s.key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("ciphertext too short")
	}
	nonce, ct := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	pt, err := gcm.Open(nil, nonce, ct, nil)
	return string(pt), err
}

// ---- connections CRUD ----

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%x", b)
}

func (s *Store) ListConnections() ([]Connection, error) {
	rows, err := s.db.Query(`SELECT id,name,kind,endpoint,region,access_key,secret_enc,opts,created_at FROM connections ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Connection
	for rows.Next() {
		c, err := scanConn(rows, s)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) GetConnection(id string) (Connection, bool, error) {
	row := s.db.QueryRow(`SELECT id,name,kind,endpoint,region,access_key,secret_enc,opts,created_at FROM connections WHERE id=?`, id)
	c, err := scanConn(row, s)
	if errors.Is(err, sql.ErrNoRows) {
		return Connection{}, false, nil
	}
	return c, err == nil, err
}

type scanner interface{ Scan(...any) error }

func scanConn(r scanner, s *Store) (Connection, error) {
	var c Connection
	var secretEnc, opts string
	if err := r.Scan(&c.ID, &c.Name, &c.Kind, &c.Endpoint, &c.Region, &c.AccessKey, &secretEnc, &opts, &c.CreatedAt); err != nil {
		return c, err
	}
	sec, err := s.decrypt(secretEnc)
	if err != nil {
		return c, err
	}
	c.SecretKey = sec
	c.Opts = map[string]string{}
	_ = json.Unmarshal([]byte(opts), &c.Opts)
	return c, nil
}

func (s *Store) CreateConnection(c Connection) (Connection, error) {
	if c.ID == "" {
		c.ID = newID()
	}
	if c.CreatedAt == "" {
		c.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	if c.Kind == "" {
		c.Kind = "aws"
	}
	enc, err := s.encrypt(c.SecretKey)
	if err != nil {
		return c, err
	}
	opts, _ := json.Marshal(c.Opts)
	_, err = s.db.Exec(`INSERT INTO connections(id,name,kind,endpoint,region,access_key,secret_enc,opts,created_at)
		VALUES(?,?,?,?,?,?,?,?,?)`,
		c.ID, c.Name, c.Kind, c.Endpoint, c.Region, c.AccessKey, enc, string(opts), c.CreatedAt)
	return c, err
}

func (s *Store) UpdateConnection(c Connection) error {
	enc, err := s.encrypt(c.SecretKey)
	if err != nil {
		return err
	}
	opts, _ := json.Marshal(c.Opts)
	_, err = s.db.Exec(`UPDATE connections SET name=?,kind=?,endpoint=?,region=?,access_key=?,secret_enc=?,opts=? WHERE id=?`,
		c.Name, c.Kind, c.Endpoint, c.Region, c.AccessKey, enc, string(opts), c.ID)
	return err
}

func (s *Store) DeleteConnection(id string) error {
	_, err := s.db.Exec(`DELETE FROM connections WHERE id=?`, id)
	return err
}

// ---- auth (single OTP record) ----

// SigningKey returns the server key used to sign session cookies.
func (s *Store) SigningKey() []byte { return s.key }

func (s *Store) AuthConfigured() (bool, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM auth WHERE id=1`).Scan(&n)
	return n > 0, err
}

// DeleteAuth removes the auth record, disabling the PIN lock.
func (s *Store) DeleteAuth() error {
	_, err := s.db.Exec(`DELETE FROM auth WHERE id=1`)
	return err
}

// SetAuthHash stores the (encrypted-at-rest) PIN hash that gates login.
func (s *Store) SetAuthHash(hash string) error {
	enc, err := s.encrypt(hash)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO auth(id,otp_secret_enc,created_at) VALUES(1,?,?)
		ON CONFLICT(id) DO UPDATE SET otp_secret_enc=excluded.otp_secret_enc`, enc, time.Now().UTC().Format(time.RFC3339))
	return err
}

// AuthHash returns the stored PIN hash, if auth has been configured.
func (s *Store) AuthHash() (string, bool, error) {
	var enc string
	err := s.db.QueryRow(`SELECT otp_secret_enc FROM auth WHERE id=1`).Scan(&enc)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	sec, err := s.decrypt(enc)
	return sec, true, err
}

// Resolve implements awsx.Resolver: map a saved connection to an awsx.Conn.
func (s *Store) Resolve(id string) (awsx.Conn, bool) {
	c, ok, err := s.GetConnection(id)
	if err != nil || !ok || c.Kind != "aws" {
		return awsx.Conn{}, false
	}
	return awsx.Conn{Endpoint: c.Endpoint, Region: c.Region, AccessKey: c.AccessKey, SecretKey: c.SecretKey}, true
}

// ResolveEndpoint returns the endpoint/DSN/broker for a connection of the given
// kind (used by the kafka/pgmq providers). The password (if any) lives in the
// endpoint DSN or in opts; kept simple for now.
func (s *Store) ResolveEndpoint(id, kind string) (string, bool) {
	c, ok, err := s.GetConnection(id)
	if err != nil || !ok || c.Kind != kind {
		return "", false
	}
	return c.Endpoint, true
}

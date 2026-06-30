package store

import (
	"path/filepath"
	"testing"
)

func openTemp(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestConnectionCRUDAndSecretEncryption(t *testing.T) {
	s := openTemp(t)

	c, err := s.CreateConnection(Connection{
		Name: "local", Kind: "aws", Endpoint: "http://localhost:4566",
		Region: "us-east-1", AccessKey: "test", SecretKey: "supersecret",
		Opts: map[string]string{"x": "y"},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if c.ID == "" {
		t.Fatal("expected generated id")
	}

	// secret is stored encrypted, not plaintext
	var raw string
	if err := s.db.QueryRow(`SELECT secret_enc FROM connections WHERE id=?`, c.ID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if raw == "" || raw == "supersecret" {
		t.Fatalf("secret not encrypted at rest: %q", raw)
	}

	got, ok, err := s.GetConnection(c.ID)
	if err != nil || !ok {
		t.Fatalf("get: %v ok=%v", err, ok)
	}
	if got.SecretKey != "supersecret" {
		t.Fatalf("decrypt mismatch: %q", got.SecretKey)
	}
	if got.Opts["x"] != "y" {
		t.Fatalf("opts not round-tripped: %v", got.Opts)
	}

	// resolve maps to awsx.Conn
	rc, ok := s.Resolve(c.ID)
	if !ok || rc.Endpoint != "http://localhost:4566" || rc.SecretKey != "supersecret" {
		t.Fatalf("resolve: %+v ok=%v", rc, ok)
	}

	// update
	got.Name = "renamed"
	got.SecretKey = "" // keep
	if err := s.UpdateConnection(Connection{ID: got.ID, Name: "renamed", Kind: "aws", Endpoint: got.Endpoint, SecretKey: "supersecret"}); err != nil {
		t.Fatalf("update: %v", err)
	}
	list, err := s.ListConnections()
	if err != nil || len(list) != 1 || list[0].Name != "renamed" {
		t.Fatalf("list after update: %v %+v", err, list)
	}

	// delete
	if err := s.DeleteConnection(c.ID); err != nil {
		t.Fatal(err)
	}
	if list, _ := s.ListConnections(); len(list) != 0 {
		t.Fatalf("expected empty after delete, got %d", len(list))
	}
}

func TestAuthHashStorage(t *testing.T) {
	s := openTemp(t)
	if ok, _ := s.AuthConfigured(); ok {
		t.Fatal("should start unconfigured")
	}
	if err := s.SetAuthHash("deadbeefhash"); err != nil {
		t.Fatal(err)
	}
	if ok, _ := s.AuthConfigured(); !ok {
		t.Fatal("should be configured")
	}

	// stored hash is encrypted at rest, not plaintext
	var raw string
	if err := s.db.QueryRow(`SELECT otp_secret_enc FROM auth WHERE id=1`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if raw == "" || raw == "deadbeefhash" {
		t.Fatalf("auth hash not encrypted at rest: %q", raw)
	}

	h, ok, err := s.AuthHash()
	if err != nil || !ok || h != "deadbeefhash" {
		t.Fatalf("auth hash: %q ok=%v err=%v", h, ok, err)
	}
}

func TestEncryptionKeyPersists(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "p.db")
	s1, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	c, _ := s1.CreateConnection(Connection{Name: "n", SecretKey: "abc"})
	s1.Close()

	s2, err := Open(path) // reopen: key must be reused to decrypt
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	got, ok, err := s2.GetConnection(c.ID)
	if err != nil || !ok || got.SecretKey != "abc" {
		t.Fatalf("reopen decrypt: %q ok=%v err=%v", got.SecretKey, ok, err)
	}
}

package auth

import (
	"strconv"
	"testing"
	"time"
)

func TestValidPIN(t *testing.T) {
	good := []string{"123456", "000000", "999999"}
	for _, g := range good {
		if !ValidPIN(g) {
			t.Fatalf("%q should be a valid PIN", g)
		}
	}
	bad := []string{"", "12345", "1234567", "12a456", "abcdef", " 12345"}
	for _, b := range bad {
		if ValidPIN(b) {
			t.Fatalf("%q should be rejected", b)
		}
	}
}

func TestHashAndCheckPIN(t *testing.T) {
	fs := &fakeStore{key: []byte("0123456789abcdef0123456789abcdef")}
	m := New(fs)

	// not configured yet → any PIN fails
	if m.CheckPIN("123456") {
		t.Fatal("should not validate before setup")
	}

	hash := m.HashPIN("123456")
	if hash == "" || hash == "123456" {
		t.Fatalf("hash should be derived, not plaintext: %q", hash)
	}
	_ = fs.SetAuthHash(hash)

	if !m.CheckPIN("123456") {
		t.Fatal("correct PIN should validate")
	}
	if m.CheckPIN("654321") {
		t.Fatal("wrong PIN must not validate")
	}
	if m.CheckPIN("12345") {
		t.Fatal("malformed PIN must not validate")
	}
}

type fakeStore struct {
	hash string
	set  bool
	key  []byte
}

func (f *fakeStore) AuthConfigured() (bool, error)   { return f.set, nil }
func (f *fakeStore) SetAuthHash(h string) error      { f.hash, f.set = h, true; return nil }
func (f *fakeStore) AuthHash() (string, bool, error) { return f.hash, f.set, nil }
func (f *fakeStore) DeleteAuth() error               { f.hash, f.set = "", false; return nil }
func (f *fakeStore) SigningKey() []byte              { return f.key }

func TestSessionSignVerify(t *testing.T) {
	m := New(&fakeStore{key: []byte("0123456789abcdef0123456789abcdef")})
	tok := m.issue()
	if !m.verify(tok) {
		t.Fatal("freshly issued token should verify")
	}
	if m.verify(tok + "x") {
		t.Fatal("tampered token must not verify")
	}
	// expired
	expired := strconv.FormatInt(time.Now().Add(-time.Minute).Unix(), 10)
	if m.verify(expired + "." + m.sign(expired)) {
		t.Fatal("expired token must not verify")
	}
}

// AES-256 per-user encryption over health-data records with a separated key
// store (Task 3.1, server-side Go counterpart of shared/src/crypto).
//
// The design's security model ("Compliance by construction") requires that
// stored health data is encrypted at rest with **per-user** AES-256 keys and
// that the key material is held **separately from the ciphertext**
// (Requirement 25.1, Property 53).
//
// This mirrors the shared TypeScript contract (shared/src/crypto/*): an
// injectable KeyStore port holding per-user key material, plus an
// AES-256-GCM Encryptor that produces an EncryptedRecord carrying only an
// algorithm identifier, a keyId *reference*, the IV, the auth tag, and the
// ciphertext — never the key itself.
//
// Requirements: 25.1
package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"io"
)

// EncryptionAlgorithm is the AES mode used for at-rest health-data encryption.
const EncryptionAlgorithm = "aes-256-gcm"

const (
	// AES256KeyBytes is the AES-256 key length in bytes (256 bits).
	AES256KeyBytes = 32
	// GCMIVBytes is the GCM initialization-vector length (96-bit standard IV).
	GCMIVBytes = 12
	// GCMAuthTagBytes is the GCM authentication-tag length (128-bit tag).
	GCMAuthTagBytes = 16
)

// Crypto error codes (stable, machine-readable).
const (
	CryptoErrKeyUnavailable   = "crypto.key_unavailable"
	CryptoErrUnsupportedAlgo  = "crypto.unsupported_algorithm"
	CryptoErrMalformedRecord  = "crypto.malformed_record"
	CryptoErrDecryptionFailed = "crypto.decryption_failed"
)

// KeyStore is the separated key store: it maps a stable key identifier
// (typically the user id) to that user's raw AES-256 key material.
//
// Implementations MUST keep key material outside of any ciphertext container
// and MUST return keys of exactly AES256KeyBytes bytes.
type KeyStore interface {
	// GetKey returns the raw key for keyId, or (nil, false) if none exists.
	GetKey(keyID string) ([]byte, bool)
	// GetOrCreateKey returns the existing key for keyId, generating and
	// persisting a fresh cryptographically-random AES-256 key on first use.
	GetOrCreateKey(keyID string) []byte
	// DeleteKey removes provisioned key material, reporting whether a key was
	// present.
	DeleteKey(keyID string) bool
}

// generateAESKey returns a fresh cryptographically-random AES-256 key.
func generateAESKey() []byte {
	key := make([]byte, AES256KeyBytes)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		// crypto/rand failure is unrecoverable and must never yield a weak key.
		panic("crypto: unable to read random bytes for AES-256 key: " + err.Error())
	}
	return key
}

// InMemoryKeyStore is an in-memory KeyStore reference implementation. Keys are
// generated lazily per keyId and are returned as defensive copies so callers
// cannot mutate the stored material. Production deployments substitute a
// KMS/HSM-backed implementation of the same port.
type InMemoryKeyStore struct {
	keys map[string][]byte
}

// NewInMemoryKeyStore constructs an empty in-memory key store.
func NewInMemoryKeyStore() *InMemoryKeyStore {
	return &InMemoryKeyStore{keys: make(map[string][]byte)}
}

// GetKey implements KeyStore.
func (s *InMemoryKeyStore) GetKey(keyID string) ([]byte, bool) {
	key, ok := s.keys[keyID]
	if !ok {
		return nil, false
	}
	return append([]byte(nil), key...), true
}

// GetOrCreateKey implements KeyStore.
func (s *InMemoryKeyStore) GetOrCreateKey(keyID string) []byte {
	if key, ok := s.keys[keyID]; ok {
		return append([]byte(nil), key...)
	}
	key := generateAESKey()
	s.keys[keyID] = key
	return append([]byte(nil), key...)
}

// DeleteKey implements KeyStore.
func (s *InMemoryKeyStore) DeleteKey(keyID string) bool {
	if _, ok := s.keys[keyID]; !ok {
		return false
	}
	delete(s.keys, keyID)
	return true
}

// EncryptedRecord is the persisted, encrypted form of a health-data record —
// the "stored form" referenced by Property 53. It deliberately contains **no
// key material**, only a keyId reference into the separated KeyStore. Binary
// fields are base64-encoded so the record is safe to store as JSON/text.
type EncryptedRecord struct {
	// Algorithm is the encryption algorithm identifier.
	Algorithm string
	// KeyID references the per-user key in the separated key store (never the key).
	KeyID string
	// IV is the base64-encoded random initialization vector (unique per record).
	IV string
	// AuthTag is the base64-encoded GCM authentication tag (detects tampering).
	AuthTag string
	// Ciphertext is the base64-encoded ciphertext of the record bytes.
	Ciphertext string
}

// Encryptor encrypts/decrypts health-data records under a per-user key. Callers
// depend on this interface (not the concrete type) so the crypto backend can be
// swapped (in-memory, KMS, HSM) without changing them.
type Encryptor interface {
	Encrypt(keyID string, record []byte) Result[EncryptedRecord]
	Decrypt(encrypted EncryptedRecord) Result[[]byte]
}

// AesGcmEncryptor is an AES-256-GCM Encryptor backed by a separated KeyStore.
// The store is injected, keeping key material outside this object and outside
// every EncryptedRecord it produces (Req 25.1, Property 53).
type AesGcmEncryptor struct {
	keyStore KeyStore
}

// NewAesGcmEncryptor builds an Encryptor over the given separated key store.
func NewAesGcmEncryptor(keyStore KeyStore) *AesGcmEncryptor {
	return &AesGcmEncryptor{keyStore: keyStore}
}

// Encrypt encrypts record under the key for keyID (typically the user id),
// provisioning a key on first use, and returns the EncryptedRecord stored form.
func (e *AesGcmEncryptor) Encrypt(keyID string, record []byte) Result[EncryptedRecord] {
	if keyID == "" {
		return Fail[EncryptedRecord](ValidationRejection(
			CryptoErrMalformedRecord,
			"A non-empty keyId is required to encrypt a record.",
		))
	}

	key := e.keyStore.GetOrCreateKey(keyID)
	if len(key) != AES256KeyBytes {
		return Fail[EncryptedRecord](AtomicFailure(
			CryptoErrKeyUnavailable,
			"Key for the provided keyId is not a valid AES-256 key.",
			false,
		))
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return Fail[EncryptedRecord](AtomicFailure(
			CryptoErrKeyUnavailable, "Could not initialize AES cipher.", false,
		))
	}
	gcm, err := cipher.NewGCMWithTagSize(block, GCMAuthTagBytes)
	if err != nil {
		return Fail[EncryptedRecord](AtomicFailure(
			CryptoErrKeyUnavailable, "Could not initialize AES-GCM.", false,
		))
	}

	iv := make([]byte, GCMIVBytes)
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		return Fail[EncryptedRecord](AtomicFailure(
			CryptoErrKeyUnavailable, "Could not generate a random IV.", false,
		))
	}

	// Seal appends the auth tag to the ciphertext; split it back out so the
	// stored form keeps ciphertext and tag as distinct fields.
	sealed := gcm.Seal(nil, iv, record, nil)
	ciphertext := sealed[:len(sealed)-GCMAuthTagBytes]
	authTag := sealed[len(sealed)-GCMAuthTagBytes:]

	return Okay(EncryptedRecord{
		Algorithm:  EncryptionAlgorithm,
		KeyID:      keyID,
		IV:         base64.StdEncoding.EncodeToString(iv),
		AuthTag:    base64.StdEncoding.EncodeToString(authTag),
		Ciphertext: base64.StdEncoding.EncodeToString(ciphertext),
	})
}

// Decrypt decrypts a previously produced EncryptedRecord back into the original
// record bytes. It fails if the key is missing or the ciphertext/tag is invalid.
func (e *AesGcmEncryptor) Decrypt(encrypted EncryptedRecord) Result[[]byte] {
	if encrypted.Algorithm != EncryptionAlgorithm {
		return Fail[[]byte](ValidationRejection(
			CryptoErrUnsupportedAlgo,
			"Unsupported or missing encryption algorithm.",
		))
	}

	key, ok := e.keyStore.GetKey(encrypted.KeyID)
	if !ok || len(key) != AES256KeyBytes {
		// Without the separately-stored key, ciphertext cannot be read back.
		return Fail[[]byte](AtomicFailure(
			CryptoErrKeyUnavailable,
			"No key available for the referenced keyId.",
			false,
		))
	}

	iv, err := base64.StdEncoding.DecodeString(encrypted.IV)
	if err != nil {
		return Fail[[]byte](AtomicFailure(
			CryptoErrDecryptionFailed, "Malformed IV encoding.", false,
		))
	}
	authTag, err := base64.StdEncoding.DecodeString(encrypted.AuthTag)
	if err != nil {
		return Fail[[]byte](AtomicFailure(
			CryptoErrDecryptionFailed, "Malformed auth-tag encoding.", false,
		))
	}
	ciphertext, err := base64.StdEncoding.DecodeString(encrypted.Ciphertext)
	if err != nil {
		return Fail[[]byte](AtomicFailure(
			CryptoErrDecryptionFailed, "Malformed ciphertext encoding.", false,
		))
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return Fail[[]byte](AtomicFailure(
			CryptoErrKeyUnavailable, "Could not initialize AES cipher.", false,
		))
	}
	gcm, err := cipher.NewGCMWithTagSize(block, GCMAuthTagBytes)
	if err != nil {
		return Fail[[]byte](AtomicFailure(
			CryptoErrKeyUnavailable, "Could not initialize AES-GCM.", false,
		))
	}
	if len(iv) != gcm.NonceSize() {
		return Fail[[]byte](AtomicFailure(
			CryptoErrDecryptionFailed, "IV length does not match GCM nonce size.", false,
		))
	}

	// Re-join ciphertext||tag for Open (the inverse of the Seal split above).
	sealed := append(append([]byte(nil), ciphertext...), authTag...)
	plaintext, err := gcm.Open(nil, iv, sealed, nil)
	if err != nil {
		// Wrong key, tampered ciphertext, or corrupt tag all land here.
		return Fail[[]byte](AtomicFailure(
			CryptoErrDecryptionFailed,
			"Ciphertext could not be decrypted or failed authentication.",
			false,
		))
	}
	return Okay(plaintext)
}

// containsSubsequence reports whether needle occurs as a contiguous
// subsequence of haystack. Used by tests to assert that raw key material never
// leaks into the encrypted stored form. Comparison is constant-time per window
// to avoid data-dependent timing, though it is only used in tests.
func containsSubsequence(haystack, needle []byte) bool {
	if len(needle) == 0 {
		return true
	}
	if len(needle) > len(haystack) {
		return false
	}
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if subtle.ConstantTimeCompare(haystack[i:i+len(needle)], needle) == 1 {
			return true
		}
	}
	return false
}

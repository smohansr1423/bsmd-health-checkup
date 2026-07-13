// Property-based test for the AES-256 per-user encryption round-trip with a
// separated key store (Task 3.2).
//
// Feature: calorie-cortisol-tool, Property 53
//
// Property 53: Encryption round-trip with separated keys
//   *For any* health-data record, decrypting the AES-256-encrypted stored form
//   with the user's key yields the original record, and the key material is
//   stored separately from the ciphertext.
//
// Validates: Requirements 25.1
package main

import (
	"bytes"
	"encoding/base64"
	"testing"

	"github.com/leanovate/gopter"
	"github.com/leanovate/gopter/gen"
	"github.com/leanovate/gopter/prop"
)

// storedFormBytes flattens every byte the encrypted stored form actually
// carries (the base64-decoded IV, auth tag and ciphertext, plus the textual
// algorithm/keyId fields) so a test can assert no raw key material leaks into it.
func storedFormBytes(rec EncryptedRecord) []byte {
	iv, _ := base64.StdEncoding.DecodeString(rec.IV)
	tag, _ := base64.StdEncoding.DecodeString(rec.AuthTag)
	ct, _ := base64.StdEncoding.DecodeString(rec.Ciphertext)
	var buf bytes.Buffer
	buf.WriteString(rec.Algorithm)
	buf.WriteString(rec.KeyID)
	buf.Write(iv)
	buf.Write(tag)
	buf.Write(ct)
	return buf.Bytes()
}

// TestProperty53EncryptionRoundTripSeparatedKeys validates Property 53 across
// many randomly generated (keyId, record) pairs.
//
// Feature: calorie-cortisol-tool, Property 53
// Validates: Requirements 25.1
func TestProperty53EncryptionRoundTripSeparatedKeys(t *testing.T) {
	parameters := gopter.DefaultTestParameters()
	parameters.MinSuccessfulTests = 100 // >=100 generated iterations per task 3.2

	properties := gopter.NewProperties(parameters)

	nonEmptyKeyID := gen.AnyString().SuchThat(func(s string) bool {
		return len(s) > 0
	})
	recordBytes := gen.SliceOf(gen.UInt8())

	properties.Property(
		"decrypting the AES-256 stored form with the user's key yields the original record, and key material lives separately from the ciphertext",
		prop.ForAll(
			func(keyID string, record []byte) bool {
				store := NewInMemoryKeyStore()
				enc := NewAesGcmEncryptor(store)

				// Encrypt must succeed and yield an AES-256-GCM stored form that
				// references the keyId rather than embedding a key.
				encRes := enc.Encrypt(keyID, record)
				if !encRes.Ok {
					return false
				}
				stored := encRes.Value
				if stored.Algorithm != EncryptionAlgorithm || stored.KeyID != keyID {
					return false
				}

				// Key-separation invariant: the raw per-user key is held in the
				// separated store and must not appear anywhere in the stored form.
				key, ok := store.GetKey(keyID)
				if !ok || len(key) != AES256KeyBytes {
					return false
				}
				if containsSubsequence(storedFormBytes(stored), key) {
					return false
				}

				// Round-trip: decrypting with the separately-stored key returns
				// the exact original record.
				decRes := enc.Decrypt(stored)
				if !decRes.Ok {
					return false
				}
				if !bytes.Equal(decRes.Value, record) {
					return false
				}

				// Wrong-key isolation: decrypting the identical ciphertext under
				// a *different* per-user key must never recover the plaintext.
				// Provision a second key and point a copy of the stored form at
				// it; GCM authentication must reject the mismatched key.
				otherKeyID := keyID + "\x00other"
				store.GetOrCreateKey(otherKeyID)
				otherKey, _ := store.GetKey(otherKeyID)
				sameKey, _ := store.GetKey(keyID)
				if !bytes.Equal(otherKey, sameKey) { // guard against the astronomically unlikely key collision
					wrongKeyForm := stored
					wrongKeyForm.KeyID = otherKeyID
					if enc.Decrypt(wrongKeyForm).Ok {
						return false
					}
				}

				// The key genuinely lives only in the separated store: remove it
				// and the identical ciphertext can no longer be decrypted.
				store.DeleteKey(keyID)
				orphan := enc.Decrypt(stored)
				return !orphan.Ok

			},
			nonEmptyKeyID,
			recordBytes,
		),
	)

	properties.TestingRun(t)
}

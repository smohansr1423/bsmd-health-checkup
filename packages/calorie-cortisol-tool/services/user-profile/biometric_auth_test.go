// Focused unit tests for the biometric token exchange and fallback endpoint
// (Task 4.12). The client-side biometric gate/fallback behavior (design
// Property 45) is validated separately in tasks 14.19/14.20; these tests cover
// the server-side token-exchange/fallback issuance for Requirements 18.2,
// 18.4, and 18.5.
package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// --- test doubles ---------------------------------------------------------

type stubBiometric struct{ ok bool }

func (s stubBiometric) VerifyAssertion(_, _, _ string) bool { return s.ok }

type stubCredential struct{ ok bool }

func (s stubCredential) VerifyCredential(_, _, _ string) bool { return s.ok }

func authFixedClock(t time.Time) func() time.Time { return func() time.Time { return t } }

func newAuthTestService(bioOK, credOK bool, now time.Time) *BiometricAuthService {
	cfg, err := NewSigningConfig([]byte("test-signing-secret-not-hardcoded-in-src"), "user-profile-test")
	if err != nil {
		panic(err)
	}
	cfg.Now = authFixedClock(now)
	return &BiometricAuthService{
		Signing:         cfg,
		Biometric:       stubBiometric{ok: bioOK},
		Credential:      stubCredential{ok: credOK},
		NewRefreshToken: func() (string, error) { return "refresh-token-fixed", nil },
	}
}

func authBoolPtr(b bool) *bool { return &b }

// --- signing config -------------------------------------------------------

func TestNewSigningConfigRejectsEmptySecret(t *testing.T) {
	if _, err := NewSigningConfig(nil, "iss"); err == nil {
		t.Fatal("expected error for empty signing secret, got nil")
	}
	cfg, err := NewSigningConfig([]byte("k"), "iss")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.AccessTTL != AccessTokenTTL {
		t.Fatalf("expected default TTL %v, got %v", AccessTokenTTL, cfg.AccessTTL)
	}
}

// --- Req 18.2: successful biometric exchange ------------------------------

func TestBiometricSuccessIssuesGatedFifteenMinuteToken(t *testing.T) {
	now := time.Date(2024, 1, 2, 8, 0, 0, 0, time.UTC)
	svc := newAuthTestService(true, false, now)

	out := svc.Authenticate(BiometricAuthRequest{
		UserID:             "user-1",
		Method:             "biometric",
		DeviceID:           "device-1",
		BiometricAssertion: "valid-assertion",
		BiometricAvailable: authBoolPtr(true),
	})

	if out.Error != nil {
		t.Fatalf("expected success, got error %+v", out.Error)
	}
	if out.FallbackRequired {
		t.Fatal("did not expect fallback for a successful biometric match")
	}
	if out.Tokens == nil {
		t.Fatal("expected tokens on success")
	}
	if !out.Tokens.BiometricGated {
		t.Error("expected biometric-gated token")
	}
	if out.Tokens.AuthMethod != AuthMethodBiometric {
		t.Errorf("expected amr=biometric, got %q", out.Tokens.AuthMethod)
	}
	if out.Tokens.ExpiresInSeconds != 900 {
		t.Errorf("expected 900s (15 min) TTL, got %d", out.Tokens.ExpiresInSeconds)
	}
	claims, err := VerifyAccessToken(svc.Signing, out.Tokens.AccessToken)
	if err != nil {
		t.Fatalf("issued token failed verification: %v", err)
	}
	if claims.Subject != "user-1" {
		t.Errorf("expected sub=user-1, got %q", claims.Subject)
	}
	if claims.ExpiresAt-claims.IssuedAt != int64(AccessTokenTTL.Seconds()) {
		t.Errorf("expected exp-iat=%d, got %d", int64(AccessTokenTTL.Seconds()), claims.ExpiresAt-claims.IssuedAt)
	}
}

func TestBiometricMismatchWithholdsTokenAndAllowsRetry(t *testing.T) {
	now := time.Now()
	svc := newAuthTestService(false, false, now)

	out := svc.Authenticate(BiometricAuthRequest{
		UserID:             "user-1",
		Method:             "biometric",
		DeviceID:           "device-1",
		BiometricAssertion: "bad-assertion",
		BiometricAvailable: authBoolPtr(true),
	})

	if out.Tokens != nil {
		t.Fatal("expected no tokens on biometric mismatch")
	}
	if out.Error == nil || out.Error.Code != "auth/biometric-mismatch" {
		t.Fatalf("expected biometric-mismatch error, got %+v", out.Error)
	}
	if !out.Error.Retryable {
		t.Error("mismatch should be retryable (allow retry)")
	}
	if !out.Error.RetainedState {
		t.Error("prior state should be retained on mismatch")
	}
}

// --- Req 18.4: lockout after 3 consecutive failures -----------------------

func TestThreeConsecutiveFailuresPresentFallback(t *testing.T) {
	svc := newAuthTestService(true, false, time.Now())

	out := svc.Authenticate(BiometricAuthRequest{
		UserID:              "user-1",
		Method:              "biometric",
		DeviceID:            "device-1",
		BiometricAssertion:  "valid-assertion",
		BiometricAvailable:  authBoolPtr(true),
		ConsecutiveFailures: 3,
	})

	if !out.FallbackRequired {
		t.Fatal("expected fallback required after 3 consecutive failures")
	}
	if out.FallbackReason != FallbackReasonLockedOut {
		t.Errorf("expected reason %q, got %q", FallbackReasonLockedOut, out.FallbackReason)
	}
	if out.Tokens != nil {
		t.Error("no tokens should be issued when biometrics are locked out")
	}
}

// --- Req 18.5: biometrics unavailable -------------------------------------

func TestBiometricsUnavailablePresentsFallback(t *testing.T) {
	svc := newAuthTestService(true, false, time.Now())

	out := svc.Authenticate(BiometricAuthRequest{
		UserID:             "user-1",
		Method:             "biometric",
		BiometricAvailable: authBoolPtr(false),
	})

	if !out.FallbackRequired {
		t.Fatal("expected fallback required when biometrics unavailable")
	}
	if out.FallbackReason != FallbackReasonUnavailable {
		t.Errorf("expected reason %q, got %q", FallbackReasonUnavailable, out.FallbackReason)
	}
}

// --- fallback issuance (passcode/password) --------------------------------

func TestFallbackPasscodeSuccessIssuesNonGatedToken(t *testing.T) {
	svc := newAuthTestService(false, true, time.Now())

	out := svc.Authenticate(BiometricAuthRequest{
		UserID:       "user-1",
		Method:       "fallback",
		FallbackType: "passcode",
		Credential:   "123456",
	})

	if out.Error != nil {
		t.Fatalf("expected success, got %+v", out.Error)
	}
	if out.Tokens == nil {
		t.Fatal("expected tokens on fallback success")
	}
	if out.Tokens.BiometricGated {
		t.Error("fallback token should not be biometric-gated")
	}
	if out.Tokens.AuthMethod != AuthMethodPasscode {
		t.Errorf("expected amr=passcode, got %q", out.Tokens.AuthMethod)
	}
}

func TestFallbackWrongCredentialRejected(t *testing.T) {
	svc := newAuthTestService(false, false, time.Now())

	out := svc.Authenticate(BiometricAuthRequest{
		UserID:       "user-1",
		Method:       "fallback",
		FallbackType: "password",
		Credential:   "wrong",
	})

	if out.Tokens != nil {
		t.Fatal("expected no tokens for wrong credential")
	}
	if out.Error == nil || out.Error.Code != "auth/fallback-rejected" {
		t.Fatalf("expected fallback-rejected, got %+v", out.Error)
	}
	if !out.Error.RetainedState {
		t.Error("prior state should be retained on rejected credential")
	}
}

func TestFallbackInvalidTypeRejected(t *testing.T) {
	svc := newAuthTestService(false, true, time.Now())
	out := svc.Authenticate(BiometricAuthRequest{
		UserID:       "user-1",
		Method:       "fallback",
		FallbackType: "pin",
		Credential:   "123456",
	})
	if out.Error == nil || out.Error.Code != "auth/invalid-fallback-type" {
		t.Fatalf("expected invalid-fallback-type, got %+v", out.Error)
	}
}

// --- request validation ---------------------------------------------------

func TestMissingUserIDRejected(t *testing.T) {
	svc := newAuthTestService(true, true, time.Now())
	out := svc.Authenticate(BiometricAuthRequest{Method: "biometric"})
	if out.Error == nil || out.Error.Code != "auth/missing-user" {
		t.Fatalf("expected missing-user rejection, got %+v", out.Error)
	}
}

func TestInvalidMethodRejected(t *testing.T) {
	svc := newAuthTestService(true, true, time.Now())
	out := svc.Authenticate(BiometricAuthRequest{UserID: "u", Method: "magic"})
	if out.Error == nil || out.Error.Code != "auth/invalid-method" {
		t.Fatalf("expected invalid-method rejection, got %+v", out.Error)
	}
}

func TestBiometricMissingAssertionRejected(t *testing.T) {
	svc := newAuthTestService(true, true, time.Now())
	out := svc.Authenticate(BiometricAuthRequest{
		UserID:             "u",
		Method:             "biometric",
		BiometricAvailable: authBoolPtr(true),
	})
	if out.Error == nil || out.Error.Code != "auth/missing-assertion" {
		t.Fatalf("expected missing-assertion rejection, got %+v", out.Error)
	}
}

// --- token verification edge cases ----------------------------------------

func TestVerifyRejectsTamperedToken(t *testing.T) {
	svc := newAuthTestService(true, false, time.Now())
	out := svc.issue("user-1", AuthMethodBiometric, true)
	tampered := out.Tokens.AccessToken + "x"
	if _, err := VerifyAccessToken(svc.Signing, tampered); err == nil {
		t.Fatal("expected verification failure for tampered token")
	}
}

func TestVerifyRejectsExpiredToken(t *testing.T) {
	issueTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	svc := newAuthTestService(true, false, issueTime)
	out := svc.issue("user-1", AuthMethodBiometric, true)

	// Verify with a clock past expiry.
	future := svc.Signing
	future.Now = authFixedClock(issueTime.Add(AccessTokenTTL + time.Second))
	if _, err := VerifyAccessToken(future, out.Tokens.AccessToken); err == nil {
		t.Fatal("expected expired-token verification failure")
	}
}

// --- HTTP handler ---------------------------------------------------------

func TestHandlerPostSuccess(t *testing.T) {
	svc := newAuthTestService(true, false, time.Now())
	body, _ := json.Marshal(BiometricAuthRequest{
		UserID:             "user-1",
		Method:             "biometric",
		DeviceID:           "device-1",
		BiometricAssertion: "valid",
		BiometricAvailable: authBoolPtr(true),
	})
	req := httptest.NewRequest(http.MethodPost, "/auth/biometric", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	svc.HandleBiometricAuth(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var resp TokenResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad response json: %v", err)
	}
	if resp.AccessToken == "" || !resp.BiometricGated {
		t.Errorf("expected gated token in response, got %+v", resp)
	}
}

func TestHandlerFallbackRequiredReturns401(t *testing.T) {
	svc := newAuthTestService(true, false, time.Now())
	body, _ := json.Marshal(BiometricAuthRequest{
		UserID:             "user-1",
		Method:             "biometric",
		BiometricAvailable: authBoolPtr(false),
	})
	req := httptest.NewRequest(http.MethodPost, "/auth/biometric", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	svc.HandleBiometricAuth(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
	var fb fallbackBody
	if err := json.Unmarshal(rec.Body.Bytes(), &fb); err != nil {
		t.Fatalf("bad response json: %v", err)
	}
	if !fb.FallbackRequired || !fb.BiometricsUnavailable {
		t.Errorf("expected fallback+unavailable, got %+v", fb)
	}
	if strings.Join(fb.FallbackMethods, ",") != "passcode,password" {
		t.Errorf("expected passcode,password methods, got %v", fb.FallbackMethods)
	}
}

func TestHandlerRejectsNonPost(t *testing.T) {
	svc := newAuthTestService(true, false, time.Now())
	req := httptest.NewRequest(http.MethodGet, "/auth/biometric", nil)
	rec := httptest.NewRecorder()
	svc.HandleBiometricAuth(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", rec.Code)
	}
}

func TestRegisterBiometricAuthRoutes(t *testing.T) {
	svc := newAuthTestService(true, false, time.Now())
	mux := http.NewServeMux()
	RegisterBiometricAuthRoutes(mux, svc)

	body, _ := json.Marshal(BiometricAuthRequest{
		UserID: "u", Method: "fallback", FallbackType: "pin", Credential: "x",
	})
	req := httptest.NewRequest(http.MethodPost, "/auth/biometric", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid fallback type via mux, got %d", rec.Code)
	}
}

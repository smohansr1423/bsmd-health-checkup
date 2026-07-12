// Biometric token exchange and fallback authentication (Task 4.12).
//
// Implements the server side of `POST /auth/biometric` that backs the client
// biometric gate (Requirement 18). The biometric match itself happens on the
// device (Face ID / Touch ID / Android Biometric); this endpoint exchanges a
// device-verified biometric assertion — or a fallback passcode/password
// credential — for a short-lived JWT access token (15 minutes, "biometric-
// gated") plus an opaque refresh token, following the design's AuthN posture:
// OAuth 2.0 + PKCE, biometric-gated tokens, JWT 15-min + refresh.
//
// Responsibilities covered here:
//   - Successful biometric token exchange → grant access via issued tokens
//     (Req 18.2).
//   - Deny biometrics after 3 consecutive failed attempts and surface the
//     fallback (passcode/password) path (Req 18.4).
//   - When biometrics are unavailable / not enrolled, surface the fallback
//     path with an "unavailable" indication (Req 18.5).
//
// The client tracks the per-session consecutive-failure count and the
// gate/retry UX (design Property 45, tasks 14.19/14.20); this service accepts
// that context and issues/withholds tokens accordingly. Degraded outcomes use
// the shared Go error/result contract (result.go). Signing material is
// injected (never hardcoded).
//
// Requirements: 18.2, 18.4, 18.5
package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"time"
)

// AccessTokenTTL is the lifetime of an issued JWT access token (design: JWT
// 15-min + refresh).
const AccessTokenTTL = 15 * time.Minute

// MaxBiometricAttempts is the number of consecutive biometric failures after
// which biometric access is denied and the fallback method is presented
// (Req 18.4).
const MaxBiometricAttempts = 3

// AuthMethod values recorded in the issued token's `amr` claim.
const (
	AuthMethodBiometric = "biometric"
	AuthMethodPasscode  = "passcode"
	AuthMethodPassword  = "password"
)

// FallbackReason explains why the fallback authentication method is being
// presented instead of a biometric exchange.
const (
	// FallbackReasonUnavailable — no biometric hardware enrolled or biometrics
	// unavailable at the OS level (Req 18.5).
	FallbackReasonUnavailable = "biometric_unavailable"
	// FallbackReasonLockedOut — 3 consecutive biometric failures (Req 18.4).
	FallbackReasonLockedOut = "biometric_locked_out"
)

// ---------------------------------------------------------------------------
// Signing configuration (injectable — no hardcoded secrets)
// ---------------------------------------------------------------------------

// SigningConfig holds the injectable JWT signing material and issuance policy.
// Secret is provided by the caller (e.g. from a secrets manager / env) and is
// never hardcoded in this package.
type SigningConfig struct {
	// Secret is the HMAC signing key. Must be non-empty.
	Secret []byte
	// Issuer is the `iss` claim placed on issued tokens.
	Issuer string
	// AccessTTL is the access-token lifetime. Defaults to AccessTokenTTL.
	AccessTTL time.Duration
	// Now is an injectable clock (for deterministic tests). Defaults to
	// time.Now.
	Now func() time.Time
}

// NewSigningConfig builds a SigningConfig from injected material, defaulting
// the access-token TTL to 15 minutes. It rejects an empty secret so a service
// can never boot with a hardcoded / missing signing key.
func NewSigningConfig(secret []byte, issuer string) (SigningConfig, error) {
	if len(secret) == 0 {
		return SigningConfig{}, errors.New("signing secret must not be empty")
	}
	return SigningConfig{
		Secret:    secret,
		Issuer:    issuer,
		AccessTTL: AccessTokenTTL,
	}, nil
}

func (c SigningConfig) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

func (c SigningConfig) ttl() time.Duration {
	if c.AccessTTL <= 0 {
		return AccessTokenTTL
	}
	return c.AccessTTL
}

// ---------------------------------------------------------------------------
// JWT (compact HS256) — minimal, dependency-free
// ---------------------------------------------------------------------------

// TokenClaims is the JWT payload issued on a successful exchange.
type TokenClaims struct {
	Subject        string `json:"sub"`
	Issuer         string `json:"iss"`
	IssuedAt       int64  `json:"iat"`
	ExpiresAt      int64  `json:"exp"`
	AuthMethod     string `json:"amr"`             // biometric | passcode | password
	BiometricGated bool   `json:"biometric_gated"` // true when unlocked via biometrics
}

type jwtHeader struct {
	Alg string `json:"alg"`
	Typ string `json:"typ"`
}

func b64url(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func signSegment(secret []byte, signingInput string) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(signingInput))
	return b64url(mac.Sum(nil))
}

// MintAccessToken builds a compact HS256 JWT for the given claims.
func MintAccessToken(cfg SigningConfig, claims TokenClaims) (string, error) {
	if len(cfg.Secret) == 0 {
		return "", errors.New("signing secret not configured")
	}
	headerBytes, err := json.Marshal(jwtHeader{Alg: "HS256", Typ: "JWT"})
	if err != nil {
		return "", err
	}
	claimsBytes, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	signingInput := b64url(headerBytes) + "." + b64url(claimsBytes)
	return signingInput + "." + signSegment(cfg.Secret, signingInput), nil
}

// VerifyAccessToken parses and verifies a compact HS256 JWT: it checks the
// signature (constant-time) and that the token has not expired relative to the
// config's clock. It is used by tests and any downstream verifier.
func VerifyAccessToken(cfg SigningConfig, token string) (TokenClaims, error) {
	var claims TokenClaims
	if len(cfg.Secret) == 0 {
		return claims, errors.New("signing secret not configured")
	}
	// Split into exactly three segments without importing strings.Split-heavy
	// logic: header.payload.signature.
	firstDot := authIndexByte(token, '.')
	if firstDot < 0 {
		return claims, errors.New("malformed token")
	}
	secondDot := authIndexByte(token[firstDot+1:], '.')
	if secondDot < 0 {
		return claims, errors.New("malformed token")
	}
	secondDot += firstDot + 1
	signingInput := token[:secondDot]
	sig := token[secondDot+1:]
	if !hmac.Equal([]byte(sig), []byte(signSegment(cfg.Secret, signingInput))) {
		return claims, errors.New("invalid signature")
	}
	payloadB64 := token[firstDot+1 : secondDot]
	payload, err := base64.RawURLEncoding.DecodeString(payloadB64)
	if err != nil {
		return claims, errors.New("malformed payload")
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return claims, errors.New("malformed claims")
	}
	if claims.ExpiresAt > 0 && cfg.now().Unix() >= claims.ExpiresAt {
		return claims, errors.New("token expired")
	}
	return claims, nil
}

func authIndexByte(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}

// ---------------------------------------------------------------------------
// Verifiers (injectable) — decouple crypto/credential specifics from the flow
// ---------------------------------------------------------------------------

// BiometricVerifier verifies a device-produced biometric assertion. The
// concrete implementation validates the secure-enclave / Android Keystore
// signature bound to the enrolled biometric; here it is an injected dependency
// so this package stays free of platform crypto.
type BiometricVerifier interface {
	VerifyAssertion(userID, deviceID, assertion string) bool
}

// CredentialVerifier verifies a fallback passcode/password credential.
type CredentialVerifier interface {
	VerifyCredential(userID, fallbackType, credential string) bool
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

// BiometricAuthService performs biometric token exchange and fallback
// authentication issuance.
type BiometricAuthService struct {
	Signing    SigningConfig
	Biometric  BiometricVerifier
	Credential CredentialVerifier
	// NewRefreshToken lets tests inject a deterministic refresh token; defaults
	// to a 256-bit cryptographically-random value.
	NewRefreshToken func() (string, error)
}

func (s *BiometricAuthService) newRefreshToken() (string, error) {
	if s.NewRefreshToken != nil {
		return s.NewRefreshToken()
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// BiometricAuthRequest is the `POST /auth/biometric` request body.
type BiometricAuthRequest struct {
	UserID string `json:"userId"`
	// Method selects the exchange: "biometric" or "fallback".
	Method string `json:"method"`

	// Biometric-exchange fields.
	DeviceID           string `json:"deviceId,omitempty"`
	BiometricAssertion string `json:"biometricAssertion,omitempty"`
	// BiometricAvailable reports whether biometrics are enrolled/available at
	// the OS level. A false value drives the Req 18.5 fallback. Pointer so an
	// omitted value is treated as "available/unknown" rather than false.
	BiometricAvailable *bool `json:"biometricAvailable,omitempty"`
	// ConsecutiveFailures is the client-tracked count of consecutive failed
	// biometric attempts in the current session (Req 18.4).
	ConsecutiveFailures int `json:"consecutiveFailures,omitempty"`

	// Fallback-exchange fields.
	FallbackType string `json:"fallbackType,omitempty"` // "passcode" | "password"
	Credential   string `json:"credential,omitempty"`
}

// TokenResponse is returned on a successful exchange.
type TokenResponse struct {
	AccessToken      string `json:"accessToken"`
	RefreshToken     string `json:"refreshToken"`
	TokenType        string `json:"tokenType"`
	ExpiresInSeconds int    `json:"expiresInSeconds"`
	AuthMethod       string `json:"authMethod"`
	BiometricGated   bool   `json:"biometricGated"`
}

// AuthOutcome is the result of an authentication attempt. Exactly one of
// Tokens, FallbackRequired, or Error is meaningful:
//   - Tokens set          → success (Req 18.2).
//   - FallbackRequired     → present the passcode/password method
//     (Req 18.4 lockout / Req 18.5 unavailable).
//   - Error set            → validation rejection or a rejected/failed attempt
//     (health data stays hidden; caller may retry).
type AuthOutcome struct {
	Tokens           *TokenResponse
	FallbackRequired bool
	FallbackReason   string
	Error            *ErrorContract
}

// Authenticate performs a biometric or fallback exchange.
func (s *BiometricAuthService) Authenticate(req BiometricAuthRequest) AuthOutcome {
	if req.UserID == "" {
		e := ValidationRejection("auth/missing-user", "userId is required")
		return AuthOutcome{Error: &e}
	}
	switch req.Method {
	case "biometric":
		return s.authenticateBiometric(req)
	case "fallback":
		return s.authenticateFallback(req)
	default:
		e := ValidationRejection("auth/invalid-method", "method must be 'biometric' or 'fallback'")
		return AuthOutcome{Error: &e}
	}
}

func (s *BiometricAuthService) authenticateBiometric(req BiometricAuthRequest) AuthOutcome {
	// Req 18.5: biometrics unavailable / not enrolled → present fallback with
	// an "unavailable" indication (no token issued, prior state retained).
	if req.BiometricAvailable != nil && !*req.BiometricAvailable {
		return AuthOutcome{FallbackRequired: true, FallbackReason: FallbackReasonUnavailable}
	}
	// Req 18.4: 3 consecutive failures → deny biometrics, present fallback.
	if req.ConsecutiveFailures >= MaxBiometricAttempts {
		return AuthOutcome{FallbackRequired: true, FallbackReason: FallbackReasonLockedOut}
	}
	if req.DeviceID == "" || req.BiometricAssertion == "" {
		e := ValidationRejection("auth/missing-assertion", "deviceId and biometricAssertion are required for biometric exchange")
		return AuthOutcome{Error: &e}
	}
	if s.Biometric == nil || !s.Biometric.VerifyAssertion(req.UserID, req.DeviceID, req.BiometricAssertion) {
		// Single failed attempt: keep health data hidden, allow retry (Req 18.3
		// support). Prior state is preserved.
		e := ErrorContract{
			Code:          "auth/biometric-mismatch",
			Message:       "biometric match was not recognized",
			Retryable:     true,
			RetainedState: true,
		}
		return AuthOutcome{Error: &e}
	}
	// Req 18.2: successful biometric match → grant access via biometric-gated
	// tokens.
	return s.issue(req.UserID, AuthMethodBiometric, true)
}

func (s *BiometricAuthService) authenticateFallback(req BiometricAuthRequest) AuthOutcome {
	if req.FallbackType != AuthMethodPasscode && req.FallbackType != AuthMethodPassword {
		e := ValidationRejection("auth/invalid-fallback-type", "fallbackType must be 'passcode' or 'password'")
		return AuthOutcome{Error: &e}
	}
	if req.Credential == "" {
		e := ValidationRejection("auth/missing-credential", "credential is required for fallback exchange")
		return AuthOutcome{Error: &e}
	}
	if s.Credential == nil || !s.Credential.VerifyCredential(req.UserID, req.FallbackType, req.Credential) {
		e := ErrorContract{
			Code:          "auth/fallback-rejected",
			Message:       "credential was not recognized",
			Retryable:     true,
			RetainedState: true,
		}
		return AuthOutcome{Error: &e}
	}
	// Fallback path issues a non-biometric-gated token (Req 18.4/18.5 unlock).
	return s.issue(req.UserID, req.FallbackType, false)
}

func (s *BiometricAuthService) issue(userID, method string, gated bool) AuthOutcome {
	now := s.Signing.now()
	ttl := s.Signing.ttl()
	claims := TokenClaims{
		Subject:        userID,
		Issuer:         s.Signing.Issuer,
		IssuedAt:       now.Unix(),
		ExpiresAt:      now.Add(ttl).Unix(),
		AuthMethod:     method,
		BiometricGated: gated,
	}
	access, err := MintAccessToken(s.Signing, claims)
	if err != nil {
		e := AtomicFailure("auth/token-mint-failed", err.Error(), true)
		return AuthOutcome{Error: &e}
	}
	refresh, err := s.newRefreshToken()
	if err != nil {
		e := AtomicFailure("auth/refresh-mint-failed", err.Error(), true)
		return AuthOutcome{Error: &e}
	}
	return AuthOutcome{Tokens: &TokenResponse{
		AccessToken:      access,
		RefreshToken:     refresh,
		TokenType:        "Bearer",
		ExpiresInSeconds: int(ttl.Seconds()),
		AuthMethod:       method,
		BiometricGated:   gated,
	}}
}

// ---------------------------------------------------------------------------
// HTTP handler + additive router wiring
// ---------------------------------------------------------------------------

// fallbackBody is the JSON body returned when the fallback method must be
// presented (Req 18.4 / 18.5).
type fallbackBody struct {
	FallbackRequired      bool     `json:"fallbackRequired"`
	FallbackReason        string   `json:"fallbackReason"`
	FallbackMethods       []string `json:"fallbackMethods"`
	BiometricsUnavailable bool     `json:"biometricsUnavailable"`
	Message               string   `json:"message"`
}

// HandleBiometricAuth serves `POST /auth/biometric`.
func (s *BiometricAuthService) HandleBiometricAuth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeAuthJSON(w, http.StatusMethodNotAllowed, ValidationRejection("auth/method-not-allowed", "only POST is supported"))
		return
	}
	var req BiometricAuthRequest
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(&req); err != nil {
		writeAuthJSON(w, http.StatusBadRequest, ValidationRejection("auth/invalid-body", "request body is not valid JSON"))
		return
	}
	outcome := s.Authenticate(req)
	switch {
	case outcome.Error != nil:
		writeAuthJSON(w, authStatusForError(*outcome.Error), *outcome.Error)
	case outcome.FallbackRequired:
		writeAuthJSON(w, http.StatusUnauthorized, fallbackBody{
			FallbackRequired:      true,
			FallbackReason:        outcome.FallbackReason,
			FallbackMethods:       []string{AuthMethodPasscode, AuthMethodPassword},
			BiometricsUnavailable: outcome.FallbackReason == FallbackReasonUnavailable,
			Message:               "biometric access denied; use passcode or password to unlock",
		})
	default:
		writeAuthJSON(w, http.StatusOK, outcome.Tokens)
	}
}

// authStatusForError maps an error contract to an HTTP status code.
func authStatusForError(e ErrorContract) int {
	switch e.Code {
	case "auth/token-mint-failed", "auth/refresh-mint-failed":
		return http.StatusInternalServerError
	case "auth/biometric-mismatch", "auth/fallback-rejected":
		return http.StatusUnauthorized
	default:
		// Validation rejections and unknown codes reject at the boundary.
		return http.StatusBadRequest
	}
}

func writeAuthJSON(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// RegisterBiometricAuthRoutes additively wires the biometric-auth endpoint onto
// a shared mux. Bootstrap code (added in a later wiring task) calls this; it
// does not own or replace the service's main entrypoint.
func RegisterBiometricAuthRoutes(mux *http.ServeMux, svc *BiometricAuthService) {
	mux.HandleFunc("/auth/biometric", svc.HandleBiometricAuth)
}

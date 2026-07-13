// Local "dev mode" HTTP bootstrap for the User & Profile Service.
//
// This file is ADDITIVE dev wiring only: it does not change any existing domain
// logic or handlers. It starts a net/http server on PORT (default 8081) and
// mounts the service's existing HTTP handlers backed entirely by the in-memory
// stores the package already ships (NewInMemory* / NewFamilyService), so no
// PostgreSQL or other external infrastructure is required.
//
// Endpoints mounted (all pre-existing handlers):
//   - POST /onboarding/step, GET /onboarding/resume  (OnboardingHandler)
//   - POST /export, POST /account/delete             (AccountDataService)
//   - PUT  /consent                                   (RegisterConsentRoutes)
//   - POST /family/members                            (RegisterFamilyService)
//   - POST /auth/biometric                            (BiometricAuthService)
//   - GET  /health                                    (dev health probe)
//
// Run:  PORT=8081 go run .
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"
)

// devServiceName is reported by the health endpoint.
const devServiceName = "user-profile"

// ---------------------------------------------------------------------------
// In-memory adapters for local dev (no external persistence)
// ---------------------------------------------------------------------------

// devAccountDataStore is an in-memory AccountDataStore for local dev. It seeds a
// small amount of personal data so /export returns a non-empty artifact, and
// treats persist/commit as successful no-ops.
type devAccountDataStore struct{}

func (devAccountDataStore) LoadPersonalData(userID string) (PersonalData, error) {
	return PersonalData{
		UserID: userID,
		Records: map[PersonalDataCategory][]Record{
			CategoryProfile: {{"userId": userID, "displayName": "Dev User"}},
			CategoryConsent: {{"userId": userID, "healthDataConsent": true}},
		},
	}, nil
}

func (devAccountDataStore) PersistExport(ExportArtifact) error { return nil }
func (devAccountDataStore) CommitDeletion(DeletionPlan) error  { return nil }

// devBiometricVerifier accepts any non-empty assertion (dev only).
type devBiometricVerifier struct{}

func (devBiometricVerifier) VerifyAssertion(_userID, _deviceID, assertion string) bool {
	return assertion != ""
}

// devCredentialVerifier accepts any non-empty credential (dev only).
type devCredentialVerifier struct{}

func (devCredentialVerifier) VerifyCredential(_userID, _fallbackType, credential string) bool {
	return credential != ""
}

// ---------------------------------------------------------------------------
// CORS + health
// ---------------------------------------------------------------------------

// devCORS wraps a handler with permissive CORS for local development.
func devCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization,X-User-Id")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func devHealthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"status":  "ok",
		"service": devServiceName,
	})
}

// devPort resolves the listen port from PORT with a sensible default.
func devPort() string {
	if p := os.Getenv("PORT"); p != "" {
		return p
	}
	return "8081"
}

// RunDevServer builds the mux from the existing handlers/in-memory stores and
// serves it. Exposed as a function so it stays testable and does not collide
// with the placeholder main().
func RunDevServer() error {
	mux := http.NewServeMux()

	// Onboarding (in-memory store + profile creator by default).
	onboarding := NewOnboardingHandler(nil, nil)
	onboarding.RegisterRoutes(mux)

	// Account data export / deletion (in-memory store).
	accountSvc := NewAccountDataService(devAccountDataStore{})
	RegisterAccountDataRoutes(mux, accountSvc)

	// Consent (in-memory store).
	RegisterConsentRoutes(mux, NewInMemoryConsentStore())

	// Family accounts (in-memory service).
	RegisterFamilyRoutes(mux, NewFamilyService())

	// Biometric auth token exchange (dev signing secret + accept-all verifiers).
	signingSecret := os.Getenv("BIOMETRIC_SIGNING_SECRET")
	if signingSecret == "" {
		signingSecret = "dev-only-signing-secret-not-for-production"
	}
	if cfg, err := NewSigningConfig([]byte(signingSecret), "user-profile-dev"); err == nil {
		bioSvc := &BiometricAuthService{
			Signing:    cfg,
			Biometric:  devBiometricVerifier{},
			Credential: devCredentialVerifier{},
		}
		RegisterBiometricAuthRoutes(mux, bioSvc)
	}

	// Health probe.
	mux.HandleFunc("/health", devHealthHandler)

	addr := ":" + devPort()
	srv := &http.Server{
		Addr:              addr,
		Handler:           devCORS(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("[user-profile] listening on %s (in-memory dev mode)", addr)
	return srv.ListenAndServe()
}

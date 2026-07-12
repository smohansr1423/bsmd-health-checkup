// Focused unit tests for per-category consent state and the master consent gate
// (Task 4.4). Property 44 (gopter) is a separate optional task (4.5).
//
// Requirements: 17.1, 17.2, 17.3, 17.4, 17.6, 30.4, 30.5
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

const testUser = "user-123"

func mustApply(t *testing.T, store ConsentStore, req ConsentUpdateRequest) ConsentState {
	t.Helper()
	res := ApplyConsentUpdate(store, req, time.Now())
	if !res.Ok {
		t.Fatalf("expected successful consent update, got error %+v", res.Error)
	}
	return res.Value
}

func boolPtr(b bool) *bool { return &b }

// Req 17.1 / 17.6: with no recorded opt-in, egress for any category is blocked
// with a consent-required indication and the local copy is retained.
func TestEgressBlockedWithoutOptIn(t *testing.T) {
	state := newConsentState(testUser)

	res := CheckCategoryEgress(state, "cortisol")
	if res.Ok {
		t.Fatalf("expected egress to be blocked without opt-in, got allowed")
	}
	if res.Error.Code != ConsentRequiredCode {
		t.Fatalf("expected %s, got %s", ConsentRequiredCode, res.Error.Code)
	}
	if !res.Error.RetainedState {
		t.Fatalf("blocked egress must retain the local copy (RetainedState=true)")
	}
	if res.Error.Retryable {
		t.Fatalf("consent-required is a validation rejection and must not be retryable")
	}
}

// Req 17.1 / 17.2 / 17.3: recording an enabled opt-in permits egress for that
// category and applies to egress checks initiated after the save.
func TestEgressAllowedAfterOptIn(t *testing.T) {
	store := NewInMemoryConsentStore()
	state := mustApply(t, store, ConsentUpdateRequest{
		UserID:     testUser,
		Categories: map[string]bool{"cortisol": true},
	})

	res := CheckCategoryEgress(state, "cortisol")
	if !res.Ok {
		t.Fatalf("expected egress allowed after opt-in, got error %+v", res.Error)
	}
	if !res.Value.Allowed || res.Value.Category != "cortisol" {
		t.Fatalf("unexpected egress decision: %+v", res.Value)
	}

	// Non-enabled categories remain blocked (Req 17.2 — only enabled categories sync).
	if CheckCategoryEgress(state, "meals").Ok {
		t.Fatalf("non-enabled category must remain blocked")
	}
}

// Req 17.4: disabling a previously enabled opt-in stops further egress while the
// stored (local) copy is retained.
func TestDisableStopsEgressAndRetainsLocalCopy(t *testing.T) {
	store := NewInMemoryConsentStore()
	mustApply(t, store, ConsentUpdateRequest{
		UserID:     testUser,
		Categories: map[string]bool{"cortisol": true},
	})

	// Disable the category.
	disabled := mustApply(t, store, ConsentUpdateRequest{
		UserID:     testUser,
		Categories: map[string]bool{"cortisol": false},
	})

	res := CheckCategoryEgress(disabled, "cortisol")
	if res.Ok {
		t.Fatalf("expected egress blocked after disable")
	}
	if res.Error.Code != ConsentRequiredCode || !res.Error.RetainedState {
		t.Fatalf("disable must block with consent-required and retain local copy, got %+v", res.Error)
	}

	// The stored state still carries the (now false) category — the local copy
	// is retained, not deleted.
	stored, ok := store.Get(testUser)
	if !ok {
		t.Fatalf("consent state should still exist after disable")
	}
	if enabled := stored.Categories["cortisol"]; enabled {
		t.Fatalf("category should be recorded as disabled, got enabled")
	}
}

// Req 30.4 / 30.5: the first health-data submission requires affirmative master
// consent; without it the submission is rejected with a consent-required
// indication and nothing is retained server-side.
func TestHealthDataSubmissionGate(t *testing.T) {
	state := newConsentState(testUser)

	blocked := CheckHealthDataSubmission(state)
	if blocked.Ok {
		t.Fatalf("expected first submission blocked without health-data consent")
	}
	if blocked.Error.Code != ConsentRequiredCode {
		t.Fatalf("expected %s, got %s", ConsentRequiredCode, blocked.Error.Code)
	}
	if blocked.Error.Retryable {
		t.Fatalf("missing-consent submission is a validation rejection, not retryable")
	}

	// After affirmative consent, submission is permitted.
	state.HealthDataConsent = true
	if allowed := CheckHealthDataSubmission(state); !allowed.Ok {
		t.Fatalf("expected submission allowed after affirmative consent, got %+v", allowed.Error)
	}
}

// Req 30.4: PUT /consent records the master affirmative health-data consent.
func TestApplyRecordsHealthDataConsent(t *testing.T) {
	store := NewInMemoryConsentStore()
	state := mustApply(t, store, ConsentUpdateRequest{
		UserID:            testUser,
		HealthDataConsent: boolPtr(true),
	})
	if !state.HealthDataConsent {
		t.Fatalf("expected health-data consent recorded")
	}
	if state.UpdatedAt == "" {
		t.Fatalf("expected UpdatedAt to be set on consent change")
	}
}

// A partial update must not clobber unrelated categories or the master consent.
func TestApplyMergesPartialUpdate(t *testing.T) {
	store := NewInMemoryConsentStore()
	mustApply(t, store, ConsentUpdateRequest{
		UserID:            testUser,
		Categories:        map[string]bool{"cortisol": true, "meals": true},
		HealthDataConsent: boolPtr(true),
	})

	// Toggle only "meals"; cortisol and health-data consent must be preserved.
	merged := mustApply(t, store, ConsentUpdateRequest{
		UserID:     testUser,
		Categories: map[string]bool{"meals": false},
	})

	if !merged.Categories["cortisol"] {
		t.Fatalf("cortisol opt-in should be preserved across partial update")
	}
	if merged.Categories["meals"] {
		t.Fatalf("meals should be disabled after partial update")
	}
	if !merged.HealthDataConsent {
		t.Fatalf("health-data consent should be preserved across partial update")
	}
}

// Missing userId is rejected without mutating state.
func TestApplyRejectsMissingUser(t *testing.T) {
	store := NewInMemoryConsentStore()
	res := ApplyConsentUpdate(store, ConsentUpdateRequest{Categories: map[string]bool{"x": true}}, time.Now())
	if res.Ok {
		t.Fatalf("expected rejection for missing userId")
	}
	if !res.Error.RetainedState {
		t.Fatalf("rejection must retain prior state")
	}
}

// PUT /consent end-to-end: valid update returns 200 + updated state.
func TestConsentHandlerPutOK(t *testing.T) {
	store := NewInMemoryConsentStore()
	handler := consentHandler(store)

	body, _ := json.Marshal(ConsentUpdateRequest{
		UserID:            testUser,
		Categories:        map[string]bool{"cortisol": true},
		HealthDataConsent: boolPtr(true),
	})
	req := httptest.NewRequest(http.MethodPut, "/consent", bytes.NewReader(body))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rr.Code, rr.Body.String())
	}
	var got ConsentState
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("response not decodable: %v", err)
	}
	if !got.Categories["cortisol"] || !got.HealthDataConsent {
		t.Fatalf("unexpected persisted state: %+v", got)
	}
}

// PUT /consent rejects a non-PUT method and an invalid body.
func TestConsentHandlerRejectsBadRequests(t *testing.T) {
	handler := consentHandler(NewInMemoryConsentStore())

	getReq := httptest.NewRequest(http.MethodGet, "/consent", nil)
	getRR := httptest.NewRecorder()
	handler.ServeHTTP(getRR, getReq)
	if getRR.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 for GET, got %d", getRR.Code)
	}

	badReq := httptest.NewRequest(http.MethodPut, "/consent", strings.NewReader("{not-json"))
	badRR := httptest.NewRecorder()
	handler.ServeHTTP(badRR, badReq)
	if badRR.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid body, got %d", badRR.Code)
	}
}

// RegisterConsentRoutes wires the endpoint additively onto a shared mux.
func TestRegisterConsentRoutes(t *testing.T) {
	mux := http.NewServeMux()
	RegisterConsentRoutes(mux, NewInMemoryConsentStore())

	body, _ := json.Marshal(ConsentUpdateRequest{UserID: testUser, HealthDataConsent: boolPtr(true)})
	req := httptest.NewRequest(http.MethodPut, "/consent", bytes.NewReader(body))
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected route to be wired and return 200, got %d", rr.Code)
	}
}

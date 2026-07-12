// Per-category consent state and the master consent gate (Task 4.4).
//
// This file implements the privacy-first consent model for the User & Profile
// Service (Account_Module). Health data is local-first: nothing egresses off the
// device / persists to the cloud unless the user has recorded an explicit
// per-category opt-in, and the very first health-data submission requires an
// affirmative master health-data consent action.
//
// Two collaborators are provided:
//
//   - PUT /consent — records / updates per-category opt-in and the master
//     health-data consent (Req 17.3, 17.4, 30.4).
//   - The reusable consent gate (CheckCategoryEgress / CheckHealthDataSubmission)
//     invoked *before* any egress or cloud persistence (Req 17.1, 17.2, 17.6,
//     30.5). A missing consent is surfaced as a validation-rejection style
//     "consent-required" outcome with prior/local state retained.
//
// ConsentState mirrors the shared Go domain type
// (shared/go/domain.go — package contracts) field-for-field, following the same
// local-mirror convention already used by result.go for the shared result
// contract. Persistence aligns with migration 000005_create_consent: a
// consent_states row (health_data_consent + updated_at) plus one
// consent_categories row per category (opted_in).
//
// Requirements: 17.1, 17.2, 17.3, 17.4, 17.6, 30.4, 30.5
package main

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

// ConsentState is the per-category consent state for a user. It mirrors the
// shared domain type contracts.ConsentState (userId, categories map,
// healthDataConsent, updatedAt).
//
// Requirements: 17.1, 30.4
type ConsentState struct {
	UserID string `json:"userId"`
	// Categories is the per-category opt-in map. A category egresses only when
	// its entry is present AND true (Req 17.1, 17.2). Absent or false blocks
	// egress for that category (Req 17.6).
	Categories map[string]bool `json:"categories"`
	// HealthDataConsent is the affirmative master consent required before the
	// first health-data submission is persisted (Req 30.4).
	HealthDataConsent bool `json:"healthDataConsent"`
	// UpdatedAt is the ISO-8601 timestamp of the most recent consent change.
	UpdatedAt string `json:"updatedAt"`
}

// newConsentState returns an empty, all-denied consent state for a user. This
// is the safe default: no category is opted in and master health-data consent
// has not been given, so every egress and first submission is blocked until the
// user acts (Req 17.1, 30.4).
func newConsentState(userID string) ConsentState {
	return ConsentState{
		UserID:            userID,
		Categories:        map[string]bool{},
		HealthDataConsent: false,
		UpdatedAt:         "",
	}
}

// clone returns a deep copy so callers never mutate stored state in place.
func (s ConsentState) clone() ConsentState {
	cats := make(map[string]bool, len(s.Categories))
	for k, v := range s.Categories {
		cats[k] = v
	}
	return ConsentState{
		UserID:            s.UserID,
		Categories:        cats,
		HealthDataConsent: s.HealthDataConsent,
		UpdatedAt:         s.UpdatedAt,
	}
}

// IsCategoryEnabled reports whether egress is permitted for a category: the
// category must have a recorded opt-in that is explicitly enabled (Req 17.1).
func (s ConsentState) IsCategoryEnabled(category string) bool {
	enabled, ok := s.Categories[category]
	return ok && enabled
}

// ---------------------------------------------------------------------------
// Consent gate (reusable, invoked before any egress / cloud persistence)
// ---------------------------------------------------------------------------

// ConsentRequiredCode is the stable error code surfaced when an egress or
// persistence is attempted without the required consent (Req 17.6, 30.5).
const ConsentRequiredCode = "CONSENT_REQUIRED"

// EgressDecision is the successful result of a category egress check. It is
// returned only when transmission/cloud persistence is permitted for the
// category.
type EgressDecision struct {
	Category string `json:"category"`
	Allowed  bool   `json:"allowed"`
}

// CheckCategoryEgress is the reusable consent gate that MUST be consulted before
// transmitting any health-data category off-device or persisting it to the
// cloud.
//
//   - If the category has a recorded, enabled opt-in, egress is allowed
//     (Req 17.1, 17.2).
//   - Otherwise — the category was never enabled, or a previously enabled
//     opt-in was disabled (Req 17.4) — egress is blocked with a consent-required
//     indication (Req 17.6). The block is a validation-rejection: the local copy
//     in the Data Vault is retained unchanged (RetainedState=true) and the same
//     attempt will keep failing until consent is recorded (Retryable=false).
//
// Because the decision reads the current stored state, a consent change saved
// via PUT /consent applies to every egress initiated after the save (Req 17.3),
// and a disable stops further egress for that category (Req 17.4).
//
// Requirements: 17.1, 17.2, 17.4, 17.6
func CheckCategoryEgress(state ConsentState, category string) Result[EgressDecision] {
	if category == "" {
		return Fail[EgressDecision](ValidationRejection(
			"CONSENT_CATEGORY_REQUIRED",
			"a data category is required to evaluate egress consent",
		))
	}
	if state.IsCategoryEnabled(category) {
		return Okay(EgressDecision{Category: category, Allowed: true})
	}
	return Fail[EgressDecision](ValidationRejection(
		ConsentRequiredCode,
		"consent is required for category "+category+" before it can leave the device; the local copy is retained",
	))
}

// CheckHealthDataSubmission is the master consent gate applied to the first (and
// every) health-data submission before it is persisted. If affirmative
// health-data consent has been recorded the submission may proceed; otherwise
// the submission is rejected, no submitted health data is retained, and a
// consent-required indication is surfaced (Req 30.4, 30.5). Prior state is
// unchanged, so RetainedState is true.
//
// Requirements: 30.4, 30.5
func CheckHealthDataSubmission(state ConsentState) Result[bool] {
	if state.HealthDataConsent {
		return Okay(true)
	}
	return Fail[bool](ValidationRejection(
		ConsentRequiredCode,
		"affirmative health-data consent is required before health data can be persisted; the submission was not stored",
	))
}

// ---------------------------------------------------------------------------
// Persistence (aligned with migration 000005_create_consent)
// ---------------------------------------------------------------------------

// ConsentStore persists consent state. The composite (user_id, category) rows of
// consent_categories are represented by ConsentState.Categories; the parent
// consent_states row is represented by ConsentState.HealthDataConsent /
// UpdatedAt.
type ConsentStore interface {
	// Get returns the stored consent state for a user and whether one existed.
	Get(userID string) (ConsentState, bool)
	// Save persists the consent state (upsert).
	Save(state ConsentState) error
}

// InMemoryConsentStore is a thread-safe in-memory ConsentStore. A database-backed
// implementation over the consent_states / consent_categories tables can satisfy
// the same interface in a later infrastructure task.
type InMemoryConsentStore struct {
	mu     sync.RWMutex
	states map[string]ConsentState
}

// NewInMemoryConsentStore constructs an empty in-memory consent store.
func NewInMemoryConsentStore() *InMemoryConsentStore {
	return &InMemoryConsentStore{states: map[string]ConsentState{}}
}

// Get returns a deep copy of the stored state to prevent external mutation.
func (s *InMemoryConsentStore) Get(userID string) (ConsentState, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	st, ok := s.states[userID]
	if !ok {
		return ConsentState{}, false
	}
	return st.clone(), true
}

// Save upserts the state, storing a deep copy.
func (s *InMemoryConsentStore) Save(state ConsentState) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.states[state.UserID] = state.clone()
	return nil
}

// ---------------------------------------------------------------------------
// PUT /consent
// ---------------------------------------------------------------------------

// ConsentUpdateRequest is the PUT /consent request body. Only the provided
// fields are applied, so a client can toggle a single category (enable per
// Req 17.3 or disable per Req 17.4) without resending the full state.
type ConsentUpdateRequest struct {
	UserID string `json:"userId"`
	// Categories is a partial map of category -> opt-in. Present entries are
	// merged into the stored state; enabling records an opt-in (Req 17.3),
	// disabling clears it (Req 17.4).
	Categories map[string]bool `json:"categories,omitempty"`
	// HealthDataConsent, when non-nil, sets the master affirmative consent
	// (Req 30.4). A pointer distinguishes "not provided" from "set to false".
	HealthDataConsent *bool `json:"healthDataConsent,omitempty"`
}

// ApplyConsentUpdate merges an update into the stored consent state and persists
// it, returning the updated state. This is the pure core of the PUT /consent
// handler and is exercised directly by unit tests.
//
//   - Enabling a category records the opt-in and takes effect for every egress
//     initiated after the save (Req 17.3).
//   - Disabling a previously enabled category clears the opt-in so subsequent
//     egress is blocked while the local copy is retained (Req 17.4).
//   - Setting healthDataConsent records the master affirmative consent (Req 30.4).
//
// A missing/empty userId is a validation rejection with prior state preserved.
//
// Requirements: 17.3, 17.4, 30.4
func ApplyConsentUpdate(store ConsentStore, req ConsentUpdateRequest, now time.Time) Result[ConsentState] {
	if req.UserID == "" {
		return Fail[ConsentState](ValidationRejection(
			"CONSENT_USER_REQUIRED",
			"userId is required to record consent",
		))
	}

	state, ok := store.Get(req.UserID)
	if !ok {
		state = newConsentState(req.UserID)
	}
	if state.Categories == nil {
		state.Categories = map[string]bool{}
	}

	for category, optedIn := range req.Categories {
		if category == "" {
			return Fail[ConsentState](ValidationRejection(
				"CONSENT_CATEGORY_REQUIRED",
				"consent category names must be non-empty",
			))
		}
		state.Categories[category] = optedIn
	}

	if req.HealthDataConsent != nil {
		state.HealthDataConsent = *req.HealthDataConsent
	}

	state.UpdatedAt = now.UTC().Format(time.RFC3339)

	if err := store.Save(state); err != nil {
		// Persisting the consent change failed: retain prior state, allow retry.
		return Fail[ConsentState](AtomicFailure(
			"CONSENT_SAVE_FAILED",
			"could not persist consent state: "+err.Error(),
			true,
		))
	}

	return Okay(state)
}

// consentHandler serves PUT /consent.
func consentHandler(store ConsentStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			writeConsentError(w, http.StatusMethodNotAllowed, ValidationRejection(
				"METHOD_NOT_ALLOWED", "consent endpoint accepts PUT only"))
			return
		}

		var req ConsentUpdateRequest
		if r.Body != nil {
			defer r.Body.Close()
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeConsentError(w, http.StatusBadRequest, ValidationRejection(
				"CONSENT_BODY_INVALID", "request body is not valid JSON"))
			return
		}

		result := ApplyConsentUpdate(store, req, time.Now())
		if !result.Ok {
			status := http.StatusBadRequest
			if result.Error != nil && result.Error.Code == "CONSENT_SAVE_FAILED" {
				status = http.StatusInternalServerError
			}
			writeConsentError(w, status, *result.Error)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(result.Value)
	}
}

// writeConsentError writes a structured error contract as the JSON response.
func writeConsentError(w http.ResponseWriter, status int, e ErrorContract) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"code":          e.Code,
		"message":       e.Message,
		"retryable":     e.Retryable,
		"retainedState": e.RetainedState,
	})
}

// RegisterConsentRoutes wires the consent endpoint onto a shared mux. Wiring is
// additive so parallel route registrations in the same service do not conflict.
func RegisterConsentRoutes(mux *http.ServeMux, store ConsentStore) {
	mux.HandleFunc("/consent", consentHandler(store))
}

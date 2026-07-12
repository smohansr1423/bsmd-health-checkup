// HTTP layer for data export and account deletion (Task 4.8).
//
// Exposes `POST /export` and `POST /account/delete` on a standard-library
// http.ServeMux via additive route wiring (RegisterAccountDataRoutes), so the
// service bootstrap (main.go) can mount these without this file owning the
// server. All handlers translate the pure export/deletion outcomes (export.go,
// deletion.go) and the shared error/result contract (result.go) into HTTP
// responses.
//
// Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7
package main

import (
	"encoding/json"
	"net/http"
	"time"
)

// AccountDataStore is the persistence port the export/deletion handlers depend
// on. Concrete PostgreSQL wiring is provided by the service bootstrap; the
// handlers stay decoupled and unit-testable.
type AccountDataStore interface {
	// LoadPersonalData returns all of a user's personal data, grouped by
	// category (Req 20.1).
	LoadPersonalData(userID string) (PersonalData, error)
	// PersistExport durably stores a fully-generated export artifact. A
	// non-nil error indicates the export could not be completed (Req 20.3).
	PersistExport(ExportArtifact) error
	// CommitDeletion performs a deletion plan as a single all-or-nothing
	// transaction (Req 20.5, 20.7). A non-nil error means nothing was deleted.
	CommitDeletion(DeletionPlan) error
}

// AccountDataService wires the export/deletion logic to a store, a legal
// retention policy, and a clock.
type AccountDataService struct {
	Store  AccountDataStore
	Policy LegalRetentionPolicy
	// Now returns the current time; overridable for tests. Defaults to time.Now.
	Now func() time.Time
}

// NewAccountDataService builds a service with the default legal-retention
// policy and the real clock.
func NewAccountDataService(store AccountDataStore) *AccountDataService {
	return &AccountDataService{
		Store:  store,
		Policy: DefaultLegalRetentionPolicy,
		Now:    time.Now,
	}
}

func (s *AccountDataService) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// RegisterAccountDataRoutes mounts the export and deletion endpoints on mux.
// Intended to be called additively from the service bootstrap.
func RegisterAccountDataRoutes(mux *http.ServeMux, svc *AccountDataService) {
	mux.HandleFunc("POST /export", svc.HandleExport)
	mux.HandleFunc("POST /account/delete", svc.HandleAccountDelete)
}

// exportRequestBody is the POST /export request payload. The authentication
// context is expected to be populated by upstream auth middleware; it is
// modelled explicitly here so the identity gate (Req 20.2) is testable.
type exportRequestBody struct {
	UserID        string `json:"userId"`
	Authenticated bool   `json:"authenticated"`
	Verified      bool   `json:"verified"`
}

// HandleExport implements POST /export (Req 20.1, 20.2, 20.3).
func (s *AccountDataService) HandleExport(w http.ResponseWriter, r *http.Request) {
	var body exportRequestBody
	if err := decodeAccountJSON(r, &body); err != nil {
		writeAccountError(w, http.StatusBadRequest, ValidationRejection("invalid_request", "malformed export request body"))
		return
	}

	req := ExportRequest{
		UserID:        body.UserID,
		Authenticated: body.Authenticated,
		Verified:      body.Verified,
	}

	// Identity gate happens before any data is loaded (Req 20.2 — no file, no work).
	if !req.Authenticated || !req.Verified {
		res := GenerateExport(req, PersonalData{}, nil, s.now())
		writeAccountError(w, http.StatusUnauthorized, *res.Error)
		return
	}

	data, err := s.Store.LoadPersonalData(req.UserID)
	if err != nil {
		// Loading failed before any artifact was built — atomic, nothing produced.
		writeAccountError(w, http.StatusInternalServerError, AtomicFailure("export_failed", "could not read personal data for export", true))
		return
	}

	res := GenerateExport(req, data, s.Store.PersistExport, s.now())
	if !res.Ok {
		writeAccountError(w, http.StatusInternalServerError, *res.Error)
		return
	}

	writeAccountJSON(w, http.StatusAccepted, map[string]any{
		"status":      "export_ready",
		"userId":      res.Value.UserID,
		"formats":     []string{"json", "csv"},
		"generatedAt": res.Value.GeneratedAt.UTC().Format(time.RFC3339),
		"availableBy": res.Value.AvailableBy.UTC().Format(time.RFC3339),
		"json":        res.Value.JSON,
		"csv":         res.Value.CSV,
	})
}

// deleteRequestBody is the POST /account/delete request payload.
type deleteRequestBody struct {
	UserID        string `json:"userId"`
	Authenticated bool   `json:"authenticated"`
	// Confirmed carries the user's explicit deletion confirmation (Req 20.4).
	Confirmed bool `json:"confirmed"`
}

// HandleAccountDelete implements POST /account/delete (Req 20.4, 20.5, 20.6, 20.7).
func (s *AccountDataService) HandleAccountDelete(w http.ResponseWriter, r *http.Request) {
	var body deleteRequestBody
	if err := decodeAccountJSON(r, &body); err != nil {
		writeAccountError(w, http.StatusBadRequest, ValidationRejection("invalid_request", "malformed deletion request body"))
		return
	}

	req := DeletionRequest{
		UserID:        body.UserID,
		Authenticated: body.Authenticated,
		Confirmed:     body.Confirmed,
	}

	data := PersonalData{UserID: req.UserID}
	if req.Authenticated && req.Confirmed {
		loaded, err := s.Store.LoadPersonalData(req.UserID)
		if err != nil {
			writeAccountError(w, http.StatusInternalServerError, AtomicFailure("deletion_failed", "could not read account data for deletion", true))
			return
		}
		data = loaded
	}

	planRes := PlanDeletion(req, data, s.Policy, s.now())
	if !planRes.Ok {
		// Missing confirmation / identity → 400/401, account unchanged.
		status := http.StatusBadRequest
		if planRes.Error.Code == "identity_verification_required" {
			status = http.StatusUnauthorized
		}
		writeAccountError(w, status, *planRes.Error)
		return
	}

	res := ExecuteDeletion(planRes.Value, s.Store.CommitDeletion)
	if !res.Ok {
		writeAccountError(w, http.StatusInternalServerError, *res.Error)
		return
	}

	writeAccountJSON(w, http.StatusAccepted, map[string]any{
		"status":             "deletion_scheduled",
		"userId":             res.Value.UserID,
		"deletedCategories":  res.Value.Deleted,
		"retainedCategories": res.Value.Retained,
		"confirmedAt":        res.Value.ConfirmedAt.UTC().Format(time.RFC3339),
		"completeBy":         res.Value.CompleteBy.UTC().Format(time.RFC3339),
	})
}

// ---------------------------------------------------------------------------
// small HTTP helpers
// ---------------------------------------------------------------------------

func decodeAccountJSON(r *http.Request, dst any) error {
	if r.Body == nil {
		return nil
	}
	dec := json.NewDecoder(r.Body)
	return dec.Decode(dst)
}

func writeAccountJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// writeAccountError renders the shared error contract as a JSON error response.
func writeAccountError(w http.ResponseWriter, status int, e ErrorContract) {
	writeAccountJSON(w, status, map[string]any{
		"error": map[string]any{
			"code":          e.Code,
			"message":       e.Message,
			"retryable":     e.Retryable,
			"retainedState": e.RetainedState,
		},
	})
}

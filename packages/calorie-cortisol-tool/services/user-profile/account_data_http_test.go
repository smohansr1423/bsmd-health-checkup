// HTTP handler tests for export/deletion endpoints (Task 4.8).
package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fakeAccountStore is an in-memory AccountDataStore for handler tests.
type fakeAccountStore struct {
	data          PersonalData
	loadErr       error
	persistErr    error
	commitErr     error
	persistCalled bool
	commitCalled  bool
}

func (f *fakeAccountStore) LoadPersonalData(userID string) (PersonalData, error) {
	if f.loadErr != nil {
		return PersonalData{}, f.loadErr
	}
	return f.data, nil
}
func (f *fakeAccountStore) PersistExport(ExportArtifact) error {
	f.persistCalled = true
	return f.persistErr
}
func (f *fakeAccountStore) CommitDeletion(DeletionPlan) error {
	f.commitCalled = true
	return f.commitErr
}

func newAccountTestService(store *fakeAccountStore) *AccountDataService {
	svc := NewAccountDataService(store)
	svc.Now = func() time.Time { return time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC) }
	return svc
}

func doAccountJSON(t *testing.T, h http.HandlerFunc, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

// Req 20.2 — HTTP export rejects an unverified caller with no file produced.
func TestHandleExport_Unverified(t *testing.T) {
	store := &fakeAccountStore{data: exportSampleData()}
	svc := newAccountTestService(store)

	rec := doAccountJSON(t, svc.HandleExport, "/export", `{"userId":"user-1","authenticated":true,"verified":false}`)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
	if store.persistCalled {
		t.Fatalf("no export file should be persisted for unverified request")
	}
}

// Req 20.1 — HTTP export returns JSON+CSV for a verified caller.
func TestHandleExport_Success(t *testing.T) {
	store := &fakeAccountStore{data: exportSampleData()}
	svc := newAccountTestService(store)

	rec := doAccountJSON(t, svc.HandleExport, "/export", `{"userId":"user-1","authenticated":true,"verified":true}`)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d (%s)", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad response json: %v", err)
	}
	if resp["json"] == nil || resp["csv"] == nil {
		t.Fatalf("response must carry both json and csv payloads")
	}
	if !store.persistCalled {
		t.Fatalf("export artifact should be persisted")
	}
}

// Req 20.3 — HTTP export surfaces an atomic failure when persistence fails.
func TestHandleExport_PersistFailure(t *testing.T) {
	store := &fakeAccountStore{data: exportSampleData(), persistErr: errors.New("s3 down")}
	svc := newAccountTestService(store)

	rec := doAccountJSON(t, svc.HandleExport, "/export", `{"userId":"user-1","authenticated":true,"verified":true}`)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}
	var resp map[string]map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["error"]["code"] != "export_failed" {
		t.Fatalf("expected export_failed, got %v", resp["error"]["code"])
	}
	if resp["error"]["retainedState"] != true {
		t.Fatalf("failure must preserve prior data")
	}
}

// Req 20.4 — HTTP deletion without confirmation is rejected, account unchanged.
func TestHandleAccountDelete_RequiresConfirmation(t *testing.T) {
	store := &fakeAccountStore{data: deletionSampleData()}
	svc := newAccountTestService(store)

	rec := doAccountJSON(t, svc.HandleAccountDelete, "/account/delete", `{"userId":"user-1","authenticated":true,"confirmed":false}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
	if store.commitCalled {
		t.Fatalf("no deletion should be committed without confirmation")
	}
}

// Req 20.5, 20.6 — HTTP deletion reports deleted and retained categories.
func TestHandleAccountDelete_Success(t *testing.T) {
	store := &fakeAccountStore{data: deletionSampleData()}
	svc := newAccountTestService(store)

	rec := doAccountJSON(t, svc.HandleAccountDelete, "/account/delete", `{"userId":"user-1","authenticated":true,"confirmed":true}`)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d (%s)", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad response json: %v", err)
	}
	retained, ok := resp["retainedCategories"].([]any)
	if !ok || len(retained) != 2 {
		t.Fatalf("expected 2 retained categories in response, got %v", resp["retainedCategories"])
	}
	if !store.commitCalled {
		t.Fatalf("deletion should be committed")
	}
}

// Req 20.7 — HTTP deletion surfaces an atomic failure when commit fails.
func TestHandleAccountDelete_CommitFailure(t *testing.T) {
	store := &fakeAccountStore{data: deletionSampleData(), commitErr: errors.New("tx failed")}
	svc := newAccountTestService(store)

	rec := doAccountJSON(t, svc.HandleAccountDelete, "/account/delete", `{"userId":"user-1","authenticated":true,"confirmed":true}`)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}
	var resp map[string]map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp["error"]["code"] != "deletion_failed" || resp["error"]["retainedState"] != true {
		t.Fatalf("expected atomic deletion_failed with retained state, got %v", resp["error"])
	}
}

// Unit tests for data export (Task 4.8 — Req 20.1, 20.2, 20.3).
package main

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func exportSampleData() PersonalData {
	return PersonalData{
		UserID: "user-1",
		Records: map[PersonalDataCategory][]Record{
			CategoryProfile: {
				{"userId": "user-1", "displayName": "Priya", "wakeTime": "06:30"},
			},
			CategoryConsent: {
				{"category": "cortisol", "optedIn": true},
				{"category": "meals", "optedIn": false},
			},
			CategoryBilling: {
				{"amountCents": 999, "currency": "USD", "status": "captured"},
			},
		},
	}
}

// Req 20.2 — unauthenticated/unverified export is rejected with no file produced.
func TestGenerateExport_RejectsUnverified(t *testing.T) {
	cases := []ExportRequest{
		{UserID: "user-1", Authenticated: false, Verified: false},
		{UserID: "user-1", Authenticated: true, Verified: false},
		{UserID: "user-1", Authenticated: false, Verified: true},
	}
	for _, req := range cases {
		persisted := false
		res := GenerateExport(req, exportSampleData(), func(ExportArtifact) error { persisted = true; return nil }, time.Now())
		if res.Ok {
			t.Fatalf("expected rejection for %+v", req)
		}
		if res.Error.Code != "identity_verification_required" {
			t.Fatalf("expected identity_verification_required, got %q", res.Error.Code)
		}
		if persisted {
			t.Fatalf("no export file should be produced for unverified request %+v", req)
		}
		if !res.Error.RetainedState {
			t.Fatalf("prior data must be preserved on rejection")
		}
	}
}

// Req 20.1 — a verified export contains all personal data in BOTH JSON and CSV,
// available within 24 hours.
func TestGenerateExport_CompleteAndDual(t *testing.T) {
	data := exportSampleData()
	now := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)
	req := ExportRequest{UserID: "user-1", Authenticated: true, Verified: true}

	res := GenerateExport(req, data, nil, now)
	if !res.Ok {
		t.Fatalf("expected success, got error %+v", res.Error)
	}
	art := res.Value

	if !art.CoversAllCategories(data) {
		t.Fatalf("export must cover all categories in both formats")
	}

	// JSON is valid and holds all categories.
	var doc exportDocument
	if err := json.Unmarshal([]byte(art.JSON), &doc); err != nil {
		t.Fatalf("json export not parseable: %v", err)
	}
	for cat := range data.Records {
		if _, ok := doc.Data[string(cat)]; !ok {
			t.Fatalf("json export missing category %q", cat)
		}
		if _, ok := art.CSV[cat]; !ok {
			t.Fatalf("csv export missing category %q", cat)
		}
	}

	// CSV content is sensible (header present for profile).
	if !strings.Contains(art.CSV[CategoryProfile], "displayName") {
		t.Fatalf("profile CSV missing expected column, got: %q", art.CSV[CategoryProfile])
	}

	// Available within 24 hours (Req 20.1).
	if art.AvailableBy.Sub(now) != ExportAvailabilityWindow {
		t.Fatalf("expected availability within 24h, got %v", art.AvailableBy.Sub(now))
	}
}

// Req 20.3 — a persistence failure produces no artifact and preserves data.
func TestGenerateExport_AtomicOnPersistFailure(t *testing.T) {
	req := ExportRequest{UserID: "user-1", Authenticated: true, Verified: true}
	res := GenerateExport(req, exportSampleData(), func(ExportArtifact) error {
		return errors.New("disk full")
	}, time.Now())

	if res.Ok {
		t.Fatalf("expected atomic failure on persist error")
	}
	if res.Error.Code != "export_failed" {
		t.Fatalf("expected export_failed, got %q", res.Error.Code)
	}
	if !res.Error.RetainedState {
		t.Fatalf("prior data must be preserved (no partial artifact)")
	}
	if !res.Error.Retryable {
		t.Fatalf("export failure should be retryable")
	}
}

// Req 20.3 — a serialisation failure aborts the whole build (no partial artifact).
func TestGenerateExport_AtomicOnSerializationFailure(t *testing.T) {
	data := PersonalData{
		UserID: "user-1",
		Records: map[PersonalDataCategory][]Record{
			// A func value cannot be marshalled to JSON, forcing a build failure.
			CategoryProfile: {{"bad": func() {}}},
		},
	}
	persisted := false
	req := ExportRequest{UserID: "user-1", Authenticated: true, Verified: true}
	res := GenerateExport(req, data, func(ExportArtifact) error { persisted = true; return nil }, time.Now())

	if res.Ok {
		t.Fatalf("expected atomic failure on serialization error")
	}
	if persisted {
		t.Fatalf("persist must not be called when the artifact could not be built")
	}
	if res.Error.Code != "export_failed" || !res.Error.RetainedState {
		t.Fatalf("expected atomic export_failed with retained state, got %+v", res.Error)
	}
}

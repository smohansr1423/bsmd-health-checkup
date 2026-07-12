// Unit tests for account deletion (Task 4.8 — Req 20.4, 20.5, 20.6, 20.7).
package main

import (
	"errors"
	"testing"
	"time"
)

func deletionSampleData() PersonalData {
	return PersonalData{
		UserID: "user-1",
		Records: map[PersonalDataCategory][]Record{
			CategoryProfile:  {{"userId": "user-1"}},
			CategoryConsent:  {{"category": "cortisol", "optedIn": true}},
			CategoryMeals:    {{"id": "m1"}},
			CategoryCortisol: {{"id": "c1"}},
			CategoryBilling:  {{"amountCents": 999}},
			CategoryAudit:    {{"action": "create"}},
		},
	}
}

// Req 20.4 — deletion without explicit confirmation is rejected, account unchanged.
func TestPlanDeletion_RequiresConfirmation(t *testing.T) {
	req := DeletionRequest{UserID: "user-1", Authenticated: true, Confirmed: false}
	res := PlanDeletion(req, deletionSampleData(), DefaultLegalRetentionPolicy, time.Now())
	if res.Ok {
		t.Fatalf("expected rejection without confirmation")
	}
	if res.Error.Code != "confirmation_required" {
		t.Fatalf("expected confirmation_required, got %q", res.Error.Code)
	}
	if !res.Error.RetainedState {
		t.Fatalf("account must be left unchanged when confirmation is missing")
	}
}

func TestPlanDeletion_RequiresAuth(t *testing.T) {
	req := DeletionRequest{UserID: "user-1", Authenticated: false, Confirmed: true}
	res := PlanDeletion(req, deletionSampleData(), DefaultLegalRetentionPolicy, time.Now())
	if res.Ok || res.Error.Code != "identity_verification_required" {
		t.Fatalf("expected identity_verification_required, got %+v", res.Error)
	}
}

// Req 20.5, 20.6 — confirmed deletion removes all data except legally-retained
// categories, which are reported with their basis and restricted purpose.
func TestPlanDeletion_PartitionsWithRetention(t *testing.T) {
	now := time.Date(2024, 3, 1, 0, 0, 0, 0, time.UTC)
	req := DeletionRequest{UserID: "user-1", Authenticated: true, Confirmed: true}
	res := PlanDeletion(req, deletionSampleData(), DefaultLegalRetentionPolicy, now)
	if !res.Ok {
		t.Fatalf("expected success, got %+v", res.Error)
	}
	plan := res.Value

	// 30-day completion deadline (Req 20.5).
	if plan.CompleteBy.Sub(now) != DeletionCompletionWindow {
		t.Fatalf("expected 30-day completion window, got %v", plan.CompleteBy.Sub(now))
	}

	// Billing + audit retained; everything else deleted.
	retained := map[PersonalDataCategory]RetainedCategory{}
	for _, r := range plan.Retained {
		retained[r.Category] = r
		if r.Basis == "" || r.Purpose == "" {
			t.Fatalf("retained category %q must report basis and purpose", r.Category)
		}
	}
	if _, ok := retained[CategoryBilling]; !ok {
		t.Fatalf("billing must be retained under legal obligation")
	}
	if _, ok := retained[CategoryAudit]; !ok {
		t.Fatalf("audit must be retained under legal obligation")
	}

	deleted := map[PersonalDataCategory]bool{}
	for _, d := range plan.Deleted {
		deleted[d] = true
	}
	for _, mustDelete := range []PersonalDataCategory{CategoryProfile, CategoryConsent, CategoryMeals, CategoryCortisol} {
		if !deleted[mustDelete] {
			t.Fatalf("expected %q to be scheduled for deletion", mustDelete)
		}
	}
	// Retained categories must never appear in the deleted set.
	if deleted[CategoryBilling] || deleted[CategoryAudit] {
		t.Fatalf("retained categories must not be deleted")
	}
}

// Req 20.5, 20.6 — a successful commit reports deleted and retained categories.
func TestExecuteDeletion_Success(t *testing.T) {
	now := time.Now()
	plan := PlanDeletion(
		DeletionRequest{UserID: "user-1", Authenticated: true, Confirmed: true},
		deletionSampleData(), DefaultLegalRetentionPolicy, now,
	).Value

	committed := false
	res := ExecuteDeletion(plan, func(p DeletionPlan) error {
		committed = true
		return nil
	})
	if !res.Ok {
		t.Fatalf("expected successful deletion, got %+v", res.Error)
	}
	if !committed {
		t.Fatalf("commit must be invoked")
	}
	if len(res.Value.Retained) != 2 {
		t.Fatalf("expected 2 retained categories, got %d", len(res.Value.Retained))
	}
}

// Req 20.7 — a commit failure preserves the pre-deletion state (atomic).
func TestExecuteDeletion_AtomicOnFailure(t *testing.T) {
	plan := PlanDeletion(
		DeletionRequest{UserID: "user-1", Authenticated: true, Confirmed: true},
		deletionSampleData(), DefaultLegalRetentionPolicy, time.Now(),
	).Value

	res := ExecuteDeletion(plan, func(DeletionPlan) error {
		return errors.New("db transaction rolled back")
	})
	if res.Ok {
		t.Fatalf("expected atomic failure on commit error")
	}
	if res.Error.Code != "deletion_failed" {
		t.Fatalf("expected deletion_failed, got %q", res.Error.Code)
	}
	if !res.Error.RetainedState {
		t.Fatalf("pre-deletion state must be preserved on failure")
	}
	if !res.Error.Retryable {
		t.Fatalf("deletion failure should be retryable")
	}
}

// Req 20.7 — a deletion that does not complete within 30 days is flagged and
// the account is preserved with a user notification.
func TestDeletionOverdue(t *testing.T) {
	now := time.Date(2024, 3, 1, 0, 0, 0, 0, time.UTC)
	plan := PlanDeletion(
		DeletionRequest{UserID: "user-1", Authenticated: true, Confirmed: true},
		deletionSampleData(), DefaultLegalRetentionPolicy, now,
	).Value

	// Before the deadline, not completed → not overdue.
	if DeletionOverdue(plan, false, now.Add(10*24*time.Hour)) {
		t.Fatalf("should not be overdue before the 30-day deadline")
	}
	// Completed → never overdue.
	if DeletionOverdue(plan, true, now.Add(40*24*time.Hour)) {
		t.Fatalf("completed deletion is never overdue")
	}
	// After the deadline, not completed → overdue.
	if !DeletionOverdue(plan, false, now.Add(31*24*time.Hour)) {
		t.Fatalf("should be overdue past the 30-day deadline")
	}

	notice := OverdueDeletionNotice("user-1")
	if notice.Code != "deletion_not_completed" {
		t.Fatalf("unexpected notice code %q", notice.Code)
	}
	if !notice.RetainedState {
		t.Fatalf("overdue deletion must preserve pre-deletion state")
	}
}

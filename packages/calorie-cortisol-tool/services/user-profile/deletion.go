// Account deletion — `POST /account/delete` (Task 4.8).
//
// Implements GDPR Article 17 ("right to erasure"): a confirmed account deletion
// removes the user's account and all associated personal data within 30 days,
// EXCEPT categories subject to a legal retention obligation, which are
// restricted to their retention purpose and reported back to the user with the
// basis for retention (Req 20.4–20.6). Deletion is atomic: on failure the
// account is preserved in its pre-deletion state (Req 20.7). If the process
// does not complete within 30 days of confirmation, the pre-deletion state is
// preserved and the user is notified (Req 20.7).
//
// Reuses the shared Go error/result contract (result.go): validation-rejection
// for a missing confirmation, atomic-failure for a failed commit.
//
// Requirements: 20.4, 20.5, 20.6, 20.7
package main

import (
	"fmt"
	"sort"
	"time"
)

// DeletionCompletionWindow is the maximum time a confirmed deletion may take to
// complete (Req 20.5, 20.7).
const DeletionCompletionWindow = 30 * 24 * time.Hour

// DeletionRequest is a request to delete an account and its personal data.
// Confirmed models the explicit confirmation required by Req 20.4.
type DeletionRequest struct {
	UserID        string
	Authenticated bool
	// Confirmed is the user's explicit deletion confirmation (Req 20.4).
	Confirmed bool
}

// RetainedCategory describes a personal-data category that survives deletion
// because it is under a legal retention obligation. Basis and Purpose satisfy
// the Req 20.6 reporting obligation (which categories were retained and why),
// and Purpose records the restricted use the data is limited to.
type RetainedCategory struct {
	Category PersonalDataCategory `json:"category"`
	Basis    string               `json:"basis"`
	Purpose  string               `json:"purpose"`
}

// LegalRetentionPolicy maps the categories that must be retained after deletion
// to the legal basis and restricted purpose for keeping them. Categories absent
// from the policy are fully deleted.
type LegalRetentionPolicy map[PersonalDataCategory]RetainedCategory

// DefaultLegalRetentionPolicy is the baseline carve-out for this service:
// financial/billing records and the append-only audit log carry statutory
// retention obligations, so they are preserved (restricted to their purpose)
// even after erasure (Req 20.6; audit ≥6-year retention per Req 25.6).
var DefaultLegalRetentionPolicy = LegalRetentionPolicy{
	CategoryBilling: {
		Category: CategoryBilling,
		Basis:    "legal_obligation:financial_records_retention",
		Purpose:  "tax_and_accounting_compliance",
	},
	CategoryAudit: {
		Category: CategoryAudit,
		Basis:    "legal_obligation:audit_log_retention_6yr",
		Purpose:  "security_and_compliance_audit",
	},
}

// DeletionPlan is the resolved partition of a user's data into categories to
// delete and categories to retain under a legal obligation. It is computed
// before any mutation so the commit step is a single all-or-nothing operation.
type DeletionPlan struct {
	UserID    string
	Deleted   []PersonalDataCategory
	Retained  []RetainedCategory
	// ConfirmedAt is when the deletion was confirmed.
	ConfirmedAt time.Time
	// CompleteBy is the 30-day completion deadline (Req 20.5).
	CompleteBy time.Time
}

// DeletionResult is the outcome reported to the user once a deletion commits.
type DeletionResult struct {
	UserID     string             `json:"userId"`
	Deleted    []PersonalDataCategory `json:"deletedCategories"`
	Retained   []RetainedCategory `json:"retainedCategories"`
	ConfirmedAt time.Time         `json:"confirmedAt"`
	CompleteBy time.Time          `json:"completeBy"`
}

// PlanDeletion validates the request and partitions the user's data into
// deleted vs. legally-retained categories. It performs no mutation.
//
//   - An unauthenticated request is rejected (identity gate).
//   - A request without explicit confirmation is rejected and the account is
//     left unchanged (Req 20.4, validation-rejection pattern).
//   - Every category present in the data is classified: those covered by the
//     retention policy are retained with their basis/purpose (Req 20.6); all
//     others are scheduled for deletion (Req 20.5).
//
// Requirements: 20.4, 20.5, 20.6
func PlanDeletion(req DeletionRequest, data PersonalData, policy LegalRetentionPolicy, now time.Time) Result[DeletionPlan] {
	if !req.Authenticated {
		return Fail[DeletionPlan](ValidationRejection(
			"identity_verification_required",
			"account deletion requires an authenticated user",
		))
	}
	// Req 20.4 — explicit confirmation is mandatory; without it nothing changes.
	if !req.Confirmed {
		return Fail[DeletionPlan](ValidationRejection(
			"confirmation_required",
			"account deletion requires explicit user confirmation",
		))
	}

	if policy == nil {
		policy = LegalRetentionPolicy{}
	}

	var deleted []PersonalDataCategory
	var retained []RetainedCategory
	for _, cat := range data.Categories() {
		if rc, ok := policy[cat]; ok {
			// Normalise the reported category to the one being retained.
			rc.Category = cat
			retained = append(retained, rc)
			continue
		}
		deleted = append(deleted, cat)
	}
	// Deterministic ordering for stable reporting/tests.
	sort.Slice(deleted, func(i, j int) bool { return deleted[i] < deleted[j] })
	sort.Slice(retained, func(i, j int) bool { return retained[i].Category < retained[j].Category })

	return Okay(DeletionPlan{
		UserID:      req.UserID,
		Deleted:     deleted,
		Retained:    retained,
		ConfirmedAt: now,
		CompleteBy:  now.Add(DeletionCompletionWindow),
	})
}

// DeletionCommit performs the erasure described by the plan as a single
// all-or-nothing transaction. It must delete exactly the plan's Deleted
// categories and preserve the Retained ones. A non-nil error means nothing was
// deleted (the underlying transaction rolled back).
type DeletionCommit func(DeletionPlan) error

// ExecuteDeletion commits a deletion plan atomically.
//
//   - On commit success it returns the DeletionResult reporting the deleted
//     categories and the retained categories with their retention basis
//     (Req 20.5, 20.6).
//   - On commit failure it returns an atomic-failure contract: no partial
//     deletion occurred and the account is preserved in its pre-deletion state
//     (Req 20.7). The failure is retryable.
//
// Requirements: 20.5, 20.6, 20.7
func ExecuteDeletion(plan DeletionPlan, commit DeletionCommit) Result[DeletionResult] {
	if commit != nil {
		if err := commit(plan); err != nil {
			// Req 20.7 — preserve pre-deletion state; no partial deletion.
			return Fail[DeletionResult](AtomicFailure(
				"deletion_failed",
				fmt.Sprintf("account deletion could not be completed: %v", err),
				true,
			))
		}
	}
	return Okay(DeletionResult{
		UserID:      plan.UserID,
		Deleted:     plan.Deleted,
		Retained:    plan.Retained,
		ConfirmedAt: plan.ConfirmedAt,
		CompleteBy:  plan.CompleteBy,
	})
}

// DeletionOverdue reports whether a confirmed deletion has passed its 30-day
// completion deadline without completing. When true, the caller must preserve
// the account in its pre-deletion state and notify the user (Req 20.7).
//
// Requirements: 20.7
func DeletionOverdue(plan DeletionPlan, completed bool, now time.Time) bool {
	return !completed && now.After(plan.CompleteBy)
}

// OverdueDeletionNotice builds the outcome for a deletion that did not complete
// within 30 days: the pre-deletion state is retained and the user is notified.
// The contract carries RetainedState=true (account preserved) and is retryable.
//
// Requirements: 20.7
func OverdueDeletionNotice(userID string) ErrorContract {
	return ErrorContract{
		Code:          "deletion_not_completed",
		Message:       fmt.Sprintf("account deletion for %q did not complete within 30 days; account preserved in its pre-deletion state", userID),
		Retryable:     true,
		RetainedState: true,
	}
}

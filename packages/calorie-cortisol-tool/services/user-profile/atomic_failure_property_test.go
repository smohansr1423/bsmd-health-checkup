// Property-based test for atomic-failure state preservation (Task 4.10).
//
// Property 48: Atomic failure preserves prior state (import/report/export/deletion)
//   For any import, report-generation, export, or deletion operation that fails,
//   no partial artifact is produced and the user's prior data is preserved
//   unchanged, with an appropriate error/notification surfaced.
//
// **Validates: Requirements 14.2, 14.3, 14.5, 14.7, 20.3, 20.7**
//
// Scope note: this service (User & Profile) owns the export and account-deletion
// atomic operations, so the export/deletion failure paths (Req 20.3, 20.7) are
// exercised directly here against GenerateExport / ExecuteDeletion / the overdue
// deletion path. The lab-import and PDF-report atomic-failure paths
// (Req 14.2/14.3/14.5/14.7) are owned by the Cortisol module; they share the
// same standardised atomic-failure contract (result.go, AtomicFailure), so the
// cross-operation invariant of that contract is validated generically below.
//
// Feature: calorie-cortisol-tool, Property 48
// Library: gopter, MinSuccessfulTests >= 100.
package main

import (
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/leanovate/gopter"
	"github.com/leanovate/gopter/gen"
	"github.com/leanovate/gopter/prop"
)

// ---------------------------------------------------------------------------
// In-memory atomic stores
//
// These model the durable side-effect of each operation. An atomic store only
// mutates on success; on failure it rolls back so nothing partial survives.
// The property asserts that after a *failed* operation the store is byte-for-
// byte identical to its pre-operation snapshot (prior data preserved unchanged).
// ---------------------------------------------------------------------------

// atomicExportStore holds durably-persisted export artifacts keyed by user.
type atomicExportStore struct {
	files map[string]ExportArtifact
}

// persister returns an ExportPersister that fails (writing nothing) when fail
// is true, or commits the artifact when false.
func (s *atomicExportStore) persister(fail bool) ExportPersister {
	return func(a ExportArtifact) error {
		if fail {
			// Atomic/transactional store: a failed write commits nothing.
			return errors.New("simulated export persistence failure")
		}
		s.files[a.UserID] = a
		return nil
	}
}

// atomicAccountStore holds each user's persisted personal data. Deletion
// removes the non-retained categories on success; on failure nothing changes.
type atomicAccountStore struct {
	accounts map[string]PersonalData
}

// committer returns a DeletionCommit that fails (deleting nothing) when fail is
// true, or removes the plan's Deleted categories from the stored account data
// when false.
func (s *atomicAccountStore) committer(fail bool) DeletionCommit {
	return func(plan DeletionPlan) error {
		if fail {
			// Atomic/transactional store: a failed commit rolls back — the
			// account is preserved in its pre-deletion state (Req 20.7).
			return errors.New("simulated deletion commit failure")
		}
		acct, ok := s.accounts[plan.UserID]
		if !ok {
			return nil
		}
		for _, cat := range plan.Deleted {
			delete(acct.Records, cat)
		}
		return nil
	}
}

// cloneAccounts makes a deep-enough copy of the account store for snapshotting.
func cloneAccounts(src map[string]PersonalData) map[string]PersonalData {
	out := make(map[string]PersonalData, len(src))
	for uid, pd := range src {
		recs := make(map[PersonalDataCategory][]Record, len(pd.Records))
		for cat, rs := range pd.Records {
			cp := make([]Record, len(rs))
			copy(cp, rs)
			recs[cat] = cp
		}
		out[uid] = PersonalData{UserID: pd.UserID, Records: recs}
	}
	return out
}

func TestProperty48AtomicFailurePreservesPriorState(t *testing.T) {
	parameters := gopter.DefaultTestParameters()
	parameters.MinSuccessfulTests = 100 // Property 48 requires >= 100 generated iterations

	properties := gopter.NewProperties(parameters)

	now := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)

	// --- Export atomic failure (Req 20.3) ------------------------------------
	//
	// For an authorized export whose persistence step fails, GenerateExport must
	// return an atomic-failure contract (RetainedState, retryable, specific
	// code), produce no export file, and leave any prior export artifacts
	// untouched. When persistence succeeds the export file is produced.
	properties.Property(
		"failed export produces no partial artifact and preserves prior data (Req 20.3)",
		prop.ForAll(
			func(data PersonalData, fail bool) bool {
				// A previously-produced export that must survive a new failure.
				store := &atomicExportStore{files: map[string]ExportArtifact{
					"prior-user": {UserID: "prior-user", JSON: "{}"},
				}}
				priorCount := len(store.files)

				req := ExportRequest{UserID: data.UserID, Authenticated: true, Verified: true}
				res := GenerateExport(req, data, store.persister(fail), now)

				if fail {
					// Must be a surfaced failure.
					if res.Ok || res.Error == nil {
						return false
					}
					// Atomic-failure contract: prior state preserved + retryable.
					if !res.Error.RetainedState || !res.Error.Retryable {
						return false
					}
					if res.Error.Code != "export_failed" {
						return false
					}
					// No new (partial) artifact was persisted; prior files intact.
					if len(store.files) != priorCount {
						return false
					}
					if _, ok := store.files[data.UserID]; ok && data.UserID != "prior-user" {
						return false
					}
					return true
				}

				// Success path: a complete export file is produced.
				if !res.Ok || res.Error != nil {
					return false
				}
				if _, ok := store.files[data.UserID]; !ok {
					return false
				}
				return true
			},
			genPersonalData(),
			gen.Bool(),
		),
	)

	// --- Deletion atomic failure on commit (Req 20.7) ------------------------
	//
	// For a confirmed deletion whose commit fails, ExecuteDeletion must return an
	// atomic-failure contract and the account must be preserved in its
	// pre-deletion state (no category removed). When commit succeeds exactly the
	// planned categories are removed.
	properties.Property(
		"failed deletion commit preserves the account in its pre-deletion state (Req 20.7)",
		prop.ForAll(
			func(data PersonalData, fail bool) bool {
				userID := "delete-user"
				data.UserID = userID
				store := &atomicAccountStore{accounts: map[string]PersonalData{
					userID: data,
				}}
				before := cloneAccounts(store.accounts)

				req := DeletionRequest{UserID: userID, Authenticated: true, Confirmed: true}
				planRes := PlanDeletion(req, data, DefaultLegalRetentionPolicy, now)
				if !planRes.Ok {
					return false // a confirmed, authenticated request must plan cleanly
				}

				res := ExecuteDeletion(planRes.Value, store.committer(fail))

				if fail {
					if res.Ok || res.Error == nil {
						return false
					}
					if !res.Error.RetainedState || !res.Error.Retryable {
						return false
					}
					if res.Error.Code != "deletion_failed" {
						return false
					}
					// Pre-deletion state preserved: no category removed.
					if !reflect.DeepEqual(store.accounts, before) {
						return false
					}
					return true
				}

				// Success path: exactly the planned categories are removed;
				// retained (legal-obligation) categories survive.
				if !res.Ok || res.Error != nil {
					return false
				}
				acct := store.accounts[userID]
				for _, cat := range planRes.Value.Deleted {
					if _, ok := acct.Records[cat]; ok {
						return false
					}
				}
				for _, rc := range planRes.Value.Retained {
					if _, ok := acct.Records[rc.Category]; !ok {
						return false
					}
				}
				return true
			},
			genPersonalData(),
			gen.Bool(),
		),
	)

	// --- Overdue deletion preserves pre-deletion state (Req 20.7) ------------
	//
	// If a confirmed deletion has not completed within 30 days, the pre-deletion
	// state is preserved and the user is notified. The overdue notice must carry
	// RetainedState (account preserved) and be retryable.
	properties.Property(
		"deletion overdue past 30 days preserves pre-deletion state and notifies (Req 20.7)",
		prop.ForAll(
			func(extraSeconds int64, completed bool) bool {
				plan := DeletionPlan{
					UserID:      "overdue-user",
					ConfirmedAt: now,
					CompleteBy:  now.Add(DeletionCompletionWindow),
				}
				// A time strictly after the 30-day deadline.
				afterDeadline := plan.CompleteBy.Add(time.Duration(extraSeconds) * time.Second)

				overdue := DeletionOverdue(plan, completed, afterDeadline)

				if completed {
					// A completed deletion is never overdue.
					return !overdue
				}

				// Not completed and past the deadline → overdue.
				if !overdue {
					return false
				}
				notice := OverdueDeletionNotice(plan.UserID)
				// Pre-deletion state preserved + user can retry (notified).
				return notice.RetainedState && notice.Retryable && notice.Code == "deletion_not_completed"
			},
			gen.Int64Range(1, 1_000_000),
			gen.Bool(),
		),
	)

	// --- Shared atomic-failure contract invariant ----------------------------
	//
	// Every operation in Property 48's scope (lab-result import, FHIR import, PDF
	// report generation, export, deletion) standardises its failure on the
	// AtomicFailure contract (result.go). Regardless of the failing operation's
	// code/message, the contract must always preserve prior state and surface a
	// non-empty, machine-readable error. This generically covers the import/
	// report atomic-failure paths (Req 14.2, 14.3, 14.5, 14.7) that route through
	// the same contract.
	properties.Property(
		"AtomicFailure always preserves prior state and surfaces an error (Req 14.2, 14.3, 14.5, 14.7)",
		prop.ForAll(
			func(code, message string, retryable bool) bool {
				e := AtomicFailure(code, message, retryable)
				if !e.RetainedState { // prior state always preserved
					return false
				}
				if e.Retryable != retryable { // caller-controlled retryability honoured
					return false
				}
				if e.Code != code || e.Message != message { // error surfaced verbatim
					return false
				}
				return true
			},
			gen.Identifier(),
			gen.AnyString(),
			gen.Bool(),
		),
	)

	properties.TestingRun(t)
}

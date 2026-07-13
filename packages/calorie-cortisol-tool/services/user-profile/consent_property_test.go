// Property-based test for the master consent gate on egress and persistence
// (Task 4.5).
//
// Property 44: Master consent gate on egress and persistence
//
//	For any health-data category, the data is transmitted off-device or
//	persisted to the cloud only if an explicit opt-in consent for that category
//	is recorded; disabling a consent stops further egress for that category and
//	retains the local copy, and attempts without consent are blocked with a
//	consent-required indication.
//
// **Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.6, 30.4, 30.5**
//
// Feature: calorie-cortisol-tool, Property 44
// Library: gopter, MinSuccessfulTests >= 100.
package main

import (
	"testing"
	"time"

	"github.com/leanovate/gopter"
	"github.com/leanovate/gopter/gen"
	"github.com/leanovate/gopter/prop"
)

// healthDataCategories is the closed set of category names the generators draw
// from. Using a small fixed alphabet keeps the state space meaningful (the same
// category is toggled repeatedly) while still exercising the map-merge logic.
var healthDataCategories = []string{
	"cortisol",
	"nutrition",
	"wearable",
	"questionnaire",
	"sleep",
}

// consentOp is a single generated PUT /consent mutation: either toggling one
// category's opt-in or setting the master health-data consent.
type consentOp struct {
	// isMaster selects between a master-consent set and a category toggle.
	isMaster bool
	// value is the opt-in / master-consent value being written.
	value bool
	// category is the target category when isMaster is false.
	category string
}

// genConsentOp generates one consent mutation.
func genConsentOp() gopter.Gen {
	return gopter.CombineGens(
		gen.Bool(),
		gen.Bool(),
		gen.OneConstOf(anySlice(healthDataCategories)...),
	).Map(func(vals []interface{}) consentOp {
		return consentOp{
			isMaster: vals[0].(bool),
			value:    vals[1].(bool),
			category: vals[2].(string),
		}
	})
}

// anySlice converts a []string to []interface{} for gen.OneConstOf.
func anySlice(ss []string) []interface{} {
	out := make([]interface{}, len(ss))
	for i, s := range ss {
		out[i] = s
	}
	return out
}

// applyOps folds a sequence of generated mutations into a stored consent state
// via ApplyConsentUpdate — the real PUT /consent core — so the property tests
// the same code path production uses. It returns the final persisted state.
func applyOps(store ConsentStore, userID string, ops []consentOp) ConsentState {
	last := newConsentState(userID)
	for _, op := range ops {
		req := ConsentUpdateRequest{UserID: userID}
		if op.isMaster {
			v := op.value
			req.HealthDataConsent = &v
		} else {
			req.Categories = map[string]bool{op.category: op.value}
		}
		res := ApplyConsentUpdate(store, req, time.Now())
		if res.Ok {
			last = res.Value
		}
	}
	return last
}

func TestProperty44MasterConsentGate(t *testing.T) {
	parameters := gopter.DefaultTestParameters()
	parameters.MinSuccessfulTests = 100 // Property 44 requires >= 100 generated iterations

	properties := gopter.NewProperties(parameters)

	// Core gate property: for every category, egress is permitted iff an explicit
	// opt-in is currently recorded (Req 17.1, 17.2); otherwise egress is blocked
	// with a consent-required indication and the local copy is retained
	// (Req 17.4, 17.6). Master health-data submission mirrors the master consent
	// flag (Req 30.4, 30.5). Because state is read fresh, the most recent
	// enable/disable wins for every subsequent attempt (Req 17.3).
	properties.Property(
		"egress and submission are gated exactly by recorded consent",
		prop.ForAll(
			func(ops []consentOp) bool {
				store := NewInMemoryConsentStore()
				const userID = "prop-user"
				state := applyOps(store, userID, ops)

				// Every category in the fixed alphabet must obey the gate,
				// including ones never touched (default-denied).
				for _, category := range healthDataCategories {
					enabled := state.IsCategoryEnabled(category)
					decision := CheckCategoryEgress(state, category)
					if enabled {
						// Opt-in recorded -> egress must be allowed.
						if !decision.Ok || decision.Error != nil {
							return false
						}
						if decision.Value.Category != category {
							return false
						}
					} else {
						// No opt-in -> blocked with consent-required, local copy
						// retained, and non-retryable (same attempt keeps failing
						// until consent is recorded).
						if decision.Ok || decision.Error == nil {
							return false
						}
						if decision.Error.Code != ConsentRequiredCode {
							return false
						}
						if !decision.Error.RetainedState || decision.Error.Retryable {
							return false
						}
					}
				}

				// Master health-data submission gate mirrors HealthDataConsent.
				submission := CheckHealthDataSubmission(state)
				if state.HealthDataConsent {
					if !submission.Ok || submission.Error != nil {
						return false
					}
				} else {
					if submission.Ok || submission.Error == nil {
						return false
					}
					if submission.Error.Code != ConsentRequiredCode {
						return false
					}
					if !submission.Error.RetainedState {
						return false
					}
				}
				return true
			},
			gen.SliceOf(genConsentOp()),
		),
	)

	// Disable-after-enable property: once a category has been enabled (egress
	// allowed), disabling it stops further egress while the stored/local state is
	// retained (Req 17.4). This exercises the temporal "disable stops egress"
	// clause directly rather than only the final-state view.
	properties.Property(
		"disabling a previously enabled category stops egress and retains state",
		prop.ForAll(
			func(category string) bool {
				store := NewInMemoryConsentStore()
				const userID = "toggle-user"

				// Enable -> egress allowed.
				enable := ApplyConsentUpdate(store, ConsentUpdateRequest{
					UserID:     userID,
					Categories: map[string]bool{category: true},
				}, time.Now())
				if !enable.Ok {
					return false
				}
				if allowed := CheckCategoryEgress(enable.Value, category); !allowed.Ok {
					return false
				}

				// Disable -> egress blocked with consent-required, local retained.
				disable := ApplyConsentUpdate(store, ConsentUpdateRequest{
					UserID:     userID,
					Categories: map[string]bool{category: false},
				}, time.Now())
				if !disable.Ok {
					return false
				}
				blocked := CheckCategoryEgress(disable.Value, category)
				if blocked.Ok || blocked.Error == nil {
					return false
				}
				return blocked.Error.Code == ConsentRequiredCode &&
					blocked.Error.RetainedState &&
					!blocked.Error.Retryable
			},
			gen.OneConstOf(anySlice(healthDataCategories)...),
		),
	)

	properties.TestingRun(t)
}

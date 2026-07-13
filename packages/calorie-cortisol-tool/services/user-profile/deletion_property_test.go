// Property-based test for account-deletion completeness with a
// legal-retention carve-out (Task 4.11).
//
// Property 49: Deletion completeness with legal-retention carve-out
//   For any confirmed account deletion, all personal data is deleted except
//   categories under a legal retention obligation, which are restricted to the
//   retention purpose and reported with their basis.
//
// **Validates: Requirements 20.5, 20.6**
//
// Feature: calorie-cortisol-tool, Property 49
// Library: gopter, MinSuccessfulTests >= 100.
package main

import (
	"reflect"
	"testing"
	"time"

	"github.com/leanovate/gopter"
	"github.com/leanovate/gopter/gen"
	"github.com/leanovate/gopter/prop"
)

// deletionCategories is the closed alphabet of personal-data categories the
// generators draw from. Using the real constants keeps generated input shaped
// like production data while covering every category deletion may touch.
var deletionCategories = []PersonalDataCategory{
	CategoryProfile,
	CategoryConsent,
	CategoryFamily,
	CategoryBilling,
	CategoryMeals,
	CategoryCortisol,
	CategoryAudit,
}

func deletionCategorySlice() []interface{} {
	out := make([]interface{}, len(deletionCategories))
	for i, c := range deletionCategories {
		out[i] = c
	}
	return out
}

// genDeletionRecord generates a single serialisable personal-data record.
func genDeletionRecord() gopter.Gen {
	return gopter.CombineGens(
		gen.AlphaString(),
		gen.IntRange(0, 1_000_000),
	).Map(func(vals []interface{}) Record {
		return Record{
			"label": vals[0].(string),
			"value": vals[1].(int),
		}
	})
}

// deletionEntry is a generated (category, records) pair.
type deletionEntry struct {
	category PersonalDataCategory
	records  []Record
}

func genDeletionEntry() gopter.Gen {
	return gopter.CombineGens(
		gen.OneConstOf(deletionCategorySlice()...),
		gen.SliceOf(genDeletionRecord(), reflect.TypeOf(Record{})),
	).Map(func(vals []interface{}) deletionEntry {
		return deletionEntry{
			category: vals[0].(PersonalDataCategory),
			records:  vals[1].([]Record),
		}
	})
}

// genDeletionPersonalData generates a user's personal data as a random subset
// of categories (duplicates collapse, so the empty set and all subsets occur).
func genDeletionPersonalData() gopter.Gen {
	return gen.SliceOf(genDeletionEntry(), reflect.TypeOf(deletionEntry{})).Map(
		func(entries []deletionEntry) PersonalData {
			recs := make(map[PersonalDataCategory][]Record, len(entries))
			for _, e := range entries {
				recs[e.category] = e.records
			}
			return PersonalData{UserID: "prop-user", Records: recs}
		},
	)
}

// genRetentionPolicy generates a random legal-retention carve-out: a random
// subset of categories flagged for retention, each with a non-empty basis and
// purpose. This exercises the carve-out generically rather than only for the
// default (billing/audit) policy.
func genRetentionPolicy() gopter.Gen {
	// Generate one bool per category deciding whether it is retained.
	gens := make([]gopter.Gen, len(deletionCategories))
	for i := range deletionCategories {
		gens[i] = gen.Bool()
	}
	return gopter.CombineGens(gens...).Map(func(vals []interface{}) LegalRetentionPolicy {
		policy := LegalRetentionPolicy{}
		for i, cat := range deletionCategories {
			if vals[i].(bool) {
				policy[cat] = RetainedCategory{
					Category: cat,
					Basis:    "legal_obligation:" + string(cat) + "_retention",
					Purpose:  "compliance:" + string(cat),
				}
			}
		}
		return policy
	})
}

func TestProperty49DeletionCompletenessWithRetentionCarveOut(t *testing.T) {
	parameters := gopter.DefaultTestParameters()
	parameters.MinSuccessfulTests = 100 // Property 49 requires >= 100 generated iterations

	properties := gopter.NewProperties(parameters)

	// For any confirmed, authenticated deletion:
	//   - every present category is partitioned into exactly one of deleted /
	//     retained (completeness — nothing is dropped or double-counted);
	//   - a category is retained iff it is covered by the legal-retention policy,
	//     and each retained category reports a non-empty basis and purpose
	//     (Req 20.6);
	//   - every other present category is deleted (Req 20.5);
	//   - a successful commit reports exactly the same deleted/retained sets.
	properties.Property(
		"confirmed deletion removes all data except legally-retained categories, which are reported with basis",
		prop.ForAll(
			func(data PersonalData, policy LegalRetentionPolicy) bool {
				now := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)
				req := DeletionRequest{
					UserID:        data.UserID,
					Authenticated: true,
					Confirmed:     true,
				}

				res := PlanDeletion(req, data, policy, now)
				if !res.Ok || res.Error != nil {
					return false
				}
				plan := res.Value

				deleted := map[PersonalDataCategory]bool{}
				for _, c := range plan.Deleted {
					if deleted[c] {
						return false // no duplicates in the deleted set
					}
					deleted[c] = true
				}
				retained := map[PersonalDataCategory]RetainedCategory{}
				for _, r := range plan.Retained {
					if _, dup := retained[r.Category]; dup {
						return false // no duplicates in the retained set
					}
					retained[r.Category] = r
				}

				// Deleted and retained are disjoint.
				for c := range deleted {
					if _, ok := retained[c]; ok {
						return false
					}
				}

				// Completeness: deleted ∪ retained == exactly the present set.
				present := map[PersonalDataCategory]bool{}
				for c := range data.Records {
					present[c] = true
				}
				if len(deleted)+len(retained) != len(present) {
					return false
				}
				for c := range present {
					_, isRetained := retained[c]
					if !deleted[c] && !isRetained {
						return false // a present category was neither deleted nor retained
					}
				}

				// Classification correctness against the policy, plus reporting.
				for c := range present {
					policyEntry, underPolicy := policy[c]
					if underPolicy {
						// Req 20.6 — must be retained, not deleted, with basis + purpose.
						rc, ok := retained[c]
						if !ok || deleted[c] {
							return false
						}
						if rc.Category != c {
							return false
						}
						if rc.Basis == "" || rc.Purpose == "" {
							return false
						}
						// Reported basis/purpose come from the policy.
						if rc.Basis != policyEntry.Basis || rc.Purpose != policyEntry.Purpose {
							return false
						}
					} else {
						// Req 20.5 — not under retention → must be deleted.
						if !deleted[c] {
							return false
						}
						if _, ok := retained[c]; ok {
							return false
						}
					}
				}

				// A retained category must always be one present in the data.
				for c := range retained {
					if !present[c] {
						return false
					}
				}

				// Req 20.5 — a successful commit reports exactly the planned sets.
				commitRes := ExecuteDeletion(plan, func(DeletionPlan) error { return nil })
				if !commitRes.Ok || commitRes.Error != nil {
					return false
				}
				out := commitRes.Value
				if len(out.Deleted) != len(plan.Deleted) || len(out.Retained) != len(plan.Retained) {
					return false
				}
				for i, c := range plan.Deleted {
					if out.Deleted[i] != c {
						return false
					}
				}
				for i, r := range plan.Retained {
					if out.Retained[i] != r {
						return false
					}
				}
				return true
			},
			genDeletionPersonalData(),
			genRetentionPolicy(),
		),
	)

	properties.TestingRun(t)
}

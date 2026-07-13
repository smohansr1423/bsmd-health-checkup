// Property-based test for data-export authorization and completeness (Task 4.9).
//
// Property 47: Export authorization and completeness
//   For any export request, it succeeds only for an authenticated/verified user
//   and, when it succeeds, contains all of the user's personal data in both JSON
//   and CSV; unauthenticated (or unverified) requests are rejected with no file
//   produced.
//
// **Validates: Requirements 20.1, 20.2**
//
// Feature: calorie-cortisol-tool, Property 47
// Library: gopter, MinSuccessfulTests >= 100.
package main

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/leanovate/gopter"
	"github.com/leanovate/gopter/gen"
	"github.com/leanovate/gopter/prop"
)

// exportCategories is the closed set of personal-data categories the generators
// draw from. Using the real category constants keeps the generated data shaped
// like production input while covering every category the export may hold.
var exportCategories = []PersonalDataCategory{
	CategoryProfile,
	CategoryConsent,
	CategoryFamily,
	CategoryBilling,
	CategoryMeals,
	CategoryCortisol,
	CategoryAudit,
}

// anyCategorySlice converts the category constants to []interface{} for
// gen.OneConstOf.
func anyCategorySlice() []interface{} {
	out := make([]interface{}, len(exportCategories))
	for i, c := range exportCategories {
		out[i] = c
	}
	return out
}

// genRecord generates one personal-data record with a small set of
// JSON/CSV-serialisable scalar fields. Property 47 covers only authorization and
// completeness (Req 20.1, 20.2), so generated records are always serialisable —
// the atomic-failure-on-serialisation path (Req 20.3) is exercised elsewhere.
func genRecord() gopter.Gen {
	return gopter.CombineGens(
		gen.AlphaString(),
		gen.IntRange(0, 1_000_000),
		gen.Bool(),
	).Map(func(vals []interface{}) Record {
		return Record{
			"label":  vals[0].(string),
			"amount": vals[1].(int),
			"flag":   vals[2].(bool),
		}
	})
}

// exportEntry is a generated (category, records) pair used to assemble a
// PersonalData value with a random subset of categories.
type exportEntry struct {
	category PersonalDataCategory
	records  []Record
}

// genExportEntry generates one category populated with a random slice of
// records (possibly empty).
func genExportEntry() gopter.Gen {
	return gopter.CombineGens(
		gen.OneConstOf(anyCategorySlice()...),
		gen.SliceOf(genRecord(), reflect.TypeOf(Record{})),
	).Map(func(vals []interface{}) exportEntry {
		return exportEntry{
			category: vals[0].(PersonalDataCategory),
			records:  vals[1].([]Record),
		}
	})
}

// genPersonalData generates a user's complete personal data as a random subset
// of categories (duplicate categories collapse, so the result is a genuine
// subset of the fixed alphabet, including the empty set).
func genPersonalData() gopter.Gen {
	return gen.SliceOf(genExportEntry(), reflect.TypeOf(exportEntry{})).Map(
		func(entries []exportEntry) PersonalData {
			recs := make(map[PersonalDataCategory][]Record, len(entries))
			for _, e := range entries {
				recs[e.category] = e.records
			}
			return PersonalData{UserID: "prop-user", Records: recs}
		},
	)
}

func TestProperty47ExportAuthorizationAndCompleteness(t *testing.T) {
	parameters := gopter.DefaultTestParameters()
	parameters.MinSuccessfulTests = 100 // Property 47 requires >= 100 generated iterations

	properties := gopter.NewProperties(parameters)

	// The export succeeds if and only if the request is BOTH authenticated and
	// identity-verified (Req 20.2). On success the artifact contains all of the
	// user's personal data in both JSON and CSV and is available within 24 hours
	// (Req 20.1). On rejection no export file is produced and the response
	// indicates identity verification is required (Req 20.2).
	properties.Property(
		"export is authorized iff authenticated+verified and is complete in both formats",
		prop.ForAll(
			func(data PersonalData, authenticated, verified bool) bool {
				req := ExportRequest{
					UserID:        data.UserID,
					Authenticated: authenticated,
					Verified:      verified,
				}
				now := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)

				// Track whether an export file was ever produced (persisted).
				fileProduced := false
				persist := func(ExportArtifact) error { fileProduced = true; return nil }

				res := GenerateExport(req, data, persist, now)

				if authenticated && verified {
					// Req 20.2 — authorized request must succeed.
					if !res.Ok || res.Error != nil {
						return false
					}
					art := res.Value

					// Req 20.1 — all personal data present in BOTH JSON and CSV.
					if !art.CoversAllCategories(data) {
						return false
					}
					// An export file is actually produced for an authorized user.
					if !fileProduced {
						return false
					}
					// Req 20.1 — available within 24 hours of the request.
					if art.AvailableBy.Sub(now) != ExportAvailabilityWindow {
						return false
					}

					// The JSON document parses and holds every category, and each
					// category also has a CSV rendering (completeness, both formats).
					var doc exportDocument
					if err := json.Unmarshal([]byte(art.JSON), &doc); err != nil {
						return false
					}
					if len(doc.Data) != len(data.Records) {
						return false
					}
					for cat := range data.Records {
						if _, ok := doc.Data[string(cat)]; !ok {
							return false
						}
						if _, ok := art.CSV[cat]; !ok {
							return false
						}
					}
					return true
				}

				// Req 20.2 — unauthenticated OR unverified request is rejected.
				if res.Ok || res.Error == nil {
					return false
				}
				if res.Error.Code != "identity_verification_required" {
					return false
				}
				// No export file is produced, and prior data is retained.
				if fileProduced {
					return false
				}
				return res.Error.RetainedState
			},
			genPersonalData(),
			gen.Bool(),
			gen.Bool(),
		),
	)

	properties.TestingRun(t)
}

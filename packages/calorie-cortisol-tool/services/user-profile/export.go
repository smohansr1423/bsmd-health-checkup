// Data export and account deletion — shared account-data types + `POST /export`
// (Task 4.8).
//
// This file implements GDPR Article 20 data portability: an authenticated,
// identity-verified user can request an export of ALL of their personal data in
// both JSON and CSV formats, made available within 24 hours of the request
// (Req 20.1). Unauthenticated/unverified requests are rejected with no file
// produced (Req 20.2). Export generation is an atomic operation: on failure no
// partial artifact is produced and the user's data is preserved unchanged
// (Req 20.3) — this reuses the shared Go error/result contract's atomic-failure
// pattern (see result.go).
//
// Account deletion (GDPR Article 17) lives in deletion.go and shares the
// account-data types defined here.
//
// Requirements: 20.1, 20.2, 20.3
package main

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"sort"
	"time"
)

// ---------------------------------------------------------------------------
// Shared account-data types (used by both export and deletion)
// ---------------------------------------------------------------------------

// PersonalDataCategory identifies one category of a user's personal data. The
// User & Profile service owns the account-scoped categories in PostgreSQL
// (profile, consent, family, billing, audit); meal/cortisol categories are
// gathered from the owning services to satisfy the "all personal data"
// requirement (Req 20.1).
type PersonalDataCategory string

const (
	CategoryProfile  PersonalDataCategory = "profile"
	CategoryConsent  PersonalDataCategory = "consent"
	CategoryFamily   PersonalDataCategory = "family"
	CategoryBilling  PersonalDataCategory = "billing"
	CategoryMeals    PersonalDataCategory = "meals"
	CategoryCortisol PersonalDataCategory = "cortisol"
	CategoryAudit    PersonalDataCategory = "audit"
)

// Record is a single row of personal data as a set of named fields. Using a
// field map keeps the export/deletion layer decoupled from each category's
// concrete schema while remaining fully serialisable to JSON and CSV.
type Record map[string]any

// PersonalData is the complete set of a user's personal data, grouped by
// category. It is the input to both export generation and deletion planning.
type PersonalData struct {
	UserID  string
	Records map[PersonalDataCategory][]Record
}

// Categories returns the personal-data categories present, in a stable
// (sorted) order.
func (p PersonalData) Categories() []PersonalDataCategory {
	cats := make([]PersonalDataCategory, 0, len(p.Records))
	for c := range p.Records {
		cats = append(cats, c)
	}
	sort.Slice(cats, func(i, j int) bool { return cats[i] < cats[j] })
	return cats
}

// ---------------------------------------------------------------------------
// Export request / artifact
// ---------------------------------------------------------------------------

// ExportRequest is a request for a personal-data export. Authenticated and
// Verified together model the identity check required by Req 20.2 (only an
// authenticated AND identity-verified user may export).
type ExportRequest struct {
	UserID        string
	Authenticated bool
	Verified      bool
}

// ExportArtifact is the generated export bundle: a single JSON document holding
// all personal data plus a per-category CSV rendering (Req 20.1). It is only
// ever returned on full success — a partial artifact is never produced
// (Req 20.3).
type ExportArtifact struct {
	UserID string
	// JSON is the complete personal-data document (all categories).
	JSON string
	// CSV maps each category to its CSV rendering.
	CSV map[PersonalDataCategory]string
	// GeneratedAt is when the artifact was produced.
	GeneratedAt time.Time
	// AvailableBy is the 24-hour availability deadline (Req 20.1).
	AvailableBy time.Time
}

// CoversAllCategories reports whether the artifact contains every category
// present in the source data in BOTH formats. This is the completeness
// guarantee behind Property 47.
func (a ExportArtifact) CoversAllCategories(data PersonalData) bool {
	// CSV: one rendering per category.
	if len(a.CSV) != len(data.Records) {
		return false
	}
	for cat := range data.Records {
		if _, ok := a.CSV[cat]; !ok {
			return false
		}
	}
	// JSON: decode and confirm every category key is present.
	var shape exportDocument
	if err := json.Unmarshal([]byte(a.JSON), &shape); err != nil {
		return false
	}
	if len(shape.Data) != len(data.Records) {
		return false
	}
	for cat := range data.Records {
		if _, ok := shape.Data[string(cat)]; !ok {
			return false
		}
	}
	return true
}

// exportDocument is the on-disk shape of the JSON export.
type exportDocument struct {
	UserID      string              `json:"userId"`
	GeneratedAt string              `json:"generatedAt"`
	Format      string              `json:"format"`
	Data        map[string][]Record `json:"data"`
}

// ExportAvailabilityWindow is the maximum time an export may take to become
// available to the user (Req 20.1).
const ExportAvailabilityWindow = 24 * time.Hour

// ---------------------------------------------------------------------------
// Export generation
// ---------------------------------------------------------------------------

// ExportPersister durably stores a fully-generated export artifact. It is
// invoked only after the complete artifact has been built in memory, so a
// failure here still yields no partial artifact (the caller discards the
// in-memory value and reports an atomic failure).
type ExportPersister func(ExportArtifact) error

// GenerateExport produces a JSON+CSV export of all of the user's personal data.
//
//   - Unauthenticated or unverified requests are rejected before any artifact
//     is built; no file is produced (Req 20.2, validation-rejection pattern).
//   - The artifact is assembled fully in memory, then handed to persist. If
//     assembly or persistence fails, no partial artifact is produced and the
//     user's data is untouched; an atomic-failure contract is returned
//     (Req 20.3).
//   - On success the artifact carries a 24-hour availability deadline
//     (Req 20.1).
//
// persist may be nil, in which case the artifact is returned without an
// external persistence step (assembly is still atomic).
//
// Requirements: 20.1, 20.2, 20.3
func GenerateExport(req ExportRequest, data PersonalData, persist ExportPersister, now time.Time) Result[ExportArtifact] {
	// Req 20.2 — identity gate. Reject and retain no export file.
	if !req.Authenticated || !req.Verified {
		return Fail[ExportArtifact](ValidationRejection(
			"identity_verification_required",
			"data export requires an authenticated, identity-verified user",
		))
	}

	// Build the complete artifact in memory (all-or-nothing).
	artifact, err := buildExportArtifact(data, now)
	if err != nil {
		// Req 20.3 — no partial artifact; prior data preserved; retryable.
		return Fail[ExportArtifact](AtomicFailure(
			"export_failed",
			fmt.Sprintf("export generation failed: %v", err),
			true,
		))
	}

	// Persist the complete artifact. A failure here means the durable export
	// file was not produced; we discard the in-memory value so nothing partial
	// survives (Req 20.3).
	if persist != nil {
		if err := persist(artifact); err != nil {
			return Fail[ExportArtifact](AtomicFailure(
				"export_failed",
				fmt.Sprintf("export could not be completed: %v", err),
				true,
			))
		}
	}

	return Okay(artifact)
}

// buildExportArtifact assembles the JSON document and per-category CSVs. Any
// serialisation error aborts the whole build (no partial artifact).
func buildExportArtifact(data PersonalData, now time.Time) (ExportArtifact, error) {
	records := data.Records
	if records == nil {
		records = map[PersonalDataCategory][]Record{}
	}

	doc := exportDocument{
		UserID:      data.UserID,
		GeneratedAt: now.UTC().Format(time.RFC3339),
		Format:      "json+csv",
		Data:        make(map[string][]Record, len(records)),
	}
	for cat, recs := range records {
		doc.Data[string(cat)] = recs
	}

	jsonBytes, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return ExportArtifact{}, fmt.Errorf("marshal json: %w", err)
	}

	csvByCat := make(map[PersonalDataCategory]string, len(records))
	for cat, recs := range records {
		csvStr, err := recordsToCSV(recs)
		if err != nil {
			return ExportArtifact{}, fmt.Errorf("render csv for %q: %w", cat, err)
		}
		csvByCat[cat] = csvStr
	}

	return ExportArtifact{
		UserID:      data.UserID,
		JSON:        string(jsonBytes),
		CSV:         csvByCat,
		GeneratedAt: now,
		AvailableBy: now.Add(ExportAvailabilityWindow),
	}, nil
}

// recordsToCSV renders a slice of records as CSV. The header is the sorted
// union of all field names across the records so every value is represented;
// complex values are JSON-encoded into their cell.
func recordsToCSV(records []Record) (string, error) {
	// Union of column names, sorted for deterministic output.
	colSet := map[string]struct{}{}
	for _, r := range records {
		for k := range r {
			colSet[k] = struct{}{}
		}
	}
	cols := make([]string, 0, len(colSet))
	for c := range colSet {
		cols = append(cols, c)
	}
	sort.Strings(cols)

	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	if err := w.Write(cols); err != nil {
		return "", err
	}
	for _, r := range records {
		row := make([]string, len(cols))
		for i, c := range cols {
			v, ok := r[c]
			if !ok || v == nil {
				row[i] = ""
				continue
			}
			cell, err := cellString(v)
			if err != nil {
				return "", err
			}
			row[i] = cell
		}
		if err := w.Write(row); err != nil {
			return "", err
		}
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// cellString renders a single CSV cell value. Scalars are formatted directly;
// composite values are JSON-encoded.
func cellString(v any) (string, error) {
	switch t := v.(type) {
	case string:
		return t, nil
	case bool:
		return fmt.Sprintf("%t", t), nil
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return fmt.Sprintf("%d", t), nil
	case float32, float64:
		return fmt.Sprintf("%v", t), nil
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return "", err
		}
		return string(b), nil
	}
}

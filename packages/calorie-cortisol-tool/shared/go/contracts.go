package contracts

// REST webhook contracts — Go mirror of contracts/webhooks.ts. Shared
// payload/response shapes for the lab-results and FHIR webhooks. HMAC
// verification, structural validation, and persistence live in later tasks.

// LabResultPayloadFormat is a payload encoding accepted by the lab-results
// webhook (Req 8.4).
type LabResultPayloadFormat string

const (
	LabFormatHL7  LabResultPayloadFormat = "HL7"
	LabFormatJSON LabResultPayloadFormat = "JSON"
)

// LabResultsIngestStatus is an outcome state of a lab-results webhook (Req 8.4/8.8).
type LabResultsIngestStatus string

const (
	LabResultsAccepted LabResultsIngestStatus = "accepted"
	LabResultsPending  LabResultsIngestStatus = "results-pending"
	LabResultsRejected LabResultsIngestStatus = "rejected"
)

// FhirVersion is a FHIR resource version accepted by the FHIR webhook (Req 14.6).
type FhirVersion string

// FhirR4 is the supported FHIR version.
const FhirR4 FhirVersion = "R4"

// FhirIngestStatus is an outcome state of a FHIR import (Req 14.6/14.7).
type FhirIngestStatus string

const (
	FhirAccepted FhirIngestStatus = "accepted"
	FhirRejected FhirIngestStatus = "rejected"
)

// LabResultReading is a single normalized cortisol result carried in a lab
// webhook (Req 8.4/8.5).
type LabResultReading struct {
	SampleID        string          `json:"sampleId"`
	CollectedAt     string          `json:"collectedAt"`
	Value           float64         `json:"value"`
	Unit            string          `json:"unit"`
	TimeOfDayBucket TimeOfDayBucket `json:"timeOfDayBucket,omitempty"` // diurnal bucket (Req 8.3)
}

// LabResultsWebhookRequest is the POST /webhooks/lab-results request body (Req 8.4).
type LabResultsWebhookRequest struct {
	OrderID      string                 `json:"orderId"`
	LabPartnerID string                 `json:"labPartnerId"`
	Format       LabResultPayloadFormat `json:"format"`
	RawMessage   string                 `json:"rawMessage,omitempty"`
	Readings     []LabResultReading     `json:"readings,omitempty"`
}

// LabResultsWebhookResponse is the POST /webhooks/lab-results response envelope
// (Req 8.4/8.8).
type LabResultsWebhookResponse struct {
	Status        LabResultsIngestStatus `json:"status"`
	OrderID       string                 `json:"orderId"`
	AcceptedCount int                    `json:"acceptedCount"`
	RejectedCount int                    `json:"rejectedCount"`
	Reason        string                 `json:"reason,omitempty"`
}

// FhirWebhookRequest is the POST /webhooks/fhir request body — an Epic MyChart
// SMART-on-FHIR R4 bundle plus the linking order (Req 14.6).
type FhirWebhookRequest struct {
	Version FhirVersion            `json:"version"`
	OrderID string                 `json:"orderId"`
	Bundle  map[string]interface{} `json:"bundle"`
}

// FhirWebhookResponse is the POST /webhooks/fhir response envelope (Req 14.6/14.7).
type FhirWebhookResponse struct {
	Status        FhirIngestStatus `json:"status"`
	OrderID       string           `json:"orderId"`
	ImportedCount int              `json:"importedCount"`
	Reason        string           `json:"reason,omitempty"`
}

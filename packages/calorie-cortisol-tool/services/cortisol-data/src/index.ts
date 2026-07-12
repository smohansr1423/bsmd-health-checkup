/**
 * @calorie-cortisol/cortisol-data
 *
 * Scaffolding placeholder. Lab-kit ordering/QR linkage, lab-result ingestion,
 * wearable sync, questionnaire scoring, CAR/diurnal tracking, and trend queries
 * are implemented in later tasks.
 *
 * The persistence layer (TimescaleDB hypertables + read-replica routing) is
 * defined here: SQL migrations live under `migrations/`, and the connection /
 * routing configuration lives under `src/db/`.
 */
export const PACKAGE_NAME = '@calorie-cortisol/cortisol-data';

export * from './db/config';
export * from './db/replica-router';

// Lab-result ingestion webhook, diurnal windows, reference-range
// classification (Task 9.4 — Req 8.3, 8.4, 8.5, 8.8).
export * from './lab-ingestion';

// Questionnaire_Engine: PSS-10/GAD-7/PSQI scoring, tier mapping, framing,
// and re-prompt scheduling (Task 9.11, Req 10).
export * from './questionnaire';

// Lab_Integration: kit ordering + QR sample linkage (Req 8.1, 8.2, 8.6, 8.7).
export * from './lab';

// CAR window validation + diurnal deviation classification (task 9.15, Req 11).
export * from './car';

// Wearable/patch sync with per-reading validation (Task 9.7, Req 9.2–9.5, 9.8).
export * from './wearable-sync';

// Lab PDF OCR import + Epic MyChart FHIR R4 import + physician-ready report
// generation (Task 9.21, Req 14.1–14.7).
export * from './lab-import';

// Cortisol trend query: range filtering, reference bands, empty-state,
// life-event annotations, and single-metric overlay (Task 9.18, Req 12).
export * from './trend';

// CLIA lab-partner onboarding gate: enable ingestion iff a verified CLIA
// certification with a future expiry is on record (Task 9.22, Req 30.1, 30.2).
export * from './lab-partner-gating';

// End-to-end flow wiring (Task 18.2): composes kit order/link → lab webhook
// ingestion → wearable sync → questionnaire/CAR → TimescaleDB persistence →
// Notification events → dashboard/insights refresh (design Flow 2 & Flow 3).
export * from './e2e';

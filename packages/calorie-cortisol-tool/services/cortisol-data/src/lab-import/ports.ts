/**
 * Ports and domain types for lab-result import (`POST /lab-import` PDF OCR and
 * `GET /fhir/import` Epic MyChart FHIR R4) and physician-ready report
 * generation (Req 14.1–14.7).
 *
 * The core orchestration ({@link ./lab-import-service}) is pure: it validates
 * inputs, enforces the size/format/timeout rules, and applies atomic-failure
 * semantics (no partial artifact; prior results retained) using only these
 * injectable ports — an OCR engine, a FHIR client, a report renderer, an
 * imported-results store, plus an id generator and clock. This keeps every rule
 * deterministically unit-testable with in-memory doubles and no network,
 * filesystem, or wall-clock coupling.
 */

// ---------------------------------------------------------------------------
// Limits (Req 14.1, 14.4, 14.6)
// ---------------------------------------------------------------------------

/** Maximum accepted lab-result PDF size: 20 MB (Req 14.1, 14.2). */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;

/** OCR must complete within 30 seconds (Req 14.1, 14.3). */
export const OCR_TIMEOUT_MS = 30_000;

/** Epic MyChart FHIR R4 import must complete within 60 seconds (Req 14.4, 14.5). */
export const FHIR_TIMEOUT_MS = 60_000;

/** Physician-ready report must generate within 15 seconds (Req 14.6, 14.7). */
export const REPORT_TIMEOUT_MS = 15_000;

/** The MIME type accepted for lab-result uploads (Req 14.2). */
export const PDF_CONTENT_TYPE = 'application/pdf';

// ---------------------------------------------------------------------------
// Shared value shapes
// ---------------------------------------------------------------------------

/**
 * A single lab result value extracted from an external source (PDF OCR or
 * FHIR). Deliberately minimal and source-agnostic so both import paths and the
 * report renderer share one shape.
 */
export interface ExtractedLabValue {
  /** The measured analyte / test name (e.g. "Cortisol, Serum"). */
  readonly analyte: string;
  /** The numeric result value. */
  readonly value: number;
  /** The unit the value is reported in (e.g. "nmol/L", "ug/dL"). */
  readonly unit: string;
  /** Collection timestamp (ISO-8601), when the source provides one. */
  readonly collectedAt?: string;
}

/** An imported lab result persisted for a user. */
export interface ImportedLabResult extends ExtractedLabValue {
  readonly id: string;
  readonly userId: string;
  /** Which import path produced this result. */
  readonly source: 'pdf' | 'fhir';
  readonly importedAt: string;
}

/** The origin of an import operation. */
export type ImportSource = 'pdf' | 'fhir';

/** A successful import outcome. */
export interface LabImportSuccess {
  readonly source: ImportSource;
  /** Number of result values imported by this operation. */
  readonly importedCount: number;
  /** The persisted results produced by this import. */
  readonly imported: readonly ImportedLabResult[];
}

// ---------------------------------------------------------------------------
// PDF OCR import (Req 14.1, 14.2, 14.3)
// ---------------------------------------------------------------------------

/** An uploaded lab-result file awaiting OCR (Req 14.1). */
export interface PdfUpload {
  readonly userId: string;
  /** Original filename, used only for messaging. */
  readonly filename?: string;
  /** The declared content type; must be {@link PDF_CONTENT_TYPE} (Req 14.2). */
  readonly contentType: string;
  /** The file size in bytes; must be ≤ {@link MAX_PDF_BYTES} (Req 14.2). */
  readonly sizeBytes: number;
  /** Opaque handle/content passed through to the OCR port. */
  readonly content?: unknown;
}

/**
 * Result of an OCR extraction attempt. `elapsedMs`, when provided, lets the
 * service enforce the 30-second window (Req 14.1) deterministically.
 */
export type OcrOutcome =
  | { readonly ok: true; readonly values: readonly ExtractedLabValue[]; readonly elapsedMs?: number }
  | { readonly ok: false; readonly reason: 'timeout' | 'unreadable' };

/** An OCR engine that extracts result values from a PDF (Req 14.1). */
export interface OcrPort {
  extract(upload: PdfUpload): Promise<OcrOutcome>;
}

// ---------------------------------------------------------------------------
// Epic MyChart FHIR R4 import (Req 14.4, 14.5)
// ---------------------------------------------------------------------------

/** A request to import results from a connected Epic MyChart account (Req 14.4). */
export interface FhirImportRequest {
  readonly userId: string;
  /** Identifier of the established Epic MyChart connection, when applicable. */
  readonly connectionId?: string;
}

/**
 * Result of a FHIR R4 import attempt. `elapsedMs`, when provided, lets the
 * service enforce the 60-second window (Req 14.4) deterministically.
 */
export type FhirImportOutcome =
  | { readonly ok: true; readonly results: readonly ExtractedLabValue[]; readonly elapsedMs?: number }
  | { readonly ok: false; readonly reason: 'timeout' | 'connection-failed' };

/** An Epic MyChart FHIR R4 client (Req 14.4). */
export interface FhirClientPort {
  importResults(request: FhirImportRequest): Promise<FhirImportOutcome>;
}

// ---------------------------------------------------------------------------
// Physician-ready report generation (Req 14.6, 14.7)
// ---------------------------------------------------------------------------

/** A request to generate a physician-ready PDF report (Req 14.6). */
export interface ReportRequest {
  readonly userId: string;
}

/** A rendered physician-ready report document. */
export interface PhysicianReport {
  readonly id: string;
  readonly userId: string;
  readonly generatedAt: string;
  /** Number of results included in the report. */
  readonly resultCount: number;
  /** Opaque rendered document handle (e.g. PDF bytes / storage key). */
  readonly document: unknown;
}

/**
 * Result of a report-render attempt. `elapsedMs`, when provided, lets the
 * service enforce the 15-second window (Req 14.6) deterministically.
 */
export type ReportRenderOutcome =
  | { readonly ok: true; readonly document: unknown; readonly elapsedMs?: number }
  | { readonly ok: false; readonly reason: 'timeout' | 'render-failed' };

/** A renderer that turns imported results into a physician-ready document. */
export interface ReportRendererPort {
  render(input: {
    userId: string;
    results: readonly ImportedLabResult[];
  }): Promise<ReportRenderOutcome>;
}

// ---------------------------------------------------------------------------
// Imported-results persistence
// ---------------------------------------------------------------------------

/**
 * Persistence for a user's imported lab results. `append` is only ever invoked
 * on a successful import, so every failure path leaves prior results unchanged
 * (Req 14.2, 14.3, 14.5).
 */
export interface ImportedResultsStore {
  /** The user's currently-imported results (the "prior" results). */
  snapshot(userId: string): Promise<readonly ImportedLabResult[]>;
  /** Persist newly-imported results for a user. */
  append(userId: string, results: readonly ImportedLabResult[]): Promise<void>;
}

/**
 * Source of unique identifiers (injected for deterministic tests). Named
 * distinctly from other modules' id ports so it can be re-exported through the
 * service barrel without ambiguity.
 */
export interface IdSource {
  next(): string;
}

/**
 * Source of the current time as an ISO-8601 string (injected for tests). Named
 * distinctly from other modules' clock ports so it can be re-exported through
 * the service barrel without ambiguity.
 */
export interface TimeSource {
  now(): string;
}

/** Everything the {@link LabImportService} depends on. */
export interface LabImportDeps {
  readonly ocr: OcrPort;
  readonly fhir: FhirClientPort;
  readonly reportRenderer: ReportRendererPort;
  readonly results: ImportedResultsStore;
  readonly ids: IdSource;
  readonly clock: TimeSource;
}

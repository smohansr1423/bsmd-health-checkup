/**
 * Lab-result import + physician-report service (Req 14.1–14.7; design "Cortisol
 * Data Service").
 *
 * All external effects are injected through {@link LabImportDeps}, so the
 * validation, size/format, timeout, and atomic-failure rules here are
 * deterministic and unit-testable with in-memory doubles. Three public
 * operations back the corresponding endpoints:
 *
 *   - {@link LabImportService.importPdf} — `POST /lab-import`. Accepts a PDF of
 *     ≤20 MB, runs OCR, and imports the extracted values (Req 14.1). Oversize or
 *     wrong-format uploads are rejected at the boundary (Req 14.2); OCR failure,
 *     no recognizable values, or a >30 s run discards the partial extraction
 *     (Req 14.3). Every failure path leaves prior results unchanged.
 *
 *   - {@link LabImportService.importFromFhir} — `GET /fhir/import`. Imports
 *     results from a connected Epic MyChart account via FHIR R4 within 60 s
 *     (Req 14.4). Connection failure or timeout retains prior results unchanged
 *     (Req 14.5).
 *
 *   - {@link LabImportService.generateReport} — generates a physician-ready PDF
 *     report from a single user action within 15 s (Req 14.6). Failure or
 *     timeout produces no partial report (Req 14.7).
 */

import {
  atomicFailure,
  validationRejection,
  timeoutOutcome,
  ok,
  err,
  type Result,
  type ErrorContract,
} from '@calorie-cortisol/shared/result';

import { LabImportErrorCode } from './errors';
import {
  MAX_PDF_BYTES,
  OCR_TIMEOUT_MS,
  FHIR_TIMEOUT_MS,
  REPORT_TIMEOUT_MS,
  PDF_CONTENT_TYPE,
  type ExtractedLabValue,
  type FhirImportRequest,
  type ImportedLabResult,
  type ImportSource,
  type LabImportDeps,
  type LabImportSuccess,
  type PdfUpload,
  type PhysicianReport,
  type ReportRequest,
} from './ports';

export class LabImportService {
  private readonly deps: LabImportDeps;

  constructor(deps: LabImportDeps) {
    this.deps = deps;
  }

  // -------------------------------------------------------------------------
  // PDF OCR import (Req 14.1, 14.2, 14.3)
  // -------------------------------------------------------------------------

  /**
   * Import lab results from an uploaded PDF via OCR.
   *
   * Sequence: validate request → enforce PDF format + 20 MB limit (Req 14.2) →
   * run OCR → enforce the 30 s window and require ≥1 recognizable value
   * (Req 14.1, 14.3) → persist. Any failure returns a structured error whose
   * `retainedState` is true; `append` is never called, so prior results are
   * unchanged.
   */
  async importPdf(upload: PdfUpload): Promise<Result<LabImportSuccess>> {
    // Boundary validation (Req 14.2): reject before any OCR work.
    const validationError = validatePdfUpload(upload);
    if (validationError) {
      return err(validationError);
    }

    // OCR extraction (Req 14.1). The partial extraction is never persisted
    // unless it yields ≥1 usable value within the window (Req 14.3).
    const outcome = await this.deps.ocr.extract(upload);

    if (!outcome.ok) {
      if (outcome.reason === 'timeout') {
        return err(
          timeoutOutcome(
            LabImportErrorCode.PDF_OCR_TIMEOUT,
            `OCR did not complete within ${OCR_TIMEOUT_MS / 1000} seconds. The lab result could not be read; your previously imported results are unchanged.`,
          ),
        );
      }
      return err(ocrFailedError());
    }

    // Enforce the 30-second window even when the port reports success late.
    if (isTimedOut(outcome.elapsedMs, OCR_TIMEOUT_MS)) {
      return err(
        timeoutOutcome(
          LabImportErrorCode.PDF_OCR_TIMEOUT,
          `OCR did not complete within ${OCR_TIMEOUT_MS / 1000} seconds. The lab result could not be read; your previously imported results are unchanged.`,
        ),
      );
    }

    // No recognizable result values → discard the partial extraction (Req 14.3).
    const usable = outcome.values.filter(isUsableValue);
    if (usable.length === 0) {
      return err(ocrFailedError());
    }

    return this.persist(upload.userId, usable, 'pdf');
  }

  // -------------------------------------------------------------------------
  // Epic MyChart FHIR R4 import (Req 14.4, 14.5)
  // -------------------------------------------------------------------------

  /**
   * Import lab results from a connected Epic MyChart account via FHIR R4.
   *
   * On connection failure or a >60 s import, prior results are retained
   * unchanged and a structured error is returned (Req 14.5).
   */
  async importFromFhir(request: FhirImportRequest): Promise<Result<LabImportSuccess>> {
    if (!isNonEmpty(request.userId)) {
      return err(
        validationRejection(
          LabImportErrorCode.FHIR_INVALID_REQUEST,
          'A userId is required to import from Epic MyChart.',
        ),
      );
    }

    const outcome = await this.deps.fhir.importResults(request);

    if (!outcome.ok) {
      if (outcome.reason === 'timeout') {
        return err(fhirTimeoutError());
      }
      return err(fhirFailedError());
    }

    // Enforce the 60-second window even when the port reports success late.
    if (isTimedOut(outcome.elapsedMs, FHIR_TIMEOUT_MS)) {
      return err(fhirTimeoutError());
    }

    // A successful-but-empty import leaves prior results unchanged; surface it
    // as an unsuccessful import so the client keeps its current state (Req 14.5).
    const usable = outcome.results.filter(isUsableValue);
    if (usable.length === 0) {
      return err(fhirFailedError());
    }

    return this.persist(request.userId, usable, 'fhir');
  }

  // -------------------------------------------------------------------------
  // Physician-ready report generation (Req 14.6, 14.7)
  // -------------------------------------------------------------------------

  /**
   * Generate a physician-ready PDF report from the user's imported results.
   *
   * The operation is atomic: on render failure or a >15 s run, no partial
   * report is produced and a structured error is returned (Req 14.7).
   */
  async generateReport(request: ReportRequest): Promise<Result<PhysicianReport>> {
    if (!isNonEmpty(request.userId)) {
      return err(
        validationRejection(
          LabImportErrorCode.REPORT_INVALID_REQUEST,
          'A userId is required to generate a report.',
        ),
      );
    }

    const results = await this.deps.results.snapshot(request.userId);
    const outcome = await this.deps.reportRenderer.render({
      userId: request.userId,
      results,
    });

    if (!outcome.ok) {
      if (outcome.reason === 'timeout') {
        return err(reportTimeoutError());
      }
      return err(reportFailedError());
    }

    // Enforce the 15-second window even when the port reports success late; a
    // late "success" is discarded so no partial report is surfaced (Req 14.7).
    if (isTimedOut(outcome.elapsedMs, REPORT_TIMEOUT_MS)) {
      return err(reportTimeoutError());
    }

    return ok({
      id: this.deps.ids.next(),
      userId: request.userId,
      generatedAt: this.deps.clock.now(),
      resultCount: results.length,
      document: outcome.document,
    });
  }

  // -------------------------------------------------------------------------
  // Shared persistence helper
  // -------------------------------------------------------------------------

  /**
   * Persist newly-extracted values as imported results and return the success
   * outcome. Called only after all validation/timeout gates pass.
   */
  private async persist(
    userId: string,
    values: readonly ExtractedLabValue[],
    source: ImportSource,
  ): Promise<Result<LabImportSuccess>> {
    const importedAt = this.deps.clock.now();
    const imported: ImportedLabResult[] = values.map((v) => ({
      id: this.deps.ids.next(),
      userId,
      analyte: v.analyte,
      value: v.value,
      unit: v.unit,
      source,
      importedAt,
      ...(v.collectedAt ? { collectedAt: v.collectedAt } : {}),
    }));

    await this.deps.results.append(userId, imported);

    return ok({ source, importedCount: imported.length, imported });
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** A value is usable if it has a non-empty analyte and a finite numeric value. */
function isUsableValue(value: ExtractedLabValue): boolean {
  return (
    isNonEmpty(value.analyte) &&
    typeof value.value === 'number' &&
    Number.isFinite(value.value)
  );
}

/** True when a reported elapsed time exceeds the allowed window. */
function isTimedOut(elapsedMs: number | undefined, limitMs: number): boolean {
  return typeof elapsedMs === 'number' && elapsedMs > limitMs;
}

/**
 * Validate a PDF upload at the boundary (Req 14.2). Returns a
 * validation-rejection error contract, or `null` when the upload is acceptable.
 */
function validatePdfUpload(upload: PdfUpload): ErrorContract | null {
  if (!isNonEmpty(upload.userId)) {
    return validationRejection(
      LabImportErrorCode.PDF_INVALID_REQUEST,
      'A userId is required to import a lab result.',
    );
  }
  if (!Number.isFinite(upload.sizeBytes) || upload.sizeBytes <= 0) {
    return validationRejection(
      LabImportErrorCode.PDF_INVALID_REQUEST,
      'The uploaded file is empty or its size is unknown.',
    );
  }
  if (upload.contentType !== PDF_CONTENT_TYPE) {
    return validationRejection(
      LabImportErrorCode.PDF_WRONG_FORMAT,
      `The uploaded file must be a PDF (received "${String(upload.contentType)}"). Your previously imported results are unchanged.`,
    );
  }
  if (upload.sizeBytes > MAX_PDF_BYTES) {
    return validationRejection(
      LabImportErrorCode.PDF_TOO_LARGE,
      `The uploaded file exceeds the ${MAX_PDF_BYTES / (1024 * 1024)} MB limit. Your previously imported results are unchanged.`,
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Error-contract builders
// ---------------------------------------------------------------------------

/** OCR failure / no recognizable values: discard partial, retain prior (Req 14.3). */
function ocrFailedError(): ErrorContract {
  return atomicFailure(
    LabImportErrorCode.PDF_OCR_FAILED,
    'The lab result could not be read. Your previously imported results are unchanged.',
    { retryable: true },
  );
}

/** Epic MyChart connection failure: retain prior results (Req 14.5). */
function fhirFailedError(): ErrorContract {
  return atomicFailure(
    LabImportErrorCode.FHIR_IMPORT_FAILED,
    'The Epic MyChart import was unsuccessful. Your previously imported results are unchanged.',
    { retryable: true },
  );
}

/** Epic MyChart import exceeded 60 s: retain prior results (Req 14.5). */
function fhirTimeoutError(): ErrorContract {
  return timeoutOutcome(
    LabImportErrorCode.FHIR_IMPORT_TIMEOUT,
    `The Epic MyChart import did not complete within ${FHIR_TIMEOUT_MS / 1000} seconds. Your previously imported results are unchanged.`,
  );
}

/** Report render failure: no partial report produced (Req 14.7). */
function reportFailedError(): ErrorContract {
  return atomicFailure(
    LabImportErrorCode.REPORT_GENERATION_FAILED,
    'The report could not be generated. No partial report was produced.',
    { retryable: true },
  );
}

/** Report generation exceeded 15 s: no partial report produced (Req 14.7). */
function reportTimeoutError(): ErrorContract {
  return timeoutOutcome(
    LabImportErrorCode.REPORT_GENERATION_TIMEOUT,
    `The report did not complete within ${REPORT_TIMEOUT_MS / 1000} seconds. No partial report was produced.`,
  );
}

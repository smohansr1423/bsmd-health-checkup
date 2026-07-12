/**
 * Stable, machine-readable error codes for the lab-result import and
 * physician-report flows (Req 14.1–14.7; design "Cortisol Data Service" —
 * `POST /lab-import`, `GET /fhir/import`, report generation).
 *
 * These are the `code` field of the shared {@link ErrorContract}. Clients branch
 * on them to render the correct message and decide whether to retry. Every
 * failure path in this module preserves the user's previously imported results
 * unchanged (`retainedState: true`).
 */
export const LabImportErrorCode = {
  // --- PDF OCR import (Req 14.1, 14.2, 14.3) ------------------------------
  /** PDF import request failed field validation (missing user / non-positive size). */
  PDF_INVALID_REQUEST: 'lab_import_pdf_invalid_request',
  /** The uploaded file exceeds the 20 MB limit (Req 14.2). */
  PDF_TOO_LARGE: 'lab_import_pdf_too_large',
  /** The uploaded file is not in PDF format (Req 14.2). */
  PDF_WRONG_FORMAT: 'lab_import_pdf_wrong_format',
  /**
   * OCR extraction failed or produced no recognizable result values; the partial
   * extraction is discarded and prior results are retained (Req 14.3).
   */
  PDF_OCR_FAILED: 'lab_import_pdf_ocr_failed',
  /** OCR did not complete within the 30-second window (Req 14.1, 14.3). */
  PDF_OCR_TIMEOUT: 'lab_import_pdf_ocr_timeout',

  // --- Epic MyChart FHIR R4 import (Req 14.4, 14.5) -----------------------
  /** FHIR import request failed field validation (missing user). */
  FHIR_INVALID_REQUEST: 'lab_import_fhir_invalid_request',
  /** The Epic MyChart connection failed; prior results are retained (Req 14.5). */
  FHIR_IMPORT_FAILED: 'lab_import_fhir_failed',
  /** The FHIR R4 import did not complete within the 60-second window (Req 14.5). */
  FHIR_IMPORT_TIMEOUT: 'lab_import_fhir_timeout',

  // --- Physician-ready PDF report generation (Req 14.6, 14.7) -------------
  /** Report request failed field validation (missing user). */
  REPORT_INVALID_REQUEST: 'lab_import_report_invalid_request',
  /** Report generation failed; no partial report is produced (Req 14.7). */
  REPORT_GENERATION_FAILED: 'lab_import_report_failed',
  /** Report generation did not complete within the 15-second window (Req 14.7). */
  REPORT_GENERATION_TIMEOUT: 'lab_import_report_timeout',
} as const;

export type LabImportErrorCode =
  (typeof LabImportErrorCode)[keyof typeof LabImportErrorCode];

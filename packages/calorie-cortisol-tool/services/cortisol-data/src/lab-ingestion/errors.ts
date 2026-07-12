/**
 * Stable, machine-readable error codes for the lab-result ingestion webhook
 * (`POST /webhooks/lab-results`) — Req 8.4, 8.5, 8.8.
 *
 * These are the `code` field of the shared {@link ErrorContract}. Clients and
 * lab partners branch on them to render the correct message and decide whether
 * to retry. They are intentionally distinct from the kit-ordering/QR-linkage
 * codes in `../lab/errors.ts` (Task 9.1) so the two flows never collide.
 */
export const LabIngestErrorCode = {
  /** The HMAC signature header was missing or did not match the payload. */
  SIGNATURE_INVALID: 'lab_ingest_signature_invalid',
  /** The request body was not valid JSON / could not be parsed. */
  PAYLOAD_UNPARSEABLE: 'lab_ingest_payload_unparseable',
  /**
   * The payload parsed but failed structural validation (missing required
   * envelope fields, no usable readings, unrecognized units, etc.). The order
   * is retained and flagged results-pending (Req 8.8).
   */
  PAYLOAD_INVALID: 'lab_ingest_payload_invalid',
  /**
   * Results were not received within 72 hours of the expected publication
   * time. The order is retained and flagged results-pending (Req 8.8).
   */
  RESULTS_TIMEOUT: 'lab_ingest_results_timeout',
} as const;

export type LabIngestErrorCode =
  (typeof LabIngestErrorCode)[keyof typeof LabIngestErrorCode];

/**
 * Stable, machine-readable error codes for the Lab_Integration lab-kit
 * ordering and QR sample-linkage flows (Req 8.1, 8.2, 8.6, 8.7).
 *
 * These are the `code` field of the shared {@link ErrorContract}. Clients branch
 * on them to render the correct message and decide whether to retry.
 */
export const KitErrorCode = {
  /** Order request failed field validation (missing user, non-positive amount). */
  ORDER_INVALID_REQUEST: 'kit_order_invalid_request',
  /**
   * The CLIA/CAP lab partner was unavailable or rejected the order. The order is
   * retained in a pending state and no charge is applied (Req 8.6).
   */
  ORDER_LAB_UNAVAILABLE: 'kit_order_lab_unavailable',
  /**
   * Payment authorization or capture failed. No charge is applied and the order
   * is retained in a pending state (Req 8.6 — "no charge").
   */
  ORDER_PAYMENT_FAILED: 'kit_order_payment_failed',

  /** Link request failed field validation (missing user or code). */
  QR_INVALID_REQUEST: 'kit_link_invalid_request',
  /** The scanned code is not a well-formed kit QR code (Req 8.7 — invalid). */
  QR_INVALID: 'kit_link_qr_invalid',
  /** The code is well-formed but not present in the sample registry (Req 8.7 — unrecognized). */
  QR_UNRECOGNIZED: 'kit_link_qr_unrecognized',
  /** The code is already linked to an account; the association is left unchanged (Req 8.7). */
  QR_ALREADY_LINKED: 'kit_link_qr_already_linked',
} as const;

export type KitErrorCode = (typeof KitErrorCode)[keyof typeof KitErrorCode];

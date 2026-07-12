/**
 * Stable, machine-readable error codes for the Cortisol trend query
 * (`GET /trend?range=`) — Req 12.1, 12.5.
 *
 * These are the `code` field of the shared {@link ErrorContract}. Clients branch
 * on them to render the correct message. Trend degraded outcomes are all
 * validation rejections (the request is corrected, not retried as-is), so prior
 * state — including the currently selected range (Req 12.2) — is always
 * retained.
 */
export const TrendErrorCode = {
  /** Request failed field validation (missing/blank userId). */
  INVALID_REQUEST: 'trend_invalid_request',
  /**
   * The requested range is not one of the supported 7/30/90-day windows
   * (Req 12.1). The currently selected range is retained.
   */
  INVALID_RANGE: 'trend_invalid_range',
  /**
   * The overlay metric is not one of the supported calories/sleep/HRV metrics
   * (Req 12.5). The trend still renders; the overlay is rejected.
   */
  INVALID_OVERLAY_METRIC: 'trend_invalid_overlay_metric',
  /** The `asOf` reference instant used to anchor the range is unparseable. */
  INVALID_AS_OF: 'trend_invalid_as_of',
} as const;

export type TrendErrorCode = (typeof TrendErrorCode)[keyof typeof TrendErrorCode];

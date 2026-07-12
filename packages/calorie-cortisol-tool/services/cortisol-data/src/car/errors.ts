/**
 * Stable, machine-readable error codes for the Diurnal_Tracker CAR
 * (Cortisol Awakening Response) window-validation and completeness flows
 * (Req 11.1, 11.2, 11.3).
 *
 * These are the `code` field of the shared {@link ErrorContract}. Clients branch
 * on them to render the correct message.
 */
export const CarErrorCode = {
  /** Request failed field validation (missing user, missing/invalid wake time). */
  INVALID_REQUEST: 'car_invalid_request',
  /**
   * Sample 1 was taken outside its allowed window — before wake time or later
   * than 35 minutes after wake time (Req 11.1, 11.2). The sample is rejected and
   * any previously accepted samples are retained.
   */
  SAMPLE1_OUT_OF_WINDOW: 'car_sample1_out_of_window',
  /**
   * Sample 2 was taken outside its allowed window — not between 25 and 35
   * minutes after sample 1 (Req 11.1, 11.2). The sample is rejected and any
   * previously accepted samples are retained.
   */
  SAMPLE2_OUT_OF_WINDOW: 'car_sample2_out_of_window',
  /**
   * Sample 2 was submitted without an accepted sample 1, so its window (which is
   * defined relative to sample 1) cannot be validated. The sample is rejected
   * and any previously accepted samples are retained (Req 11.2).
   */
  SAMPLE2_WITHOUT_SAMPLE1: 'car_sample2_without_sample1',
} as const;

export type CarErrorCode = (typeof CarErrorCode)[keyof typeof CarErrorCode];

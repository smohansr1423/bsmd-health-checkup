/**
 * Kit QR-code format validation (Req 8.7).
 *
 * A well-formed kit code is `KIT-` followed by at least 8 uppercase
 * alphanumeric characters, e.g. `KIT-7F3K9QZ2`. Anything else is structurally
 * invalid and is rejected before the sample registry is ever consulted, so a
 * malformed scan can never affect an existing account-to-sample association.
 */

/** Canonical kit-code shape: `KIT-` + ≥8 uppercase alphanumerics. */
export const KIT_CODE_PATTERN = /^KIT-[A-Z0-9]{8,}$/;

/** True when `code` is a structurally well-formed kit QR code (Req 8.7). */
export function isWellFormedKitCode(code: string): boolean {
  return KIT_CODE_PATTERN.test(code);
}

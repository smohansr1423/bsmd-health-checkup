/**
 * Credential masking helpers (Task 13.1 — Req 10.3, 10.4, 16.5).
 *
 * **Pure** functions — no I/O, no React. A configured target-API credential is
 * only ever shown to the User in a masked form; the stored secret value is
 * never rendered in plaintext (Req 10.3) and never leaks into an error message
 * (Req 10.4, 16.5).
 *
 * The mask is a fixed-length run of bullet characters that is independent of the
 * secret's actual length, so neither the secret's characters nor its length are
 * disclosed. The output therefore shares no character with a non-empty secret,
 * which is what makes it safe to render anywhere in the UI.
 */

/** The character used to obscure each position of a masked secret. */
export const MASK_CHARACTER = '\u2022'; // '•'

/** Fixed number of mask characters shown for any non-empty secret. */
export const MASK_LENGTH = 8;

/**
 * Mask a credential secret for display.
 *
 * Returns a fixed-length run of {@link MASK_CHARACTER} for any non-empty secret
 * and an empty string for an empty/whitespace-only secret. The result never
 * contains any character of the original secret, satisfying "masked form only"
 * (Req 10.3).
 */
export function maskSecret(secret: string): string {
  if (secret.length === 0) {
    return '';
  }
  return MASK_CHARACTER.repeat(MASK_LENGTH);
}

/** A credential as it is safe to surface to the view layer. */
export interface MaskedCredentialView {
  /** The authentication scheme the credential belongs to (non-secret). */
  scheme: string;
  /** A human-readable label for the credential field (non-secret). */
  label: string;
  /** The masked secret — never the plaintext value (Req 10.3). */
  masked: string;
}

/**
 * Build the masked, view-safe representation of a configured credential.
 *
 * Only the non-secret `scheme`/`label` and the masked secret cross into the
 * view; the raw secret is consumed here and never returned (Req 10.3, 10.4).
 */
export function toMaskedCredential(input: {
  scheme: string;
  label: string;
  secret: string;
}): MaskedCredentialView {
  return {
    scheme: input.scheme,
    label: input.label,
    masked: maskSecret(input.secret),
  };
}

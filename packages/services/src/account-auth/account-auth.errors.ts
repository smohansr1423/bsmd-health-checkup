/**
 * Account Auth — Errors
 *
 * Custom error types for sign-up, sign-in, session, and lockout flows.
 *
 * Validates: Requirements 13.2, 13.3, 13.5, 13.6
 */

/**
 * Thrown when a sign-up is attempted with an email address that is already
 * associated with an existing account (Req 13.2). No new account is created.
 */
export class EmailAlreadyRegisteredError extends Error {
  public readonly email: string;

  constructor(email: string) {
    super(`An account is already registered with email: ${email}`);
    this.name = 'EmailAlreadyRegisteredError';
    this.email = email;
  }
}

/**
 * Thrown when a sign-up is rejected because a required registration detail is
 * missing or invalid — a missing required field, a malformed email address, or
 * a password outside the 8..128 length range (Req 13.1, 13.3).
 *
 * `field` identifies the offending registration detail and `reason` explains
 * why it is invalid, so callers can surface exactly which detail failed.
 */
export class InvalidRegistrationError extends Error {
  /** The offending registration field (e.g. `email`, `password`). */
  public readonly field: string;
  /** Human-readable reason the field is invalid. */
  public readonly reason: string;

  constructor(field: string, reason: string) {
    super(`Invalid registration detail "${field}": ${reason}`);
    this.name = 'InvalidRegistrationError';
    this.field = field;
    this.reason = reason;
  }
}

/**
 * Thrown when sign-in is attempted with credentials that do not match an
 * existing account (Req 13.5). No session is established. The message is
 * intentionally generic so it never reveals whether the email or the password
 * was the mismatching factor.
 */
export class InvalidCredentialsError extends Error {
  constructor() {
    super('Sign-in failed: the provided credentials are invalid.');
    this.name = 'InvalidCredentialsError';
  }
}

/**
 * Thrown when sign-in is attempted against an account that is temporarily
 * locked after 5 consecutive failed attempts within 15 minutes (Req 13.6).
 * The lock persists for 15 minutes; `lockedUntil` is when it lifts.
 */
export class AccountLockedError extends Error {
  public readonly accountId: string;
  public readonly lockedUntil: Date;

  constructor(accountId: string, lockedUntil: Date) {
    super(
      `Account is temporarily locked due to repeated failed sign-in attempts. ` +
        `Try again after ${lockedUntil.toISOString()}.`
    );
    this.name = 'AccountLockedError';
    this.accountId = accountId;
    this.lockedUntil = lockedUntil;
  }
}

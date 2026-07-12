/**
 * Account Auth — Types
 *
 * Request shapes, the password-hasher abstraction, and the dependency-injection
 * contract for the Account Auth service (sign-up, sign-in, sessions, lockout).
 *
 * Validates: Requirements 13.1, 13.4, 13.6, 18.1
 */

import type {
  AccountRepository,
  BaseServiceDependencies,
  PlanTier,
  SessionRepository,
} from '../api-copilot-shared';

// ---------------------------------------------------------------------------
// Request shapes
// ---------------------------------------------------------------------------

/** Payload submitted by a visitor signing up for a new account (Req 13.1). */
export interface SignUpRequest {
  email: string;
  password: string;
  /** Optional plan tier; defaults to `starter` when omitted (Req 17.1). */
  tier?: PlanTier;
}

/** Credentials submitted when signing in (Req 13.4, 13.5). */
export interface SignInRequest {
  email: string;
  password: string;
}

// ---------------------------------------------------------------------------
// Password hashing abstraction — Req 18.1
// ---------------------------------------------------------------------------

/**
 * Salted, one-way password hashing. Passwords are never stored in plaintext
 * (Req 18.1); only the salted hash produced by {@link PasswordHasher.hash} is
 * persisted, and {@link PasswordHasher.verify} checks a candidate against it.
 */
export interface PasswordHasher {
  /** Produce a salted hash that embeds its own salt for later verification. */
  hash(password: string): string;
  /** Constant-time comparison of a candidate password against a stored hash. */
  verify(password: string, storedHash: string): boolean;
}

// ---------------------------------------------------------------------------
// Dependency injection — extends the shared base (idGenerator, dateProvider)
// ---------------------------------------------------------------------------

/**
 * Dependencies for {@link AccountAuthService}. Supplied as a
 * `Partial<AccountAuthDependencies>`; anything omitted falls back to an
 * in-memory / default implementation.
 */
export interface AccountAuthDependencies extends BaseServiceDependencies {
  accountRepository: AccountRepository;
  sessionRepository: SessionRepository;
  passwordHasher: PasswordHasher;
}

/**
 * Account Auth — Validators
 *
 * Pure validation for sign-up registration details: required fields, email
 * syntax, and password length. Each failure raises an
 * {@link InvalidRegistrationError} that names the offending detail (Req 13.3).
 *
 * Validates: Requirements 13.1, 13.3
 */

import { InvalidRegistrationError } from './account-auth.errors';
import type { SignUpRequest } from './account-auth.types';

/** Password length bounds, inclusive (Req 13.1, 13.3). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Pragmatic email syntax check: a non-empty local part, a single `@`, and a
 * domain containing at least one dot with non-empty labels and no whitespace.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True when `email` is a syntactically valid email address. */
export function isValidEmail(email: string): boolean {
  if (typeof email !== 'string') {
    return false;
  }
  const trimmed = email.trim();
  return trimmed.length > 0 && trimmed.length <= 254 && EMAIL_REGEX.test(trimmed);
}

/** True when `password` length is within the accepted 8..128 range. */
export function isValidPasswordLength(password: string): boolean {
  return (
    typeof password === 'string' &&
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH
  );
}

/**
 * Validate a sign-up request (Req 13.1, 13.3).
 *
 * Order of checks: required fields present → email syntax → password length.
 * The first failing check throws {@link InvalidRegistrationError} identifying
 * the offending detail; a valid request returns normally.
 *
 * @throws InvalidRegistrationError when any registration detail is invalid.
 */
export function validateSignUp(req: SignUpRequest): void {
  // Required fields must be present and non-empty (Req 13.3).
  if (req === null || req === undefined) {
    throw new InvalidRegistrationError('request', 'registration details are required');
  }
  if (typeof req.email !== 'string' || req.email.trim().length === 0) {
    throw new InvalidRegistrationError('email', 'email is required');
  }
  if (typeof req.password !== 'string' || req.password.length === 0) {
    throw new InvalidRegistrationError('password', 'password is required');
  }

  // Malformed email (Req 13.3).
  if (!isValidEmail(req.email)) {
    throw new InvalidRegistrationError('email', 'email address is malformed');
  }

  // Password length outside 8..128 (Req 13.1, 13.3).
  if (!isValidPasswordLength(req.password)) {
    throw new InvalidRegistrationError(
      'password',
      `password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`
    );
  }
}

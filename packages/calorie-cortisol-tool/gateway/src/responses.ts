/**
 * Response + error helpers for the gateway (Task 16.1).
 *
 * Every failure envelope carries the shared structured error contract
 * `{ code, message, retryable, retainedState }` so clients can branch on
 * `retryable` / `retainedState` uniformly (design: Error Response Contract).
 *
 * Requirements: 18.1, 23.3, 25.2
 */

import {
  type ErrorContract,
  capacityExceeded,
  validationRejection,
} from '@calorie-cortisol/shared';
import type { GatewayResponse } from './types';

/** HTTP-style status codes used by the gateway. */
export const STATUS = {
  OK: 200,
  ACCEPTED: 202,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  SERVICE_UNAVAILABLE: 503,
} as const;

/** Stable gateway error codes. */
export const GATEWAY_ERROR = {
  TLS_REQUIRED: 'GATEWAY_TLS_REQUIRED',
  UNAUTHENTICATED: 'GATEWAY_UNAUTHENTICATED',
  UNAUTHORIZED: 'GATEWAY_UNAUTHORIZED',
  RATE_LIMITED: 'GATEWAY_RATE_LIMITED',
  CAPACITY_EXCEEDED: 'GATEWAY_CAPACITY_EXCEEDED',
  CONSENT_REQUIRED: 'GATEWAY_CONSENT_REQUIRED',
  RESIDENCY_BLOCKED: 'GATEWAY_RESIDENCY_BLOCKED',
  INVALID_REQUEST: 'GATEWAY_INVALID_REQUEST',
  NO_ROUTE: 'GATEWAY_NO_ROUTE',
} as const;

/** Build a successful response. */
export function respondOk(
  body: unknown,
  status: number = STATUS.OK,
  headers?: Record<string, string>,
): GatewayResponse {
  return { status, ok: true, body, ...(headers ? { headers } : {}) };
}

/** Build a failure response from a structured error contract. */
export function respondError(
  status: number,
  error: ErrorContract,
  headers?: Record<string, string>,
): GatewayResponse {
  return { status, ok: false, error, ...(headers ? { headers } : {}) };
}

/**
 * Rate-limit rejection (Req 23 token bucket). Retryable and non-mutating, so
 * `retainedState` is true and `retryable` is true.
 */
export function rateLimited(retryAfterSeconds?: number): GatewayResponse {
  const error: ErrorContract = {
    code: GATEWAY_ERROR.RATE_LIMITED,
    message: 'Rate limit exceeded; please retry later.',
    retryable: true,
    retainedState: true,
  };
  const headers =
    retryAfterSeconds !== undefined
      ? { 'Retry-After': String(retryAfterSeconds) }
      : undefined;
  return respondError(STATUS.TOO_MANY_REQUESTS, error, headers);
}

/**
 * Capacity-exceeded response (Req 23.3). Uses the shared `capacityExceeded`
 * helper. `queued` distinguishes shed-by-queue from shed-by-reject; both
 * preserve accepted in-progress requests.
 */
export function capacityShed(queued: boolean): GatewayResponse {
  const error = capacityExceeded(
    GATEWAY_ERROR.CAPACITY_EXCEEDED,
    queued
      ? 'Capacity exceeded; request queued for later processing.'
      : 'Capacity exceeded; request rejected. Please retry later.',
  );
  return respondError(STATUS.SERVICE_UNAVAILABLE, error, {
    'X-Capacity-Disposition': queued ? 'queued' : 'rejected',
  });
}

/** No matching downstream route (validation-style rejection). */
export function noRoute(path: string): GatewayResponse {
  return respondError(
    STATUS.NOT_FOUND,
    validationRejection(
      GATEWAY_ERROR.NO_ROUTE,
      `No downstream service is registered for "${path}".`,
    ),
  );
}

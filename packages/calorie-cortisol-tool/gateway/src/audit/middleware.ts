/**
 * Audit-logging middleware (Task 16.2).
 *
 * A self-contained {@link Middleware} that the gateway pipeline (Task 16.1)
 * composes via `composeChain`. It wraps the rest of the chain: it invokes
 * `next`, observes the outcome, and — for every health-data access — appends a
 * complete audit entry to the injected {@link AuditStore} (Req 25.6). Because
 * it records after `next` resolves, it captures **denied** attempts too,
 * including requests short-circuited by the auth stage before routing
 * (Req 25.7).
 *
 * Composition note: to guarantee denied unauthenticated/unauthorized attempts
 * are recorded, this middleware must sit **ahead of** the auth stage in the
 * chain so its `next` call encloses authentication.
 *
 * Requirements: 25.6, 25.7
 */

import type { ErrorContract } from '@calorie-cortisol/shared';
import type {
  GatewayResponse,
  Middleware,
  NextFn,
  RequestContext,
} from '../types';
import type { AuditMiddlewareConfig, AuditOutcome } from './types';
import {
  buildAuditRecord,
  defaultHealthDataClassifier,
  deriveOutcome,
  resolveRecordId as defaultResolveRecordId,
  systemClock,
} from './policy';

/** Stage name used for chain introspection / ordering assertions. */
export const AUDIT_MIDDLEWARE_NAME = 'audit';

/** Extract a concise denial/error reason from a response, if any. */
function reasonFromResponse(response: GatewayResponse): string | undefined {
  const error: ErrorContract | undefined = response.error;
  if (!error) return undefined;
  return error.code;
}

/**
 * Create the audit-logging middleware.
 *
 * Every health-data request (per the injected classifier) yields exactly one
 * appended audit entry regardless of whether it was allowed, denied, or errored
 * — including the case where `next` throws, which is recorded as an `error`
 * outcome before the exception is re-thrown so the failure is never swallowed.
 */
export function createAuditMiddleware(config: AuditMiddlewareConfig): Middleware {
  const { store } = config;
  const clock = config.clock ?? systemClock;
  const classifyHealthData = config.classifyHealthData ?? defaultHealthDataClassifier;
  const resolveRecordId = config.resolveRecordId ?? defaultResolveRecordId;

  return {
    name: AUDIT_MIDDLEWARE_NAME,
    async handle(ctx: RequestContext, next: NextFn): Promise<GatewayResponse> {
      let response: GatewayResponse | undefined;
      let thrown: unknown;
      let outcome: AuditOutcome;
      let reason: string | undefined;

      try {
        response = await next(ctx);
        outcome = deriveOutcome(response);
        reason = outcome === 'allowed' ? undefined : reasonFromResponse(response);
      } catch (error) {
        thrown = error;
        outcome = 'error';
        reason = error instanceof Error ? error.message : 'unknown_error';
      }

      if (classifyHealthData(ctx.request)) {
        const record = buildAuditRecord({
          ctx,
          outcome,
          now: clock.now(),
          reason,
          resolveRecordId,
        });
        await store.append(record);
      }

      if (thrown !== undefined) throw thrown;
      // `response` is always assigned when no exception was thrown.
      return response as GatewayResponse;
    },
  };
}

/**
 * Request-validation middleware (Task 16.1).
 *
 * The penultimate stage before routing. Runs structural validation of the
 * inbound request and short-circuits with a 400 + structured validation error
 * when the request is malformed. A {@link RequestValidator} can be injected to
 * layer richer schema checks; the built-in {@link StructuralRequestValidator}
 * enforces the minimum shape the router relies on (a GraphQL operation for
 * GraphQL requests, a non-empty method/path otherwise).
 *
 * Requirements: 18.1, 25.2
 */

import { GATEWAY_ERROR, STATUS, respondError } from '../responses';
import { validationRejection } from '@calorie-cortisol/shared';
import type {
  Middleware,
  NextFn,
  RequestContext,
  RequestValidator,
  ValidationOutcome,
} from '../types';

/**
 * Minimal structural validator. Ensures GraphQL requests carry a parsed
 * operation with a query/mutation type and a field name, and that REST/webhook
 * requests carry a method and path. Business-rule validation belongs to the
 * downstream services.
 */
export class StructuralRequestValidator implements RequestValidator {
  validate(ctx: RequestContext): ValidationOutcome {
    const { request } = ctx;

    if (!request.method || request.method.trim().length === 0) {
      return {
        valid: false,
        error: validationRejection(
          GATEWAY_ERROR.INVALID_REQUEST,
          'Request method is required.',
        ),
      };
    }
    if (!request.path || request.path.trim().length === 0) {
      return {
        valid: false,
        error: validationRejection(
          GATEWAY_ERROR.INVALID_REQUEST,
          'Request path is required.',
        ),
      };
    }

    if (request.kind === 'graphql') {
      const op = request.graphql;
      if (!op) {
        return {
          valid: false,
          error: validationRejection(
            GATEWAY_ERROR.INVALID_REQUEST,
            'GraphQL request is missing a parsed operation.',
          ),
        };
      }
      if (op.operationType !== 'query' && op.operationType !== 'mutation') {
        return {
          valid: false,
          error: validationRejection(
            GATEWAY_ERROR.INVALID_REQUEST,
            `Unsupported GraphQL operation type "${String(op.operationType)}".`,
          ),
        };
      }
      if (!op.fieldName || op.fieldName.trim().length === 0) {
        return {
          valid: false,
          error: validationRejection(
            GATEWAY_ERROR.INVALID_REQUEST,
            'GraphQL operation is missing a field name.',
          ),
        };
      }
    }

    return { valid: true };
  }
}

export interface ValidationMiddlewareOptions {
  /** Defaults to a {@link StructuralRequestValidator}. */
  readonly validator?: RequestValidator;
}

/** Build the request-validation middleware. */
export function validationMiddleware(
  options: ValidationMiddlewareOptions = {},
): Middleware {
  const validator = options.validator ?? new StructuralRequestValidator();
  return {
    name: 'request-validation',
    async handle(ctx: RequestContext, next: NextFn) {
      const outcome = await validator.validate(ctx);
      if (!outcome.valid) {
        const error =
          outcome.error ??
          validationRejection(GATEWAY_ERROR.INVALID_REQUEST, 'Invalid request.');
        return respondError(STATUS.BAD_REQUEST, error);
      }
      return next(ctx);
    },
  };
}

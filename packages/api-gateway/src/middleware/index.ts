/**
 * Middleware barrel export
 */

export { createGatewayAuthMiddleware, createRoleGuard } from './auth.middleware';
export type { AuthMiddlewareConfig, TokenValidatorFn, SessionRefresherFn } from './auth.middleware';
export { createRateLimiter, startRateLimitCleanup, stopRateLimitCleanup, clearRateLimitStore } from './rate-limiter';
export { errorHandler, notFoundHandler, AppError, badRequest, notFound, conflict, validationError, serviceUnavailable } from './error-handler';
export { createRequestValidator, commonSchemas } from './request-validator';

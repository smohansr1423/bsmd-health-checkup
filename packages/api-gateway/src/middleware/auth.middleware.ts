/**
 * API Gateway Auth Middleware Wrapper
 * Wraps the auth service middleware for Express route-level usage.
 * Validates: Requirements 18.1, 18.5
 */

import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types';
import type { Role } from '@health-checkup/services';

/**
 * Token validator function type.
 * In production, this delegates to the AuthService's validateToken method.
 */
export type TokenValidatorFn = (token: string) => {
  token: string;
  userId: string;
  role: Role;
  sessionId: string;
  issuedAt: Date;
  expiresAt: Date;
} | null;

/**
 * Session refresher function type.
 * In production, this delegates to the AuthService's refreshSession method.
 */
export type SessionRefresherFn = (sessionId: string) => boolean;

export interface AuthMiddlewareConfig {
  validateToken: TokenValidatorFn;
  refreshSession: SessionRefresherFn;
}

/**
 * Creates the gateway-level authentication middleware.
 * Validates Bearer token and refreshes session activity.
 */
export function createGatewayAuthMiddleware(config: AuthMiddlewareConfig) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers['authorization'];

    if (!authHeader) {
      res.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'No authorization header provided',
        },
      });
      return;
    }

    const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;

    if (!headerValue || !headerValue.startsWith('Bearer ')) {
      res.status(401).json({
        error: {
          code: 'INVALID_AUTH_FORMAT',
          message: 'Invalid authorization header format. Expected: Bearer <token>',
        },
      });
      return;
    }

    const tokenString = headerValue.substring(7);

    const authToken = config.validateToken(tokenString);
    if (!authToken) {
      res.status(401).json({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid or expired token. Please re-authenticate.',
        },
      });
      return;
    }

    // Refresh session activity to prevent timeout
    const sessionActive = config.refreshSession(authToken.sessionId);
    if (!sessionActive) {
      res.status(401).json({
        error: {
          code: 'SESSION_EXPIRED',
          message: 'Your session has expired due to inactivity. Please log in again.',
        },
      });
      return;
    }

    // Attach auth context to request
    req.auth = authToken;
    next();
  };
}

/**
 * Creates role-based authorization middleware.
 * Must be used AFTER auth middleware to ensure req.auth is populated.
 */
export function createRoleGuard(...allowedRoles: Role[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'You must be authenticated to access this resource.',
        },
      });
      return;
    }

    if (allowedRoles.length > 0 && !allowedRoles.includes(req.auth.role)) {
      res.status(403).json({
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: 'You do not have permission to access this resource.',
        },
      });
      return;
    }

    next();
  };
}
